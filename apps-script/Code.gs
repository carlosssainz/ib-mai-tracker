/**
 * Cuaderno IB · MAI NM — Backend gratuito de sincronización (Google Drive + Apps Script)
 *
 * Cómo funciona:
 * - Guarda un archivo JSON por sala en una carpeta PRIVADA de tu Google Drive:
 *   "Cuaderno_IB_MAI_Sync_Privado" (en la raíz de Mi unidad, totalmente fuera de
 *   "EXÁMENES EST MATEMATICOS").
 * - Usa CacheService para responder al instante en el polling sin tocar Drive
 *   cuando no hay cambios.
 * - Usa LockService + fusión granular por marcas de tiempo para que el profesor
 *   y el alumno puedan editar a la vez sin pisarse cambios.
 * - Acepta peticiones POST con Content-Type: text/plain para evitar errores CORS
 *   (sin preflight OPTIONS).
 */

var SYNC_FOLDER_NAME = "Cuaderno_IB_MAI_Sync_Privado";
var CACHE_TTL_SEC = 21600; // 6 horas (máximo en CacheService)
var CACHE_CHUNK_SIZE = 85000; // Margen seguro bajo el límite de 100 KB por clave
var LOCK_TIMEOUT_MS = 15000;

function doGet(e) {
  try {
    var params = (e && e.parameter) || {};
    var action = String(params.action || "status").toLowerCase();

    if (action === "status" && !params.room) {
      return jsonResponse_({
        ok: true,
        service: "Cuaderno IB · MAI NM Drive Sync",
        version: 1,
        folder: SYNC_FOLDER_NAME,
        time: new Date().toISOString()
      });
    }

    var room = sanitizeRoom_(params.room);
    if (!room) {
      return jsonResponse_({ ok: false, error: "Código de sala inválido (mínimo 3 caracteres)." });
    }

    if (action === "ping") {
      return handlePing_(room);
    }
    if (action === "pull") {
      var sinceRev = params.sinceRev !== undefined && params.sinceRev !== "" ? Number(params.sinceRev) : -1;
      return handlePull_(room, sinceRev);
    }

    return jsonResponse_({ ok: false, error: "Acción GET no soportada: " + action });
  } catch (err) {
    return jsonResponse_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function doPost(e) {
  try {
    var raw = e && e.postData && e.postData.contents ? String(e.postData.contents) : "";
    if (!raw) {
      return jsonResponse_({ ok: false, error: "Cuerpo vacío en petición POST." });
    }

    var body = JSON.parse(raw);
    var action = String(body.action || "pull").toLowerCase();
    var room = sanitizeRoom_(body.room);
    if (!room) {
      return jsonResponse_({ ok: false, error: "Código de sala inválido (mínimo 3 caracteres)." });
    }

    if (action === "ping") {
      return handlePing_(room);
    }
    if (action === "pull") {
      var sinceRev = body.sinceRev !== undefined && body.sinceRev !== null && body.sinceRev !== "" ? Number(body.sinceRev) : -1;
      return handlePull_(room, sinceRev);
    }
    if (action === "push") {
      return handlePush_(room, body.state || {}, body.role || "profesor", body.clientId || "");
    }

    return jsonResponse_({ ok: false, error: "Acción POST no soportada: " + action });
  } catch (err) {
    return jsonResponse_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function handlePing_(room) {
  var folder = getOrCreatePrivateFolder_();
  var meta = readMetaFast_(room);
  return jsonResponse_({
    ok: true,
    room: room,
    folder: folder.getName(),
    rev: meta ? meta.rev : 0,
    updatedAt: meta ? meta.updatedAt : null,
    serverTime: new Date().toISOString()
  });
}

function handlePull_(room, sinceRev) {
  var cachedMeta = getCachedMeta_(room);
  if (cachedMeta && typeof sinceRev === "number" && isFinite(sinceRev) && sinceRev >= 0 && cachedMeta.rev === sinceRev) {
    return jsonResponse_({
      ok: true,
      room: room,
      changed: false,
      rev: cachedMeta.rev,
      updatedAt: cachedMeta.updatedAt,
      updatedBy: cachedMeta.updatedBy || null
    });
  }

  var cachedDoc = getCachedDoc_(room);
  if (cachedDoc) {
    if (typeof sinceRev === "number" && isFinite(sinceRev) && sinceRev >= 0 && cachedDoc.rev === sinceRev) {
      return jsonResponse_({
        ok: true,
        room: room,
        changed: false,
        rev: cachedDoc.rev,
        updatedAt: cachedDoc.updatedAt,
        updatedBy: cachedDoc.updatedBy || null
      });
    }
    return jsonResponse_({
      ok: true,
      room: room,
      changed: true,
      rev: cachedDoc.rev || 0,
      updatedAt: cachedDoc.updatedAt || null,
      updatedBy: cachedDoc.updatedBy || null,
      data: cachedDoc.data || null
    });
  }

  var diskDoc = readRoomFromDrive_(room);
  if (!diskDoc) {
    return jsonResponse_({
      ok: true,
      room: room,
      changed: sinceRev !== 0,
      rev: 0,
      updatedAt: null,
      updatedBy: null,
      data: null
    });
  }

  writeCache_(room, diskDoc);

  if (typeof sinceRev === "number" && isFinite(sinceRev) && sinceRev >= 0 && diskDoc.rev === sinceRev) {
    return jsonResponse_({
      ok: true,
      room: room,
      changed: false,
      rev: diskDoc.rev,
      updatedAt: diskDoc.updatedAt,
      updatedBy: diskDoc.updatedBy || null
    });
  }

  return jsonResponse_({
    ok: true,
    room: room,
    changed: true,
    rev: diskDoc.rev || 1,
    updatedAt: diskDoc.updatedAt || null,
    updatedBy: diskDoc.updatedBy || null,
    data: diskDoc.data || null
  });
}

function handlePush_(room, incomingState, role, clientId) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_TIMEOUT_MS)) {
    return jsonResponse_({
      ok: false,
      retryable: true,
      error: "Otro cambio está terminando de guardarse. Reintenta en un segundo."
    });
  }

  try {
    var currentDoc = getCachedDoc_(room) || readRoomFromDrive_(room);
    var currentData = currentDoc && currentDoc.data ? currentDoc.data : null;
    var currentRev = currentDoc && Number(currentDoc.rev) ? Number(currentDoc.rev) : 0;

    var mergedData = mergeRemotePayloads_(currentData, incomingState);
    var nowIso = new Date().toISOString();
    mergedData.updatedAt = nowIso;

    var nextDoc = {
      room: room,
      rev: currentRev + 1,
      updatedAt: nowIso,
      updatedBy: role === "alumno" ? "alumno" : "profesor",
      clientId: String(clientId || "").slice(0, 32),
      data: mergedData
    };

    writeRoomToDrive_(room, nextDoc);
    writeCache_(room, nextDoc);

    return jsonResponse_({
      ok: true,
      room: room,
      changed: true,
      rev: nextDoc.rev,
      updatedAt: nextDoc.updatedAt,
      updatedBy: nextDoc.updatedBy,
      data: nextDoc.data
    });
  } finally {
    lock.releaseLock();
  }
}

/* ==========================================================================
   Fusión granular en servidor (evita pisar ediciones simultáneas)
   ========================================================================== */

function pickNewer_(a, b) {
  if (!a) return b;
  if (!b) return a;
  var ta = a.updatedAt ? String(a.updatedAt) : "";
  var tb = b.updatedAt ? String(b.updatedAt) : "";
  return tb >= ta ? b : a;
}

function mergeRemotePayloads_(current, incoming) {
  if (!current || typeof current !== "object") {
    return cloneObj_(incoming || {});
  }
  if (!incoming || typeof incoming !== "object") {
    return cloneObj_(current);
  }

  var out = {
    schemaVersion: incoming.schemaVersion || current.schemaVersion || 2,
    updatedAt: new Date().toISOString(),
    settings: {},
    exams: {},
    notesMap: {},
    logMap: {}
  };

  // 1. Settings compartidos
  var curSet = current.settings && typeof current.settings === "object" ? current.settings : {};
  var incSet = incoming.settings && typeof incoming.settings === "object" ? incoming.settings : {};
  var useIncomingSet = String(incSet.updatedAt || "") >= String(curSet.updatedAt || "");
  out.settings = assignObj_(
    useIncomingSet ? curSet : incSet,
    useIncomingSet ? incSet : curSet
  );

  // 2. Exámenes y ejercicios individuales
  var curExams = current.exams && typeof current.exams === "object" ? current.exams : {};
  var incExams = incoming.exams && typeof incoming.exams === "object" ? incoming.exams : {};
  var examIds = unionKeys_(curExams, incExams);

  for (var i = 0; i < examIds.length; i++) {
    var eid = examIds[i];
    var ce = curExams[eid];
    var ie = incExams[eid];
    if (!ce) {
      out.exams[eid] = cloneObj_(ie);
      continue;
    }
    if (!ie) {
      out.exams[eid] = cloneObj_(ce);
      continue;
    }

    var baseExam = cloneObj_(pickNewer_(ce, ie));
    var curEx = ce.exercises && typeof ce.exercises === "object" ? ce.exercises : {};
    var incEx = ie.exercises && typeof ie.exercises === "object" ? ie.exercises : {};
    var qKeys = unionKeys_(curEx, incEx);
    var mergedEx = {};
    for (var j = 0; j < qKeys.length; j++) {
      var qk = qKeys[j];
      mergedEx[qk] = cloneObj_(pickNewer_(curEx[qk], incEx[qk]));
    }
    baseExam.exercises = mergedEx;

    // Intentos por id
    var attMap = {};
    var cAtt = Array.isArray(ce.attempts) ? ce.attempts : [];
    var iAtt = Array.isArray(ie.attempts) ? ie.attempts : [];
    for (var a1 = 0; a1 < cAtt.length; a1++) {
      if (cAtt[a1] && cAtt[a1].id) attMap[cAtt[a1].id] = cAtt[a1];
    }
    for (var a2 = 0; a2 < iAtt.length; a2++) {
      if (iAtt[a2] && iAtt[a2].id) attMap[iAtt[a2].id] = iAtt[a2];
    }
    var attList = [];
    for (var ak in attMap) {
      if (Object.prototype.hasOwnProperty.call(attMap, ak)) attList.push(attMap[ak]);
    }
    attList.sort(function (x, y) {
      return String(y.date || "").localeCompare(String(x.date || ""));
    });
    baseExam.attempts = attList;

    out.exams[eid] = baseExam;
  }

  // 3. Notas (respetando _deleted con timestamp)
  var curNotes = current.notesMap && typeof current.notesMap === "object" ? current.notesMap : {};
  var incNotes = incoming.notesMap && typeof incoming.notesMap === "object" ? incoming.notesMap : {};
  var noteIds = unionKeys_(curNotes, incNotes);
  for (var n = 0; n < noteIds.length; n++) {
    var nid = noteIds[n];
    out.notesMap[nid] = cloneObj_(pickNewer_(curNotes[nid], incNotes[nid]));
  }

  // 4. Historial de sesiones (respetando _deleted con timestamp)
  var curLogs = current.logMap && typeof current.logMap === "object" ? current.logMap : {};
  var incLogs = incoming.logMap && typeof incoming.logMap === "object" ? incoming.logMap : {};
  var logIds = unionKeys_(curLogs, incLogs);
  for (var l = 0; l < logIds.length; l++) {
    var lid = logIds[l];
    out.logMap[lid] = cloneObj_(pickNewer_(curLogs[lid], incLogs[lid]));
  }

  return out;
}

/* ==========================================================================
   Almacenamiento en carpeta privada de Drive (fuera de EXÁMENES EST MATEMATICOS)
   ========================================================================== */

function getOrCreatePrivateFolder_() {
  var props = PropertiesService.getScriptProperties();
  var cachedId = props.getProperty("SYNC_FOLDER_ID");
  if (cachedId) {
    try {
      var existing = DriveApp.getFolderById(cachedId);
      if (existing && !existing.isTrashed()) return existing;
    } catch (e) {
      // Se recrea si se borró o movió
    }
  }

  var root = DriveApp.getRootFolder();
  var it = root.getFoldersByName(SYNC_FOLDER_NAME);
  var folder = it.hasNext() ? it.next() : root.createFolder(SYNC_FOLDER_NAME);
  props.setProperty("SYNC_FOLDER_ID", folder.getId());
  return folder;
}

function getRoomFile_(room, createIfMissing) {
  var props = PropertiesService.getScriptProperties();
  var propKey = "FILE_ID_" + room;
  var fileId = props.getProperty(propKey);
  if (fileId) {
    try {
      var cachedFile = DriveApp.getFileById(fileId);
      if (cachedFile && !cachedFile.isTrashed()) return cachedFile;
    } catch (e) {
      // Buscar por nombre en la carpeta privada
    }
  }

  var folder = getOrCreatePrivateFolder_();
  var fileName = "sala_" + room + ".json";
  var files = folder.getFilesByName(fileName);
  if (files.hasNext()) {
    var found = files.next();
    props.setProperty(propKey, found.getId());
    return found;
  }

  if (!createIfMissing) return null;

  var created = folder.createFile(fileName, "{}", MimeType.PLAIN_TEXT);
  props.setProperty(propKey, created.getId());
  return created;
}

function readRoomFromDrive_(room) {
  var file = getRoomFile_(room, false);
  if (!file) return null;
  var text = file.getBlob().getDataAsString("UTF-8");
  if (!text) return null;
  var parsed = JSON.parse(text);
  return parsed && typeof parsed === "object" ? parsed : null;
}

function writeRoomToDrive_(room, doc) {
  var file = getRoomFile_(room, true);
  file.setContent(JSON.stringify(doc));
}

/* ==========================================================================
   CacheService (lecturas ultrarrápidas con soporte multi-bloque)
   ========================================================================== */

function readMetaFast_(room) {
  var meta = getCachedMeta_(room);
  if (meta) return meta;
  var doc = readRoomFromDrive_(room);
  if (!doc) return null;
  writeCache_(room, doc);
  return { rev: doc.rev || 1, updatedAt: doc.updatedAt || null, updatedBy: doc.updatedBy || null };
}

function getCachedMeta_(room) {
  try {
    var cache = CacheService.getScriptCache();
    var raw = cache.get("REV_" + room);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function getCachedDoc_(room) {
  try {
    var cache = CacheService.getScriptCache();
    var countRaw = cache.get("CHUNKS_" + room);
    if (!countRaw) return null;
    var count = Number(countRaw);
    if (!isFinite(count) || count < 1 || count > 12) return null;
    var keys = [];
    for (var i = 0; i < count; i++) keys.push("DATA_" + room + "_" + i);
    var values = cache.getAll(keys);
    var combined = "";
    for (var j = 0; j < count; j++) {
      var part = values[keys[j]];
      if (part === undefined || part === null) return null;
      combined += part;
    }
    return JSON.parse(combined);
  } catch (e) {
    return null;
  }
}

function writeCache_(room, doc) {
  try {
    var cache = CacheService.getScriptCache();
    var meta = JSON.stringify({
      rev: doc.rev || 1,
      updatedAt: doc.updatedAt || null,
      updatedBy: doc.updatedBy || null
    });
    var serialized = JSON.stringify(doc);
    var chunks = [];
    for (var pos = 0; pos < serialized.length; pos += CACHE_CHUNK_SIZE) {
      chunks.push(serialized.slice(pos, pos + CACHE_CHUNK_SIZE));
    }
    var toPut = {};
    toPut["REV_" + room] = meta;
    if (chunks.length <= 12) {
      toPut["CHUNKS_" + room] = String(chunks.length);
      for (var i = 0; i < chunks.length; i++) {
        toPut["DATA_" + room + "_" + i] = chunks[i];
      }
    }
    cache.putAll(toPut, CACHE_TTL_SEC);
  } catch (e) {
    // Si falla la caché (p. ej. cuota temporal), Drive sigue siendo la fuente de verdad
  }
}

/* ==========================================================================
   Utilidades
   ========================================================================== */

function sanitizeRoom_(raw) {
  var clean = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return clean.length >= 3 ? clean : "";
}

function unionKeys_(objA, objB) {
  var seen = {};
  var keys = [];
  var k;
  for (k in objA) {
    if (Object.prototype.hasOwnProperty.call(objA, k) && !seen[k]) {
      seen[k] = true;
      keys.push(k);
    }
  }
  for (k in objB) {
    if (Object.prototype.hasOwnProperty.call(objB, k) && !seen[k]) {
      seen[k] = true;
      keys.push(k);
    }
  }
  return keys;
}

function assignObj_(base, overlay) {
  var res = {};
  var k;
  for (k in base) {
    if (Object.prototype.hasOwnProperty.call(base, k)) res[k] = base[k];
  }
  for (k in overlay) {
    if (Object.prototype.hasOwnProperty.call(overlay, k)) res[k] = overlay[k];
  }
  return res;
}

function cloneObj_(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function jsonResponse_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

// Motor de sincronización en tiempo real vía Firebase Realtime Database (REST + SSE EventSource).
// Cero dependencias externas, actualizaciones < 1 s entre Profesor y Alumno y fusión granular sin pisar cambios.

export const SYNC_CONFIG_KEY = "ib_mai_firebase_cfg_v2";

export function normalizeFirebaseUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return "";
  let u = rawUrl.trim().replace(/\/+$/, "");
  if (!u) return "";
  if (!u.startsWith("https://")) {
    if (u.startsWith("http://")) u = "https://" + u.slice(7);
    else u = "https://" + u;
  }
  return u;
}

export function sanitizeRoomCode(rawCode) {
  return String(rawCode || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 48);
}

export function loadSyncConfig() {
  try {
    const raw = localStorage.getItem(SYNC_CONFIG_KEY);
    if (!raw) return { enabled: false, dbUrl: "", roomCode: "", role: "profesor" };
    const parsed = JSON.parse(raw);
    return {
      enabled: Boolean(parsed.enabled && parsed.dbUrl && parsed.roomCode),
      dbUrl: normalizeFirebaseUrl(parsed.dbUrl),
      roomCode: sanitizeRoomCode(parsed.roomCode),
      role: parsed.role === "alumno" ? "alumno" : "profesor"
    };
  } catch {
    return { enabled: false, dbUrl: "", roomCode: "", role: "profesor" };
  }
}

export function saveSyncConfig(cfg) {
  const clean = {
    enabled: Boolean(cfg.enabled && cfg.dbUrl && cfg.roomCode),
    dbUrl: normalizeFirebaseUrl(cfg.dbUrl),
    roomCode: sanitizeRoomCode(cfg.roomCode),
    role: cfg.role === "alumno" ? "alumno" : "profesor"
  };
  try {
    localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify(clean));
  } catch {
    // ignore storage errors
  }
  return clean;
}

export function encodeInviteLink(baseUrl, dbUrl, roomCode, role = "alumno") {
  const payload = JSON.stringify({ u: normalizeFirebaseUrl(dbUrl), r: sanitizeRoomCode(roomCode) });
  const bytes = new TextEncoder().encode(payload);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  const b64 = btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const cleanBase = baseUrl.split("?")[0].split("#")[0];
  return `${cleanBase}?sync=${b64}&role=${role === "profesor" ? "profesor" : "alumno"}`;
}

export function parseInviteFromSearch(searchStr) {
  try {
    const params = new URLSearchParams(searchStr || "");
    const token = params.get("sync");
    if (!token) return null;
    const norm = token.replace(/-/g, "+").replace(/_/g, "/");
    const padded = norm + "=".repeat((4 - (norm.length % 4)) % 4);
    const bin = atob(padded);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    const dbUrl = normalizeFirebaseUrl(parsed.u);
    const roomCode = sanitizeRoomCode(parsed.r);
    if (!dbUrl || !roomCode) return null;
    const role = params.get("role") === "profesor" ? "profesor" : "alumno";
    return { enabled: true, dbUrl, roomCode, role };
  } catch {
    return null;
  }
}

// Convierte arrays de notes/activityLog a mapas por id para almacenamiento en Firebase (y viceversa)
export function stateToRemoteMap(state) {
  const notesMap = {};
  for (const n of state.notes || []) {
    if (n && n.id) notesMap[n.id] = n;
  }
  const logMap = {};
  for (const l of state.activityLog || []) {
    if (l && l.id) logMap[l.id] = l;
  }
  return {
    schemaVersion: state.schemaVersion || 2,
    updatedAt: state.updatedAt || new Date().toISOString(),
    settings: state.settings || {},
    exams: state.exams || {},
    notesMap,
    logMap
  };
}

export function remoteMapToStateShape(remote) {
  if (!remote || typeof remote !== "object") return null;
  const notes = remote.notesMap && typeof remote.notesMap === "object"
    ? Object.values(remote.notesMap).filter((n) => n && !n._deleted)
    : Array.isArray(remote.notes) ? remote.notes : [];
  const activityLog = remote.logMap && typeof remote.logMap === "object"
    ? Object.values(remote.logMap).filter((l) => l && !l._deleted)
    : Array.isArray(remote.activityLog) ? remote.activityLog : [];
  notes.sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  activityLog.sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  return {
    schemaVersion: remote.schemaVersion || 2,
    updatedAt: remote.updatedAt || null,
    settings: remote.settings && typeof remote.settings === "object" ? remote.settings : {},
    exams: remote.exams && typeof remote.exams === "object" ? remote.exams : {},
    notes,
    activityLog
  };
}

function pickNewer(localObj, remoteObj) {
  if (!localObj) return remoteObj;
  if (!remoteObj) return localObj;
  const lt = localObj.updatedAt || "";
  const rt = remoteObj.updatedAt || "";
  return rt >= lt ? remoteObj : localObj;
}

/**
 * Fusión granular sin pérdida de datos entre estado local y remoto:
 * compara timestamps a nivel de configuración compartida, examen, ejercicio individual, notas y sesiones.
 */
export function mergeSyncedStates(localState, remotePayload) {
  const remote = remoteMapToStateShape(remotePayload);
  if (!remote) return localState;

  const merged = structuredClone(localState);

  // Settings compartidos (respetando el tema local de cada dispositivo)
  const localTheme = localState.settings?.theme || "dark";
  const rSet = remote.settings || {};
  const lSet = localState.settings || {};
  const useRemoteSettings = (rSet.updatedAt || "") >= (lSet.updatedAt || "");
  merged.settings = {
    ...(useRemoteSettings ? lSet : rSet),
    ...(useRemoteSettings ? rSet : lSet),
    theme: localTheme
  };

  // Exams + Exercises granulares
  const allExamIds = new Set([...Object.keys(localState.exams || {}), ...Object.keys(remote.exams || {})]);
  const mergedExams = {};
  for (const eid of allExamIds) {
    const le = localState.exams?.[eid];
    const re = remote.exams?.[eid];
    if (!le) { mergedExams[eid] = re; continue; }
    if (!re) { mergedExams[eid] = le; continue; }
    const base = pickNewer(le, re);
    const allQs = new Set([...Object.keys(le.exercises || {}), ...Object.keys(re.exercises || {})]);
    const exercises = {};
    for (const q of allQs) {
      exercises[q] = pickNewer(le.exercises?.[q], re.exercises?.[q]);
    }
    const attMap = new Map();
    for (const a of le.attempts || []) if (a?.id) attMap.set(a.id, a);
    for (const a of re.attempts || []) if (a?.id) attMap.set(a.id, a);
    const attempts = [...attMap.values()].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    mergedExams[eid] = { ...base, exercises, attempts };
  }
  merged.exams = mergedExams;

  // Notes (respeta tombstones _deleted si existieran en el mapa remoto)
  const rawRemoteNotes = remotePayload?.notesMap || {};
  const noteById = new Map();
  for (const n of localState.notes || []) if (n?.id) noteById.set(n.id, n);
  for (const n of remote.notes || []) {
    if (!n?.id) continue;
    noteById.set(n.id, pickNewer(noteById.get(n.id), n));
  }
  for (const [id, rn] of Object.entries(rawRemoteNotes)) {
    if (rn && rn._deleted) {
      const ln = noteById.get(id);
      if (!ln || (rn.updatedAt || "") >= (ln.updatedAt || "")) noteById.delete(id);
    }
  }
  merged.notes = [...noteById.values()].sort((a, b) =>
    (b.date || "").localeCompare(a.date || "") || (b.updatedAt || "").localeCompare(a.updatedAt || "")
  );

  // Activity Log
  const rawRemoteLog = remotePayload?.logMap || {};
  const logById = new Map();
  for (const l of localState.activityLog || []) if (l?.id) logById.set(l.id, l);
  for (const l of remote.activityLog || []) {
    if (!l?.id) continue;
    logById.set(l.id, pickNewer(logById.get(l.id), l));
  }
  for (const [id, rl] of Object.entries(rawRemoteLog)) {
    if (rl && rl._deleted) logById.delete(id);
  }
  merged.activityLog = [...logById.values()].sort((a, b) =>
    (b.date || "").localeCompare(a.date || "") || (b.updatedAt || "").localeCompare(a.updatedAt || "")
  );

  merged.updatedAt = new Date().toISOString();
  return merged;
}

export class FirebaseSyncClient {
  constructor({ onStatus, onRemoteData }) {
    this.onStatus = onStatus || (() => {});
    this.onRemoteData = onRemoteData || (() => {});
    this.config = loadSyncConfig();
    this.eventSource = null;
    this.reconnectTimer = null;
    this.status = "local"; // "local" | "connecting" | "live" | "error"
    this.clientId = `cli_${Math.random().toString(36).slice(2, 8)}`;
  }

  getRoomUrl(subPath = "") {
    const base = normalizeFirebaseUrl(this.config.dbUrl);
    const room = sanitizeRoomCode(this.config.roomCode);
    const suffix = subPath ? `/${subPath.replace(/^\/+/, "")}` : "";
    return `${base}/salas/${encodeURIComponent(room)}${suffix}.json`;
  }

  setStatus(st, detail = "") {
    this.status = st;
    this.onStatus(st, detail);
  }

  async testConnection(dbUrl, roomCode) {
    const url = `${normalizeFirebaseUrl(dbUrl)}/salas/${encodeURIComponent(sanitizeRoomCode(roomCode))}/_ping.json`;
    const res = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ at: new Date().toISOString(), ok: true })
    });
    if (!res.ok) {
      throw new Error(`Firebase respondió HTTP ${res.status}. Revisa la URL y las reglas de Realtime Database.`);
    }
    return true;
  }

  async connect(cfg, localState) {
    this.disconnect();
    this.config = saveSyncConfig(cfg);
    if (!this.config.enabled) {
      this.setStatus("local", "Solo guardado local");
      return null;
    }
    this.setStatus("connecting", "Conectando con Firebase…");
    try {
      const res = await fetch(this.getRoomUrl());
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const remoteData = await res.json();
      if (!remoteData || (!remoteData.exams && !remoteData.notesMap && !remoteData.settings)) {
        // Sala nueva: subir el estado local inicial
        await this.pushFullState(localState);
      } else {
        this.onRemoteData(remoteData, true);
      }
      this.openStream();
      return remoteData;
    } catch (err) {
      this.setStatus("error", err.message || "Error de conexión");
      return null;
    }
  }

  openStream() {
    if (!this.config.enabled || typeof EventSource === "undefined") {
      this.setStatus("live", "Conectado (sin streaming)");
      return;
    }
    try {
      const es = new EventSource(this.getRoomUrl());
      this.eventSource = es;

      es.addEventListener("put", (ev) => {
        this.setStatus("live", "En vivo");
        try {
          const msg = JSON.parse(ev.data);
          if (msg.path === "/" && msg.data) {
            this.onRemoteData(msg.data, false);
          } else if (msg.path && msg.path !== "/") {
            // Re-leer snapshot limpio para aplicar merge seguro
            this.pullOnce();
          }
        } catch {
          // ignorar heartbeat
        }
      });

      es.addEventListener("patch", () => {
        this.setStatus("live", "En vivo");
        this.pullOnce();
      });

      es.onopen = () => this.setStatus("live", "En vivo");

      es.onerror = () => {
        this.setStatus("connecting", "Reconectando…");
        es.close();
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => {
          if (this.config.enabled) this.openStream();
        }, 4000);
      };
    } catch {
      this.setStatus("error", "No se pudo abrir flujo en vivo");
    }
  }

  async pullOnce() {
    if (!this.config.enabled) return;
    try {
      const res = await fetch(this.getRoomUrl());
      if (res.ok) {
        const data = await res.json();
        if (data) this.onRemoteData(data, false);
      }
    } catch {
      // silencioso
    }
  }

  async pushFullState(state) {
    if (!this.config.enabled) return;
    const payload = stateToRemoteMap(state);
    const res = await fetch(this.getRoomUrl(), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error(`Error al guardar en Firebase (HTTP ${res.status})`);
  }

  async patchPath(subPath, data) {
    if (!this.config.enabled) return;
    try {
      await fetch(this.getRoomUrl(subPath), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      });
    } catch {
      this.setStatus("connecting", "Pendiente de reconexión…");
    }
  }

  disconnect() {
    clearTimeout(this.reconnectTimer);
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }
}

export const FIREBASE_RULES_SNIPPET = `{
  "rules": {
    "salas": {
      "$salaId": {
        ".read": true,
        ".write": true
      }
    }
  }
}`;

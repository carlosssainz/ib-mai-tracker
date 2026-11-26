// Motor de sincronización gratuita entre Profesor y Alumno vía Google Drive + Google Apps Script.
// - Sin cuentas nuevas ni servicios de terceros (usa la cuenta de Google del profesor y una carpeta privada de Drive).
// - Peticiones POST con Content-Type: text/plain;charset=utf-8 para evitar CORS preflight (OPTIONS).
// - Polling inteligente adaptable (pausa en pestaña oculta, se acelera tras cambios, backoff ante errores).
// - Fusión granular por marcas de tiempo + botón manual "Sincronizar ahora".

import { APPS_SCRIPT_CODE } from "./apps_script_template.js";

export { APPS_SCRIPT_CODE };

export const SYNC_CONFIG_KEY = "ib_mai_drive_sync_cfg_v1";

export const POLL_INTERVALS = {
  activeMs: 6000,      // 6 s cuando ha habido actividad reciente (< 2 min)
  idleMs: 15000,       // 15 s tras 2 min sin cambios
  deepIdleMs: 30000,   // 30 s tras 10 min sin cambios
  maxBackoffMs: 60000, // Máximo 60 s ante cortes de red
  debouncePushMs: 900  // Agrupa escritura rápida antes de enviar POST
};

export function normalizeScriptUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return "";
  let u = rawUrl.trim();
  if (!u) return "";
  const isLocal = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(u);
  if (!isLocal) {
    if (u.startsWith("http://")) u = "https://" + u.slice(7);
    else if (!u.startsWith("https://")) u = "https://" + u;
  }
  // Eliminar espacios o barras sobrantes al final, conservando la ruta /exec
  u = u.split("#")[0].split("?")[0].replace(/\/+$/, "");
  return u;
}

export function validateScriptUrl(rawUrl) {
  const url = normalizeScriptUrl(rawUrl);
  if (!url) {
    return { ok: false, error: "Pega la URL de tu Aplicación web de Google Apps Script." };
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: "La URL no tiene un formato válido." };
  }
  const isLocal = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (isLocal) {
    return { ok: true, url };
  }
  if (/\/edit$/i.test(parsed.pathname)) {
    return {
      ok: false,
      error: "Has pegado el enlace del editor (/edit). Copia la URL de la Aplicación web que termina en /exec."
    };
  }
  if (parsed.hostname !== "script.google.com" && !parsed.hostname.endsWith(".googleusercontent.com")) {
    return {
      ok: false,
      error: "La URL debe ser una Aplicación web de Google Apps Script (https://script.google.com/macros/s/.../exec)."
    };
  }
  if (!/\/exec$/i.test(parsed.pathname)) {
    return {
      ok: false,
      error: "La URL de Apps Script debe terminar en /exec (cópiala desde Implementar → Aplicación web)."
    };
  }
  return { ok: true, url };
}

export function sanitizeRoomCode(rawCode) {
  return String(rawCode || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

export function generateRoomCode() {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  let suffix = "";
  for (let i = 0; i < 6; i++) {
    suffix += chars[Math.floor(Math.random() * chars.length)];
  }
  return `mai-2027-${suffix}`;
}

export function loadSyncConfig() {
  try {
    const raw = localStorage.getItem(SYNC_CONFIG_KEY);
    if (!raw) return { enabled: false, scriptUrl: "", roomCode: "", role: "profesor" };
    const parsed = JSON.parse(raw);
    const scriptUrl = normalizeScriptUrl(parsed.scriptUrl);
    const roomCode = sanitizeRoomCode(parsed.roomCode);
    return {
      enabled: Boolean(parsed.enabled && scriptUrl && roomCode.length >= 3),
      scriptUrl,
      roomCode,
      role: parsed.role === "alumno" ? "alumno" : "profesor"
    };
  } catch {
    return { enabled: false, scriptUrl: "", roomCode: "", role: "profesor" };
  }
}

export function saveSyncConfig(cfg) {
  const scriptUrl = normalizeScriptUrl(cfg.scriptUrl);
  const roomCode = sanitizeRoomCode(cfg.roomCode);
  const clean = {
    enabled: Boolean(cfg.enabled && scriptUrl && roomCode.length >= 3),
    scriptUrl,
    roomCode,
    role: cfg.role === "alumno" ? "alumno" : "profesor"
  };
  try {
    localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify(clean));
  } catch {
    // ignorar errores de almacenamiento
  }
  return clean;
}

export function encodeInviteLink(baseUrl, scriptUrl, roomCode, role = "alumno") {
  const payload = JSON.stringify({
    u: normalizeScriptUrl(scriptUrl),
    r: sanitizeRoomCode(roomCode),
    v: 3
  });
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
    const scriptUrl = normalizeScriptUrl(parsed.u);
    const roomCode = sanitizeRoomCode(parsed.r);
    if (!scriptUrl || roomCode.length < 3) return null;
    const role = params.get("role") === "profesor" ? "profesor" : "alumno";
    return { enabled: true, scriptUrl, roomCode, role };
  } catch {
    return null;
  }
}

// Convierte el estado local (con arrays) a un mapa por id para fusión segura en Google Drive
export function stateToRemoteMap(state, tombstones = null) {
  const notesMap = {};
  for (const n of state.notes || []) {
    if (n && n.id) notesMap[n.id] = n;
  }
  if (tombstones?.notes) {
    for (const [id, dead] of Object.entries(tombstones.notes)) {
      if (!notesMap[id] || (dead.updatedAt || "") >= (notesMap[id].updatedAt || "")) {
        notesMap[id] = dead;
      }
    }
  }

  const logMap = {};
  for (const l of state.activityLog || []) {
    if (l && l.id) logMap[l.id] = l;
  }
  if (tombstones?.logs) {
    for (const [id, dead] of Object.entries(tombstones.logs)) {
      if (!logMap[id] || (dead.updatedAt || "") >= (logMap[id].updatedAt || "")) {
        logMap[id] = dead;
      }
    }
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
 * compara marcas de tiempo a nivel de ajustes compartidos, examen, ejercicio, notas y sesiones.
 */
export function mergeSyncedStates(localState, remotePayload) {
  const remote = remoteMapToStateShape(remotePayload);
  if (!remote) return localState;

  const merged = structuredClone(localState);

  // Settings compartidos (conservando el tema visual local de cada dispositivo)
  const localTheme = localState.settings?.theme || "dark";
  const rSet = remote.settings || {};
  const lSet = localState.settings || {};
  const useRemoteSettings = (rSet.updatedAt || "") >= (lSet.updatedAt || "");
  merged.settings = {
    ...(useRemoteSettings ? lSet : rSet),
    ...(useRemoteSettings ? rSet : lSet),
    theme: localTheme
  };

  // Exámenes + ejercicios individuales
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

  // Notas (respetando tombstones _deleted)
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

  // Activity Log (respetando tombstones _deleted)
  const rawRemoteLog = remotePayload?.logMap || {};
  const logById = new Map();
  for (const l of localState.activityLog || []) if (l?.id) logById.set(l.id, l);
  for (const l of remote.activityLog || []) {
    if (!l?.id) continue;
    logById.set(l.id, pickNewer(logById.get(l.id), l));
  }
  for (const [id, rl] of Object.entries(rawRemoteLog)) {
    if (rl && rl._deleted) {
      const ll = logById.get(id);
      if (!ll || (rl.updatedAt || "") >= (ll.updatedAt || "")) logById.delete(id);
    }
  }
  merged.activityLog = [...logById.values()].sort((a, b) =>
    (b.date || "").localeCompare(a.date || "") || (b.updatedAt || "").localeCompare(a.updatedAt || "")
  );

  merged.updatedAt = new Date().toISOString();
  return merged;
}

function hasMeaningfulState(st) {
  if (!st || typeof st !== "object") return false;
  if (st.exams && Object.keys(st.exams).length > 0) return true;
  if (Array.isArray(st.notes) && st.notes.length > 0) return true;
  if (Array.isArray(st.activityLog) && st.activityLog.length > 0) return true;
  if (st.settings?.studentName) return true;
  return false;
}

function hasUnsyncedLocalItems(localState, remotePayload) {
  if (!hasMeaningfulState(localState)) return false;
  if (!remotePayload || typeof remotePayload !== "object") return true;

  const rExams = remotePayload.exams || {};
  for (const [eid, le] of Object.entries(localState.exams || {})) {
    const re = rExams[eid];
    if (!re) return true;
    if ((le.updatedAt || "") > (re.updatedAt || "")) return true;
    for (const [q, lex] of Object.entries(le.exercises || {})) {
      const rex = re.exercises?.[q];
      if (!rex || (lex.updatedAt || "") > (rex.updatedAt || "")) return true;
    }
  }

  const rNotes = remotePayload.notesMap || {};
  for (const n of localState.notes || []) {
    if (!n?.id) continue;
    const rn = rNotes[n.id];
    if (!rn || (n.updatedAt || "") > (rn.updatedAt || "")) return true;
  }

  const rLogs = remotePayload.logMap || {};
  for (const l of localState.activityLog || []) {
    if (!l?.id) continue;
    const rl = rLogs[l.id];
    if (!rl || (l.updatedAt || "") > (rl.updatedAt || "")) return true;
  }

  if ((localState.settings?.updatedAt || "") > (remotePayload.settings?.updatedAt || "")) {
    return true;
  }

  return false;
}

export class DriveSyncClient {
  constructor({ onStatus, onRemoteData, getState, fetchImpl } = {}) {
    this.onStatus = onStatus || (() => {});
    this.onRemoteData = onRemoteData || (() => {});
    this.getState = getState || (() => null);
    this.fetchImpl = fetchImpl || ((...args) => fetch(...args));

    this.config = loadSyncConfig();
    this.status = "local"; // "local" | "connecting" | "syncing" | "live" | "error"
    this.lastDetail = "Solo guardado local";
    this.clientId = `cli_${Math.random().toString(36).slice(2, 8)}`;

    this.rev = -1;
    this.lastSyncedAt = null;
    this.lastActivityAt = Date.now();
    this.consecutiveErrors = 0;

    this.dirty = false;
    this.inFlight = false;
    this.pendingPushAfterFlight = false;
    this.tombstones = { notes: {}, logs: {} };

    this.pollTimer = null;
    this.debounceTimer = null;
    this.lifecycleBound = false;

    this._onVisibility = () => this.handleVisibilityChange();
    this._onOnline = () => this.handleOnline();
    this._onFocus = () => this.handleFocus();
    this._onPageHide = () => this.flushOnHide();
  }

  setStatus(st, detail = "") {
    this.status = st;
    this.lastDetail = detail;
    this.onStatus(st, detail, {
      rev: this.rev,
      lastSyncedAt: this.lastSyncedAt,
      dirty: this.dirty
    });
  }

  getNextPollDelayMs(nowMs = Date.now()) {
    if (!this.config.enabled) return null;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return null;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return null;

    if (this.consecutiveErrors > 0) {
      return Math.min(POLL_INTERVALS.maxBackoffMs, 10000 * Math.pow(2, this.consecutiveErrors - 1));
    }

    const idleFor = nowMs - this.lastActivityAt;
    if (idleFor < 2 * 60 * 1000) return POLL_INTERVALS.activeMs;
    if (idleFor < 10 * 60 * 1000) return POLL_INTERVALS.idleMs;
    return POLL_INTERVALS.deepIdleMs;
  }

  async postTextPlain(url, payload, timeoutMs = 15000) {
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timerId = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const res = await this.fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload),
        redirect: "follow",
        ...(controller ? { signal: controller.signal } : {})
      });
      const text = await res.text();
      if (!res.ok) {
        throw new Error(`Google Apps Script respondió HTTP ${res.status}. Verifica la URL /exec y los permisos.`);
      }
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(
          "Google devolvió HTML en lugar de JSON. Revisa que en «Implementar → Aplicación web» esté marcado «Quién tiene acceso: Cualquier persona»."
        );
      }
      if (!data || data.ok === false) {
        throw new Error(data?.error || "El script de Google Drive devolvió un error.");
      }
      return data;
    } catch (err) {
      if (err?.name === "AbortError") {
        throw new Error("Tiempo de espera agotado al conectar con Google Drive.");
      }
      throw err;
    } finally {
      if (timerId) clearTimeout(timerId);
    }
  }

  async testConnection(scriptUrl, roomCode) {
    const check = validateScriptUrl(scriptUrl);
    if (!check.ok) throw new Error(check.error);
    const cleanRoom = sanitizeRoomCode(roomCode);
    if (cleanRoom.length < 3) {
      throw new Error("El código de sala debe tener al menos 3 caracteres (ej. mai-2027-carlos).");
    }
    return this.postTextPlain(check.url, {
      action: "ping",
      room: cleanRoom
    });
  }

  async connect(cfg, localState) {
    this.disconnect();
    this.config = saveSyncConfig(cfg);
    if (!this.config.enabled) {
      this.setStatus("local", "Solo guardado local");
      return null;
    }

    this.bindLifecycle();
    this.rev = -1;
    this.consecutiveErrors = 0;
    this.lastActivityAt = Date.now();
    this.setStatus("connecting", "Conectando con Google Drive…");

    try {
      const pulled = await this.postTextPlain(this.config.scriptUrl, {
        action: "pull",
        room: this.config.roomCode,
        sinceRev: -1
      });

      this.rev = Number.isFinite(Number(pulled.rev)) ? Number(pulled.rev) : 0;
      this.lastSyncedAt = pulled.updatedAt || new Date().toISOString();

      const localSnap = localState || this.getState();
      if (!pulled.data) {
        if (hasMeaningfulState(localSnap)) {
          await this.pushFullState(localSnap, { silent: true });
        }
      } else {
        const needsPushBack = hasUnsyncedLocalItems(localSnap, pulled.data);
        this.onRemoteData(pulled.data, true);
        if (needsPushBack) {
          const postMerge = this.getState() || localSnap;
          await this.pushFullState(postMerge, { silent: true });
        }
      }

      this.setStatus("live", "Sincronizado con Drive");
      this.scheduleNextPoll();
      return pulled.data || null;
    } catch (err) {
      this.consecutiveErrors++;
      this.setStatus("error", err.message || "Error al conectar con Drive");
      this.scheduleNextPoll();
      return null;
    }
  }

  queueLocalMutation(subPath, payload) {
    if (!this.config.enabled) return;
    this.dirty = true;
    this.lastActivityAt = Date.now();

    if (typeof subPath === "string" && payload && payload._deleted) {
      if (subPath.startsWith("notesMap/")) {
        const id = subPath.slice("notesMap/".length);
        this.tombstones.notes[id] = payload;
      } else if (subPath.startsWith("logMap/")) {
        const id = subPath.slice("logMap/".length);
        this.tombstones.logs[id] = payload;
      }
    }

    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      const current = this.getState();
      if (current) this.pushFullState(current, { silent: true });
    }, POLL_INTERVALS.debouncePushMs);
  }

  async pushFullState(state, { silent = true } = {}) {
    if (!this.config.enabled || !state) return null;
    if (this.inFlight) {
      this.pendingPushAfterFlight = true;
      this.dirty = true;
      return null;
    }

    clearTimeout(this.debounceTimer);
    clearTimeout(this.pollTimer);
    this.inFlight = true;
    this.pendingPushAfterFlight = false;
    this.lastActivityAt = Date.now();
    this.setStatus("syncing", "Guardando en Drive…");

    const prevRev = this.rev;
    const payload = stateToRemoteMap(state, this.tombstones);

    try {
      const res = await this.postTextPlain(this.config.scriptUrl, {
        action: "push",
        room: this.config.roomCode,
        role: this.config.role,
        clientId: this.clientId,
        state: payload
      });

      this.dirty = false;
      this.consecutiveErrors = 0;
      this.rev = Number.isFinite(Number(res.rev)) ? Number(res.rev) : prevRev + 1;
      this.lastSyncedAt = res.updatedAt || new Date().toISOString();

      // Si el servidor fusionó cambios intermedios del otro dispositivo, aplicamos la versión autoritativa
      if (res.data && prevRev >= 0 && this.rev > prevRev + 1) {
        this.onRemoteData(res.data, silent);
      }

      this.setStatus("live", "Sincronizado con Drive");
      return res;
    } catch (err) {
      this.dirty = true;
      this.consecutiveErrors++;
      this.setStatus("error", err.message || "Error al guardar en Drive");
      return null;
    } finally {
      this.inFlight = false;
      if (this.pendingPushAfterFlight && this.config.enabled) {
        this.pendingPushAfterFlight = false;
        const latest = this.getState();
        if (latest) {
          this.pushFullState(latest, { silent: true });
          return;
        }
      }
      this.scheduleNextPoll();
    }
  }

  async pullOnce({ force = false, silent = true } = {}) {
    if (!this.config.enabled || this.inFlight) return { ok: false, skipped: true };

    if (this.dirty) {
      const st = this.getState();
      if (st) return this.pushFullState(st, { silent });
    }

    clearTimeout(this.pollTimer);
    this.inFlight = true;
    const prevRev = this.rev;
    if (!silent) this.setStatus("syncing", "Comprobando cambios en Drive…");

    try {
      const res = await this.postTextPlain(this.config.scriptUrl, {
        action: "pull",
        room: this.config.roomCode,
        sinceRev: force ? -1 : this.rev
      });

      this.consecutiveErrors = 0;
      this.lastSyncedAt = new Date().toISOString();
      const nextRev = Number.isFinite(Number(res.rev)) ? Number(res.rev) : this.rev;
      const hasNewRevision = Boolean(res.data && nextRev !== prevRev);

      this.rev = nextRev;
      if (res.data && (hasNewRevision || force)) {
        if (hasNewRevision) this.lastActivityAt = Date.now();
        this.onRemoteData(res.data, !hasNewRevision || silent);
      }

      this.setStatus("live", "Sincronizado con Drive");
      return { ok: true, changed: hasNewRevision, rev: this.rev, lastSyncedAt: this.lastSyncedAt };
    } catch (err) {
      this.consecutiveErrors++;
      this.setStatus("error", err.message || "Error al consultar Drive");
      return { ok: false, error: err.message };
    } finally {
      this.inFlight = false;
      this.scheduleNextPoll();
    }
  }

  async syncNow(stateOverride = null) {
    if (!this.config.enabled) {
      return { ok: false, error: "Sincronización no configurada" };
    }
    clearTimeout(this.debounceTimer);
    clearTimeout(this.pollTimer);
    this.lastActivityAt = Date.now();
    this.consecutiveErrors = 0;

    if (this.dirty) {
      const st = stateOverride || this.getState();
      const res = await this.pushFullState(st, { silent: false });
      return res
        ? { ok: true, pushed: true, rev: this.rev, lastSyncedAt: this.lastSyncedAt }
        : { ok: false, error: this.lastDetail };
    }

    return this.pullOnce({ force: true, silent: false });
  }

  scheduleNextPoll() {
    clearTimeout(this.pollTimer);
    const delay = this.getNextPollDelayMs();
    if (delay === null) return;
    this.pollTimer = setTimeout(() => {
      if (this.config.enabled && !this.inFlight) {
        this.pullOnce({ force: false, silent: false });
      }
    }, delay);
  }

  handleVisibilityChange() {
    if (!this.config.enabled) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      clearTimeout(this.pollTimer);
      this.flushOnHide();
    } else {
      this.lastActivityAt = Date.now();
      this.pullOnce({ force: false, silent: true });
    }
  }

  handleFocus() {
    if (!this.config.enabled) return;
    const sinceSync = this.lastSyncedAt ? Date.now() - new Date(this.lastSyncedAt).getTime() : Infinity;
    if (sinceSync > POLL_INTERVALS.activeMs) {
      this.lastActivityAt = Date.now();
      this.pullOnce({ force: false, silent: true });
    }
  }

  handleOnline() {
    if (!this.config.enabled) return;
    this.consecutiveErrors = 0;
    this.lastActivityAt = Date.now();
    this.syncNow();
  }

  flushOnHide() {
    if (!this.config.enabled || !this.dirty) return;
    const st = this.getState();
    if (!st) return;
    try {
      if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
        const body = JSON.stringify({
          action: "push",
          room: this.config.roomCode,
          role: this.config.role,
          clientId: this.clientId,
          state: stateToRemoteMap(st, this.tombstones)
        });
        const blob = new Blob([body], { type: "text/plain;charset=utf-8" });
        if (navigator.sendBeacon(this.config.scriptUrl, blob)) {
          this.dirty = false;
        }
      }
    } catch {
      // ignorar si el navegador cancela el envío al cerrar
    }
  }

  bindLifecycle() {
    if (this.lifecycleBound || typeof window === "undefined") return;
    this.lifecycleBound = true;
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this._onVisibility);
    }
    window.addEventListener("online", this._onOnline);
    window.addEventListener("focus", this._onFocus);
    window.addEventListener("pagehide", this._onPageHide);
  }

  unbindLifecycle() {
    if (!this.lifecycleBound || typeof window === "undefined") return;
    this.lifecycleBound = false;
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this._onVisibility);
    }
    window.removeEventListener("online", this._onOnline);
    window.removeEventListener("focus", this._onFocus);
    window.removeEventListener("pagehide", this._onPageHide);
  }

  disconnect() {
    clearTimeout(this.pollTimer);
    clearTimeout(this.debounceTimer);
    this.pollTimer = null;
    this.debounceTimer = null;
    this.inFlight = false;
    this.pendingPushAfterFlight = false;
    this.dirty = false;
    this.rev = -1;
    this.consecutiveErrors = 0;
    this.unbindLifecycle();
  }
}

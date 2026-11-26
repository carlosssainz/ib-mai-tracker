import {
  DRIVE_ROOT_URL,
  EXAMS,
  EXTRA_RESOURCES,
  MAI_TOPICS,
  NOTE_CATEGORIES,
  EXAM_STATUSES,
  EXERCISE_STATUSES,
  PRACTICE_MODES,
  SYLLABUS_LEVELS,
  GDC_CHEATSHEET
} from "./data.js";

import {
  SUBTOPICS,
  SUBTOPIC_MAP,
  EXERCISE_CATALOG
} from "./exercises_catalog.js";

import {
  IB_CURVE_PRESETS,
  IB_MISTAKES,
  IB_MISTAKE_MAP,
  suggestScoreFromMistakes,
  getIBGradeDescription,
  formatDurationCompact,
  normalizeBoundaries
} from "./ib_grading.js";

import { PracticeTimer } from "./timer.js";

import {
  DriveSyncClient,
  APPS_SCRIPT_CODE,
  loadSyncConfig,
  saveSyncConfig,
  validateScriptUrl,
  generateRoomCode,
  encodeInviteLink,
  parseInviteFromSearch,
  mergeSyncedStates
} from "./sync.js";

import {
  loadState,
  saveState,
  sanitizeState,
  createDefaultState,
  createDefaultSyllabusMap,
  todayISO,
  setMutationHook,
  getExamDef,
  ensureExamRecord,
  getQuestionMaxMarks,
  getExerciseMeta,
  getExamDerived,
  updateSettings,
  updateExamFields,
  updateExercise,
  applyExerciseSumToExam,
  saveExamAttempt,
  logExercisesSession,
  deleteActivityEntry,
  deleteAttempt,
  addOrUpdateNote,
  toggleNoteField,
  deleteNote,
  getAllCatalogExercises,
  getReviewQueue,
  getExamAndExerciseNotes,
  getGlobalStats,
  buildExportPayload,
  importBackupJSON,
  buildCSVExport
} from "./store.js";

import {
  renderEvolutionChart,
  renderTopicsMastery,
  renderTopMistakes
} from "./charts.js";

const TOPIC_MAP = Object.fromEntries(MAI_TOPICS.map((t) => [t.id, t]));
const NOTE_CAT_MAP = Object.fromEntries(NOTE_CATEGORIES.map((c) => [c.id, c]));
const MODE_MAP = Object.fromEntries(PRACTICE_MODES.map((m) => [m.id, m]));
const EXAM_STATUS_MAP = Object.fromEntries(EXAM_STATUSES.map((s) => [s.id, s]));

let state = loadState();
let syncConfig = loadSyncConfig();
let currentView = "exams";
let openExamId = null;
let hideOutInDrawer = true;
let bankPageLimit = 60;
let toastTimer = null;
const expandedMistakeRows = new Set();

const filters = {
  category: "all",
  search: "",
  examSubtopic: "all",
  paper: "all",
  status: "all",
  sort: "newest",
  bankScope: "visto",
  bankSearch: "",
  bankTopic: "all",
  bankSubtopic: "all",
  bankStatus: "all",
  bankSol: "all",
  queueTopic: "all",
  noteScope: "all",
  noteSearch: "",
  noteCategory: "all",
  noteTopic: "all"
};

function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function showToast(msg) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("is-visible"), 2800);
}

function formatDateES(iso) {
  if (!iso) return "";
  const parts = iso.split("-");
  if (parts.length !== 3) return iso;
  const months = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  return `${Number(parts[2])} ${months[Number(parts[1]) - 1] || parts[1]} ${parts[0]}`;
}

function formatClockTime(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return "";
  }
}

function roleLabel(role) {
  return role === "alumno" ? "Alumno" : "Profesor";
}

function canSeeSolutions() {
  return !(syncConfig.role === "alumno" && state.settings.hideSolutionsForStudent);
}

function gradeBadgeClass(grade) {
  if (!grade) return "";
  if (grade >= 6) return "ib-badge--high";
  if (grade >= 4) return "ib-badge--mid";
  return "ib-badge--low";
}

function statusPillClass(status) {
  if (status === "completado") return "pill-subtle--good";
  if (status === "en-progreso") return "pill-subtle--info";
  if (status === "repasar") return "pill-subtle--warn";
  return "";
}

/* ==========================================================================
   Google Drive + Apps Script Sync Setup (sin cuentas nuevas)
   ========================================================================== */

function updateSyncUI(st, detail, meta = {}) {
  const pill = document.getElementById("btn-sync-pill");
  const txt = document.getElementById("sync-pill-text");
  const topNowBtn = document.getElementById("btn-sync-now-top");
  const modalNowBtn = document.getElementById("btn-sync-now-modal");
  const modalDot = document.getElementById("sync-modal-dot");
  const modalTitle = document.getElementById("sync-modal-title");
  const modalBadge = document.getElementById("sync-modal-badge");
  const modalSub = document.getElementById("sync-modal-sub");
  const discBtn = document.getElementById("btn-sync-disconnect");

  const isSpinning = st === "connecting" || st === "syncing";
  const isLive = st === "live";
  const isErr = st === "error";
  const enabled = Boolean(syncConfig.enabled);

  if (pill && txt) {
    pill.classList.toggle("pill-chip--live", isLive || isSpinning);
    pill.classList.toggle("pill-chip--error", isErr);
    txt.textContent = !enabled
      ? "Sync Drive"
      : isSpinning
        ? "Sincronizando…"
        : isLive
          ? "Drive · Activo"
          : isErr
            ? "Error Drive"
            : "Sync Drive";
    const timeStr = meta.lastSyncedAt ? ` · Última: ${formatClockTime(meta.lastSyncedAt)}` : "";
    pill.title = `${detail || txt.textContent}${timeStr}`;
  }

  if (topNowBtn) {
    topNowBtn.hidden = !enabled;
    topNowBtn.classList.toggle("is-spinning", isSpinning);
    topNowBtn.disabled = isSpinning;
  }

  if (modalNowBtn) {
    modalNowBtn.classList.toggle("is-spinning", isSpinning);
    modalNowBtn.disabled = isSpinning;
  }

  if (modalDot) {
    modalDot.className = `status-dot-lg ${isLive || isSpinning ? "status-dot-lg--live" : isErr ? "status-dot-lg--error" : ""}`;
  }

  if (modalTitle) {
    modalTitle.textContent = !enabled
      ? "Solo guardado local"
      : isLive
        ? "Conectado con tu Google Drive"
        : isSpinning
          ? "Sincronizando con Google Drive…"
          : "Revisa la conexión con Drive";
  }

  if (modalBadge) {
    if (!enabled) {
      modalBadge.textContent = "Sin configurar";
      modalBadge.className = "pill-subtle";
    } else if (isLive) {
      modalBadge.textContent = `Sala: ${syncConfig.roomCode}`;
      modalBadge.className = "pill-subtle pill-subtle--good";
    } else if (isSpinning) {
      modalBadge.textContent = "Sincronizando…";
      modalBadge.className = "pill-subtle pill-subtle--info";
    } else {
      modalBadge.textContent = "Error de conexión";
      modalBadge.className = "pill-subtle pill-subtle--bad";
    }
  }

  if (modalSub) {
    if (!enabled) {
      modalSub.textContent =
        "Sincroniza gratis entre tu ordenador y tu alumno usando tu propio Google Drive (carpeta privada aparte de EXÁMENES EST MATEMATICOS).";
    } else if (isErr) {
      modalSub.textContent = detail || "No se pudo contactar con el script de Google Drive.";
    } else {
      const clock = meta.lastSyncedAt ? `Última sincronización: ${formatClockTime(meta.lastSyncedAt)}. ` : "";
      modalSub.textContent = `${clock}Polling inteligente activo: se actualiza solo cuando la pestaña está abierta y guarda tus cambios sin pisarse.`;
    }
  }

  if (discBtn) {
    discBtn.hidden = !enabled;
  }
}

const syncClient = new DriveSyncClient({
  getState: () => state,
  onStatus: (st, detail, meta) => updateSyncUI(st, detail, meta),
  onRemoteData: (remoteData, isSilent) => {
    const merged = sanitizeState(mergeSyncedStates(state, remoteData));
    state = merged;
    saveState(state);
    const activeTag = document.activeElement?.tagName;
    const isTyping = activeTag === "INPUT" || activeTag === "TEXTAREA";
    renderAll();
    if (openExamId && !isTyping) renderExamDrawer();
    if (!isSilent) showToast("Actualizado desde Google Drive");
  }
});

setMutationHook((subPath, payload) => {
  if (syncClient.config.enabled) {
    syncClient.queueLocalMutation(subPath, payload);
  }
});

async function handleSyncNow() {
  if (!syncConfig.enabled) {
    openSettingsModal("sync");
    showToast("Configura primero tu URL de Google Apps Script en el paso 4");
    return;
  }
  const res = await syncClient.syncNow(state);
  if (!res || !res.ok) {
    showToast(res?.error || "No se pudo sincronizar con Google Drive");
  } else if (res.pushed) {
    showToast("Cambios guardados en Google Drive ✓");
  } else if (res.changed) {
    showToast("Nuevos cambios traídos desde Drive ✓");
  } else {
    showToast("Todo está al día ✓");
  }
}

/* ==========================================================================
   Exercise & Mock Timer HUD
   ========================================================================== */

const timer = new PracticeTimer(
  (snap) => renderTimerHud(snap),
  (snap) => showToast(`⏱ Tiempo óptimo completado en ${snap.meta?.label || "ejercicio"}`)
);

function renderTimerHud(snap) {
  const hud = document.getElementById("timer-hud");
  if (!hud) return;
  if (!snap.active) {
    hud.classList.remove("is-open", "timer-hud--warning", "timer-hud--overtime");
    return;
  }
  hud.classList.add("is-open");
  hud.classList.toggle("timer-hud--warning", snap.phase === "warning");
  hud.classList.toggle("timer-hud--overtime", snap.phase === "overtime");

  const clockEl = document.getElementById("timer-clock");
  clockEl.textContent = snap.overtimeSec > 0
    ? `+${formatDurationCompact(snap.overtimeSec)}`
    : formatDurationCompact(snap.remainingSec);

  document.getElementById("timer-label").textContent = snap.meta?.label || "Práctica";
  document.getElementById("timer-sub").textContent = snap.overtimeSec > 0
    ? `Tiempo extra · Óptimo: ${formatDurationCompact(snap.optimalSec)} · Transcurrido: ${formatDurationCompact(snap.elapsedSec)}`
    : `Óptimo IB: ${formatDurationCompact(snap.optimalSec)} · Transcurrido: ${formatDurationCompact(snap.elapsedSec)}`;

  document.getElementById("btn-timer-toggle").textContent = snap.running ? "Pausar" : "Reanudar";
  document.getElementById("btn-timer-mute").textContent = snap.muted ? "🔕" : "🔔";
  document.getElementById("timer-bar-fill").style.width = `${Math.round(snap.ratio * 100)}%`;
}

function startExerciseTimer(examId, qNum) {
  const def = getExamDef(examId);
  if (!def) return;
  const rec = state.exams[examId];
  const ex = rec?.exercises?.[String(qNum)];
  const meta = getExerciseMeta(examId, qNum, ex, state.settings.syllabusStatus);
  const optimalSec = Math.round((meta.optimalMin || 6) * 60);
  timer.start({
    mode: "exercise",
    examId,
    qNum,
    label: `${def.shortTitle} · Ej. ${qNum}`,
    optimalSec,
    initialElapsedSec: ex?.timeSpentSec || 0
  });
  showToast(`Temporizador iniciado: ${meta.optimalMin} min óptimos`);
}

function startExamMockTimer(examId) {
  const def = getExamDef(examId);
  if (!def) return;
  timer.start({
    mode: "exam",
    examId,
    qNum: null,
    label: `Simulacro · ${def.shortTitle}`,
    optimalSec: 90 * 60,
    initialElapsedSec: 0
  });
  showToast("Simulacro de 90 minutos iniciado");
}

/* ==========================================================================
   Unified Overview Bar: Countdowns + MAI 2026 Coverage
   ========================================================================== */

function computeCountdownDisplay(targetDateStr) {
  if (!targetDateStr) return { num: "—", unit: "", sub: "Sin fecha" };
  const now = new Date();
  const target = new Date(`${targetDateStr}T09:00:00`);
  const diffMs = target.getTime() - now.getTime();
  if (diffMs <= 0) {
    const daysPast = Math.floor(Math.abs(diffMs) / 86400000);
    return daysPast === 0
      ? { num: "¡HOY!", unit: "", sub: "Día de examen" }
      : { num: "PASADO", unit: "", sub: `Hace ${daysPast} d` };
  }
  const days = Math.floor(diffMs / 86400000);
  const hours = Math.floor((diffMs % 86400000) / 3600000);
  return {
    num: String(days),
    unit: days === 1 ? "día" : "días",
    sub: days < 45 ? `${formatDateES(targetDateStr)} · ${hours} h` : `${formatDateES(targetDateStr)} · ${Math.round(days / 7)} sem.`
  };
}

function renderHudStrip() {
  const cd = state.settings.countdowns;
  const mockDisp = computeCountdownDisplay(cd.mock?.date);
  const offDisp = computeCountdownDisplay(cd.official?.date);
  const stats = getGlobalStats(state);
  const covPct = stats.vistoTotal > 0 ? Math.round((stats.vistoDone / stats.vistoTotal) * 100) : 0;

  document.getElementById("hud-strip").innerHTML = `
    <div class="ov-segment">
      <div class="ov-head">
        <span class="ov-kicker"><i class="ov-dot ov-dot--mock"></i>${esc(cd.mock?.label || "Simulacro Colegio")}</span>
        <button type="button" class="btn btn-ghost btn-xs" data-edit-cd="1" title="Editar fechas de contadores">Editar</button>
      </div>
      <div class="ov-value-row">
        <span class="ov-num tabular">${esc(mockDisp.num)} <span class="ov-num-unit">${esc(mockDisp.unit)}</span></span>
        <span class="ov-detail tabular">${esc(cd.mock?.detail || mockDisp.sub)}</span>
      </div>
    </div>

    <div class="ov-segment">
      <div class="ov-head">
        <span class="ov-kicker"><i class="ov-dot ov-dot--official"></i>${esc(cd.official?.label || "Examen Oficial IB")}</span>
        <span class="ov-detail tabular" style="white-space:nowrap">${esc(formatDateES(cd.official?.date))}</span>
      </div>
      <div class="ov-value-row">
        <span class="ov-num tabular">${esc(offDisp.num)} <span class="ov-num-unit">${esc(offDisp.unit)}</span></span>
        <span class="ov-detail">${esc(cd.official?.detail || offDisp.sub)}</span>
      </div>
    </div>

    <div class="ov-segment">
      <div class="ov-head">
        <span class="ov-kicker"><i class="ov-dot ov-dot--coverage"></i>Cobertura temario visto (MAI 2026)</span>
        <button type="button" class="btn btn-ghost btn-xs" id="btn-hud-jump-bank">Por Temas →</button>
      </div>
      <div class="ov-value-row">
        <span class="ov-num tabular">${stats.vistoDone} <span class="ov-num-unit">/ ${stats.vistoTotal}</span></span>
        <span class="ov-detail tabular"><strong>${covPct}%</strong> visto · ${stats.maiDone}/${stats.maiTotal} total MAI</span>
      </div>
      <div class="ov-bar-track"><div class="ov-bar-fill" style="width:${covPct}%"></div></div>
    </div>
  `;

  document.querySelectorAll("[data-edit-cd]").forEach((b) => {
    b.addEventListener("click", openCountdownModal);
  });
  const jumpBtn = document.getElementById("btn-hud-jump-bank");
  if (jumpBtn) jumpBtn.addEventListener("click", () => switchView("bank"));
}

/* ==========================================================================
   Theme, Role, Badges & KPIs
   ========================================================================== */

function applyTheme() {
  const theme = state.settings.theme === "light" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", theme);
  const btn = document.getElementById("btn-toggle-theme");
  if (btn) {
    btn.textContent = theme === "dark" ? "☀" : "☾";
    btn.title = theme === "dark" ? "Cambiar a Vice Daylight (claro)" : "Cambiar a Leonida Night (oscuro)";
  }
}

function updateBrandAndBadges() {
  const stats = getGlobalStats(state);
  const sub = document.getElementById("brand-subtitle");
  sub.textContent = state.settings.studentName
    ? `${state.settings.studentName} · MAI NM 2026`
    : "MAI Nivel Medio · 2026";

  document.getElementById("badge-exams").textContent = `${stats.examsWorked}/${stats.examsTotal}`;
  const bankMaiCount = getAllCatalogExercises(state).filter((x) => x.mai2026 === "in").length;
  document.getElementById("badge-bank").textContent = String(bankMaiCount);

  const reviewBadge = document.getElementById("badge-review");
  reviewBadge.textContent = String(stats.reviewQueueCount);
  reviewBadge.classList.toggle("nav-badge--warn", stats.reviewQueueCount > 0);

  const notesBadge = document.getElementById("badge-notes");
  notesBadge.textContent = String(stats.pendingNotesCount);
  notesBadge.classList.toggle("nav-badge--warn", stats.pendingNotesCount > 0);

  const roleBtn = document.getElementById("btn-role-pill");
  if (roleBtn) {
    const isAlumno = syncConfig.role === "alumno";
    roleBtn.textContent = isAlumno ? "Alumno" : "Profesor";
    roleBtn.className = `pill-chip ${isAlumno ? "pill-chip--role-alumno" : "pill-chip--role-prof"}`;
  }
}

function renderKPIs() {
  const s = getGlobalStats(state);
  const avgGradeText = s.avgIbGrade !== null ? `IB ${s.avgIbGrade}` : "—";
  const avgPctText = s.avgPercent !== null ? `${s.avgPercent}% de media` : "Puntúa ejercicios del 1 al 10";
  const topErr = s.topMistakes[0]
    ? `Más común: ${s.topMistakes[0].short} (${s.topMistakes[0].count}×)`
    : "Sin fallos marcados";

  document.getElementById("kpi-strip").innerHTML = `
    <div class="kpi-card">
      <div class="kpi-label">Exámenes iniciados</div>
      <div class="kpi-value tabular">${s.examsWorked} <span class="ov-num-unit">/ ${s.examsTotal}</span></div>
      <div class="kpi-sub">${s.examsCompleted} completado${s.examsCompleted === 1 ? "" : "s"}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Ejercicios practicados</div>
      <div class="kpi-value tabular">${s.exercisesDone}</div>
      <div class="kpi-sub">${s.exercisesBien} bien · ${s.exercisesRepasar} repasar · ${s.exercisesFallado} duda</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Nota IB proyectada</div>
      <div class="kpi-value tabular">${avgGradeText}</div>
      <div class="kpi-sub">${avgPctText}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Cola de repaso</div>
      <div class="kpi-value tabular">${s.reviewQueueCount}</div>
      <div class="kpi-sub">${esc(topErr)}</div>
    </div>
  `;
}

/* ==========================================================================
   View 1: Exámenes Catalog (limpio, sin sobrecarga de etiquetas)
   ========================================================================== */

function renderCategoryPills() {
  const counts = {
    all: EXAMS.length,
    "mai-2021": EXAMS.filter((e) => e.category === "mai-2021").length,
    "con-solucion": EXAMS.filter((e) => e.category === "con-solucion").length,
    "solo-enunciado": EXAMS.filter((e) => e.category === "solo-enunciado").length,
    "retos-otros": EXAMS.filter((e) => e.category === "retos-otros").length
  };
  const defs = [
    { id: "all", label: "Todos" },
    { id: "mai-2021", label: "MAI NM 2021" },
    { id: "con-solucion", label: "Con soluciones (2015–18)" },
    { id: "solo-enunciado", label: "Solo enunciados (2000–16)" },
    { id: "retos-otros", label: "Retos / Otros" }
  ];
  document.getElementById("category-pills").innerHTML = defs.map((d) => `
    <button type="button" class="pill ${filters.category === d.id ? "is-active" : ""}" data-cat="${d.id}">
      ${esc(d.label)} <span class="pill-count">${counts[d.id]}</span>
    </button>
  `).join("");
}

function renderExtraResources() {
  const showStrip = filters.category === "all" || filters.category === "retos-otros";
  const host = document.getElementById("extra-resources-strip");
  if (!showStrip || !EXTRA_RESOURCES.length) {
    host.innerHTML = "";
    return;
  }
  const g = EXTRA_RESOURCES[0];
  const guideItems = EXERCISE_CATALOG["guia-funciones-derivadas"] || [];
  const guideIn = guideItems.filter((x) => x.mai2026 === "in").length;
  host.innerHTML = `
    <div class="resource-strip">
      <div class="resource-strip-main">
        <span class="pill-subtle pill-subtle--info">Guía TI-84</span>
        <div>
          <strong>${esc(g.title)}</strong>
          <span class="muted"> · ${guideItems.length} problemas (${guideIn} de MAI 2026)</span>
        </div>
      </div>
      <div class="btn-row">
        <button type="button" class="btn btn-soft btn-sm" id="btn-open-guide-drawer">Registrar ejercicios</button>
        <a class="btn btn-ghost btn-sm" href="${esc(g.url)}" target="_blank" rel="noopener">Abrir PDF ↗</a>
      </div>
    </div>
  `;
  document.getElementById("btn-open-guide-drawer").addEventListener("click", () => openExamDrawer("guia-funciones-derivadas"));
}

function getFilteredExams() {
  const q = filters.search.trim().toLowerCase();
  const boundaries = state.settings.gradeBoundaries;
  const syllabus = state.settings.syllabusStatus;

  const list = EXAMS.map((def) => {
    const rec = state.exams[def.id];
    const derived = getExamDerived(def, rec, boundaries, syllabus);
    return { def, rec, derived };
  }).filter(({ def, rec, derived }) => {
    if (filters.category !== "all" && def.category !== filters.category) return false;
    if (filters.paper !== "all" && String(def.paper) !== filters.paper) return false;
    if (filters.status !== "all" && derived.status !== filters.status) return false;
    if (filters.examSubtopic !== "all" && !derived.subtopics.includes(filters.examSubtopic)) return false;
    if (q) {
      const stLabels = derived.subtopics.map((id) => SUBTOPIC_MAP[id]?.label || id).join(" ");
      const hay = [def.title, def.folderLabel, def.subject, String(def.year), def.session, `p${def.paper}`, stLabels, rec?.examNotes || ""].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  if (filters.sort === "oldest") {
    list.sort((a, b) => a.def.year - b.def.year || a.def.sessionNum - b.def.sessionNum || a.def.paper - b.def.paper);
  } else if (filters.sort === "practiced") {
    list.sort((a, b) => (b.derived.lastPracticed || "").localeCompare(a.derived.lastPracticed || "") || b.def.year - a.def.year);
  } else if (filters.sort === "grade-asc") {
    list.sort((a, b) => (a.derived.ibGrade ?? 99) - (b.derived.ibGrade ?? 99));
  } else {
    list.sort((a, b) => b.def.year - a.def.year || b.def.sessionNum - a.def.sessionNum || a.def.paper - b.def.paper);
  }
  return list;
}

function renderExamList() {
  const items = getFilteredExams();
  const showSol = canSeeSolutions();
  document.getElementById("catalog-count").textContent = `Mostrando ${items.length} de ${EXAMS.length} exámenes`;

  const host = document.getElementById("exam-list");
  if (items.length === 0) {
    host.innerHTML = `<div class="empty-state"><strong>No hay exámenes con estos filtros.</strong><p class="chart-empty-sub">Prueba a cambiar el subtema o limpiar la búsqueda.</p></div>`;
    return;
  }

  host.innerHTML = items.map(({ def, derived }) => {
    const denom = derived.totalQuestions || 1;
    const pBien = (derived.bienCount / denom) * 100;
    const pRep = (derived.repasarCount / denom) * 100;
    const pFail = (derived.falladoCount / denom) * 100;
    const statusObj = EXAM_STATUS_MAP[derived.status] || EXAM_STATUSES[0];

    // Máximo 1 etiqueta discreta junto al título; el resto va en línea tipográfica limpia
    const primaryBadge = derived.status !== "pendiente"
      ? `<span class="pill-subtle ${statusPillClass(derived.status)}">${esc(statusObj.label)}</span>`
      : def.subject === "MAI NM"
        ? `<span class="pill-subtle pill-subtle--mai">MAI NM</span>`
        : "";

    const subjectText = def.subject === "Matemáticas NM" && !def.calculator
      ? "Mat. NM (sin calc.)"
      : def.subject;

    const maiSummary = derived.maiInCount === 0
      ? `0/${derived.totalQuestions} MAI 2026`
      : derived.maiOutCount > 0
        ? `${derived.maiInCount}/${derived.totalQuestions} MAI 2026`
        : "100% MAI 2026";

    const metaParts = [
      esc(subjectText),
      esc(maiSummary),
      def.hasSolution ? `<span><i class="meta-dot meta-dot--good"></i>Con solución</span>` : null,
      derived.lastPracticed ? esc(formatDateES(derived.lastPracticed)) : null
    ].filter(Boolean);

    const topSubs = derived.subtopics
      .filter((id) => SUBTOPIC_MAP[id]?.mai2026)
      .slice(0, 3)
      .map((id) => SUBTOPIC_MAP[id].label)
      .join(" · ");

    const effPct = derived.percent ?? derived.projectedPercent;
    const scorePrimary = derived.score !== null
      ? `${derived.score}/${derived.maxMarks}`
      : derived.hasExercisePoints
        ? `~${derived.exercisePointsEarned}/${derived.exercisePointsMax}`
        : derived.ibGrade
          ? `IB ${derived.ibGrade}`
          : "Sin nota";
    const scoreSecondary = effPct !== null
      ? `${effPct}%${derived.isProjectedOnly ? " proy." : ""}`
      : `${derived.maxMarks} pts máx.`;

    return `
      <article class="exam-row" data-exam-id="${esc(def.id)}" tabindex="0" role="button">
        <div>
          <div class="exam-title-line">
            <span class="exam-title">${esc(def.year)} ${esc(def.session)} · Prueba ${def.paper}</span>
            ${primaryBadge}
          </div>
          <div class="meta-line exam-meta-sub">${metaParts.join(`<span class="meta-sep">·</span>`)}</div>
          ${topSubs ? `<div class="exam-topics-line">${esc(topSubs)}</div>` : ""}
        </div>

        <div class="exam-progress-col">
          <div class="mini-progress-label tabular">
            <span><strong>${derived.doneCount}</strong> / ${derived.totalQuestions} ej.</span>
            <span class="muted">${derived.bienCount ? `${derived.bienCount}✓` : ""} ${derived.repasarCount ? `${derived.repasarCount}!` : ""} ${derived.falladoCount ? `${derived.falladoCount}✕` : ""}</span>
          </div>
          <div class="mini-bar">
            <span class="mini-bar-seg--bien" style="width:${pBien.toFixed(1)}%"></span>
            <span class="mini-bar-seg--repasar" style="width:${pRep.toFixed(1)}%"></span>
            <span class="mini-bar-seg--fallado" style="width:${pFail.toFixed(1)}%"></span>
          </div>
        </div>

        <div class="exam-result-col tabular">
          <div class="result-nums">
            <span class="result-score">${esc(scorePrimary)}</span>
            <span class="muted" style="font-size:0.76rem">${esc(scoreSecondary)}</span>
          </div>
          <div class="ib-badge ${gradeBadgeClass(derived.ibGrade)}" title="${derived.ibGrade ? `Nota IB ${derived.ibGrade}` : "Sin nota"}">
            ${derived.ibGrade ?? "—"}
          </div>
        </div>

        <div class="exam-actions-col" data-stop-row="true">
          <a class="btn btn-ghost btn-sm" href="${esc(def.enunciadoUrl)}" target="_blank" rel="noopener">Enunciado ↗</a>
          ${def.solucionUrl && showSol
            ? `<a class="btn btn-good btn-sm" href="${esc(def.solucionUrl)}" target="_blank" rel="noopener">Solución ↗</a>`
            : `<button type="button" class="btn btn-soft btn-sm" data-open-btn="${esc(def.id)}">Abrir</button>`}
        </div>
      </article>
    `;
  }).join("");
}

/* ==========================================================================
   View 2: Banco Global por Temas (625 Ejercicios Clasificados)
   ========================================================================== */

function getFilteredBankExercises() {
  const all = getAllCatalogExercises(state);
  const q = filters.bankSearch.trim().toLowerCase();

  return all.filter((ex) => {
    if (filters.bankScope === "visto") {
      if (ex.mai2026 !== "in" || (ex.syllabusFit !== "visto" && ex.syllabusFit !== "parcial")) return false;
    } else if (filters.bankScope === "mai-all") {
      if (ex.mai2026 !== "in") return false;
    } else if (filters.bankScope === "proximo") {
      if (ex.mai2026 !== "in" || ex.syllabusFit !== "proximo") return false;
    }

    if (filters.bankTopic !== "all" && ex.topic !== filters.bankTopic) return false;
    if (filters.bankSubtopic !== "all" && !ex.subtopics.includes(filters.bankSubtopic)) return false;
    if (filters.bankStatus !== "all" && ex.status !== filters.bankStatus) return false;
    if (filters.bankSol === "yes" && !ex.examDef.hasSolution) return false;

    if (q) {
      const subLabels = ex.subtopics.map((id) => SUBTOPIC_MAP[id]?.label || id).join(" ");
      const hay = `${ex.examDef.title} ej ${ex.q} ${ex.title} ${subLabels} ${ex.note}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function renderBankView() {
  document.querySelectorAll("[data-bscope]").forEach((p) => {
    p.classList.toggle("is-active", p.dataset.bscope === filters.bankScope);
  });

  const filtered = getFilteredBankExercises();
  const doneInFilter = filtered.filter((x) => x.status !== "pendiente").length;
  document.getElementById("bank-count").textContent =
    `Mostrando ${Math.min(bankPageLimit, filtered.length)} de ${filtered.length} ejercicios (${doneInFilter} practicados)`;

  const host = document.getElementById("bank-list");
  const loadWrap = document.getElementById("bank-load-more-wrap");

  if (filtered.length === 0) {
    host.innerHTML = `<div class="empty-state"><strong>Ningún ejercicio coincide con estos filtros.</strong><p class="chart-empty-sub">Prueba a cambiar el alcance a «Todo MAI NM 2026» o limpiar la búsqueda.</p></div>`;
    loadWrap.innerHTML = "";
    return;
  }

  const showSol = canSeeSolutions();
  const visible = filtered.slice(0, bankPageLimit);

  host.innerHTML = visible.map((ex) => {
    const rowCls = ex.mai2026 === "out"
      ? "bank-row--out"
      : ex.status !== "pendiente"
        ? `bank-row--${ex.status}`
        : "";

    const primarySubId = ex.subtopics[0];
    const primarySubObj = primarySubId ? SUBTOPIC_MAP[primarySubId] : null;
    const topicPill = primarySubObj
      ? `<span class="pill-subtle ${!primarySubObj.mai2026 ? "pill-subtle--out" : ex.syllabusFit === "proximo" ? "pill-subtle--warn" : "pill-subtle--info"}">${esc(primarySubObj.label)}</span>`
      : "";

    const extraSubs = ex.subtopics.slice(1).map((id) => SUBTOPIC_MAP[id]?.label).filter(Boolean).join(", ");

    const metaBits = [
      `<span class="mono">${ex.marks} pts · ${ex.optimalMin} min</span>`,
      extraSubs ? esc(extraSubs) : null,
      ex.examDef.hasSolution ? `<span><i class="meta-dot meta-dot--good"></i>Con solución</span>` : null,
      ex.timeSpentSec > 0 ? `<span class="mono">⏱ ${formatDurationCompact(ex.timeSpentSec)}</span>` : null,
      ex.mai2026 === "out" ? `<span>Fuera MAI 2026</span>` : null
    ].filter(Boolean);

    return `
      <article class="bank-row ${rowCls}">
        <div>
          <div class="bank-row-top">
            <div class="bank-row-head">
              <span class="bank-ref">${esc(ex.examDef.shortTitle)} · Ej. ${ex.q}</span>
              ${topicPill}
            </div>
            <div class="meta-line">${metaBits.join(`<span class="meta-sep">·</span>`)}</div>
          </div>
          <div class="bank-q-title">${esc(ex.title)}</div>
          ${ex.note ? `<div class="bank-q-note">${esc(ex.note)}</div>` : ""}
        </div>

        <div class="bank-row-footer">
          <div class="bank-grading-group">
            <div class="status-seg">
              ${EXERCISE_STATUSES.map((st) => `
                <button type="button" data-bk-exam="${esc(ex.examId)}" data-bk-q="${ex.q}" data-st="${st.id}" class="${ex.status === st.id ? "is-active" : ""}">${esc(st.short)}</button>
              `).join("")}
            </div>
            <div class="score10-wrap" title="Nota intuitiva del 0 al 10 (se convierte automáticamente a puntos IB)">
              <span class="muted">Nota</span>
              <input type="number" step="0.5" min="0" max="10" class="input" data-bk-s10-exam="${esc(ex.examId)}" data-bk-s10-q="${ex.q}" value="${ex.score10 ?? ""}" placeholder="/10" />
            </div>
          </div>

          <div class="bank-actions-group">
            <button type="button" class="btn btn-cyan btn-xs" data-bk-timer-exam="${esc(ex.examId)}" data-bk-timer-q="${ex.q}" title="Iniciar temporizador óptimo (${ex.optimalMin} min)">▶ ${ex.optimalMin} min</button>
            <a class="btn btn-ghost btn-xs" href="${esc(ex.examDef.enunciadoUrl)}" target="_blank" rel="noopener">PDF ↗</a>
            ${ex.examDef.solucionUrl && showSol ? `<a class="btn btn-good btn-xs" href="${esc(ex.examDef.solucionUrl)}" target="_blank" rel="noopener">Sol ↗</a>` : ""}
            <button type="button" class="btn btn-soft btn-xs" data-bk-open="${esc(ex.examId)}" data-bk-focus="${ex.q}">Detalle</button>
          </div>
        </div>
      </article>
    `;
  }).join("");

  loadWrap.innerHTML = filtered.length > bankPageLimit
    ? `<button type="button" class="btn btn-soft" id="btn-bank-more">Cargar 60 ejercicios más (${filtered.length - bankPageLimit} restantes)</button>`
    : "";

  const moreBtn = document.getElementById("btn-bank-more");
  if (moreBtn) {
    moreBtn.addEventListener("click", () => {
      bankPageLimit += 60;
      renderBankView();
    });
  }

  host.querySelectorAll("[data-bk-exam][data-st]").forEach((btn) => {
    btn.addEventListener("click", () => {
      updateExercise(state, btn.dataset.bkExam, Number(btn.dataset.bkQ), { status: btn.dataset.st }, syncConfig.role);
      renderAll();
    });
  });

  host.querySelectorAll("[data-bk-s10-exam]").forEach((inp) => {
    inp.addEventListener("change", () => {
      const raw = inp.value;
      updateExercise(state, inp.dataset.bkS10Exam, Number(inp.dataset.bkS10Q), {
        score10: raw === "" ? null : Math.max(0, Math.min(10, Number(raw)))
      }, syncConfig.role);
      renderAll();
      showToast("Nota 1–10 convertida a puntos IB");
    });
  });

  host.querySelectorAll("[data-bk-timer-exam]").forEach((btn) => {
    btn.addEventListener("click", () => startExerciseTimer(btn.dataset.bkTimerExam, Number(btn.dataset.bkTimerQ)));
  });

  host.querySelectorAll("[data-bk-open]").forEach((btn) => {
    btn.addEventListener("click", () => openExamDrawer(btn.dataset.bkOpen, Number(btn.dataset.bkFocus)));
  });
}

/* ==========================================================================
   Exam Detail Drawer (más amplio, claro y agradable de leer y puntuar)
   ========================================================================== */

function openExamDrawer(examId, focusQuestion = null) {
  const def = getExamDef(examId);
  if (!def) return;
  openExamId = examId;
  renderExamDrawer();
  const overlay = document.getElementById("exam-drawer-overlay");
  overlay.classList.add("is-open");
  overlay.setAttribute("aria-hidden", "false");
  if (focusQuestion) {
    setTimeout(() => {
      const target = document.querySelector(`[data-ex-row="${focusQuestion}"]`);
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        target.style.boxShadow = "0 0 0 2px var(--cyan)";
        setTimeout(() => { target.style.boxShadow = ""; }, 1800);
      }
    }, 60);
  }
}

function closeExamDrawer() {
  openExamId = null;
  const overlay = document.getElementById("exam-drawer-overlay");
  overlay.classList.remove("is-open");
  overlay.setAttribute("aria-hidden", "true");
}

function renderExamDrawer() {
  if (!openExamId) return;
  const def = getExamDef(openExamId);
  const rec = state.exams[openExamId] || null;
  const derived = getExamDerived(def, rec, state.settings.gradeBoundaries, state.settings.syllabusStatus);
  const showSol = canSeeSolutions();

  document.getElementById("drawer-exam-eyebrow").textContent =
    `${def.folderLabel} · ${def.calculator ? "Calculadora GDC permitida" : "Sin calculadora (Mat. NM)"}`;
  document.getElementById("drawer-exam-title").textContent = def.title;

  document.getElementById("drawer-exam-links").innerHTML = [
    `<a class="btn btn-primary btn-sm" href="${esc(def.enunciadoUrl)}" target="_blank" rel="noopener">Enunciado PDF ↗</a>`,
    def.solucionUrl && showSol
      ? `<a class="btn btn-good btn-sm" href="${esc(def.solucionUrl)}" target="_blank" rel="noopener">Solución / Esquema ↗</a>`
      : def.solucionUrl
        ? `<span class="pill-subtle pill-subtle--warn">Solución oculta (Modo Alumno)</span>`
        : `<span class="muted micro-hint">Solo enunciado</span>`,
    `<button type="button" class="btn btn-cyan btn-sm" id="btn-start-mock-timer">▶ Simulacro 90 min</button>`
  ].join("");

  const statusOpts = EXAM_STATUSES.map((s) => `<option value="${s.id}" ${derived.status === s.id ? "selected" : ""}>${esc(s.label)}</option>`).join("");
  const modeOpts = PRACTICE_MODES.map((m) => `<option value="${m.id}" ${derived.mode === m.id ? "selected" : ""}>${esc(m.label)}</option>`).join("");
  const gradeButtons = [1, 2, 3, 4, 5, 6, 7].map((g) => {
    const isManual = derived.manualGrade === g;
    const isAuto = !derived.manualGrade && derived.autoGrade === g;
    return `<button type="button" class="ib-grade-btn tabular ${isManual ? "is-active" : isAuto ? "is-auto" : ""}" data-set-grade="${g}">${g}</button>`;
  }).join("");

  const exercises = rec?.exercises || {};
  const subtopicOptsHtml = (selectedId) =>
    SUBTOPICS.map((s) => `<option value="${s.id}" ${selectedId === s.id ? "selected" : ""}>${esc(s.topic)} · ${esc(s.label)}</option>`).join("");

  let exRowsHtml = "";
  let hiddenOutCount = 0;
  for (let q = 1; q <= derived.totalQuestions; q++) {
    const ex = exercises[String(q)] || null;
    const meta = getExerciseMeta(openExamId, q, ex, state.settings.syllabusStatus);
    if (hideOutInDrawer && meta.mai2026 === "out") {
      hiddenOutCount++;
      continue;
    }

    const qMax = ex?.maxPoints ?? getQuestionMaxMarks(def, q);
    const st = ex?.status || "pendiente";
    const mistakes = Array.isArray(ex?.mistakes) ? ex.mistakes : [];
    const suggestion = mistakes.length > 0 ? suggestScoreFromMistakes(mistakes, qMax) : null;
    const primarySub = meta.subtopics[0] || "";
    const rowCls = meta.mai2026 === "out" ? "exercise-item--out" : st !== "pendiente" ? `exercise-item--${st}` : "";
    const rowKey = `${openExamId}:${q}`;
    const isMistakesOpen = expandedMistakeRows.has(rowKey);

    const segBtns = EXERCISE_STATUSES.map((s) =>
      `<button type="button" data-q="${q}" data-st="${s.id}" class="${st === s.id ? "is-active" : ""}">${esc(s.short)}</button>`
    ).join("");

    const activeMistakePills = mistakes.map((mid) => {
      const mDef = IB_MISTAKE_MAP[mid];
      const cls = mid === "follow_through" ? "pill-subtle--info" : "pill-subtle--bad";
      return `<span class="pill-subtle ${cls}">${esc(mDef ? mDef.short : mid)}</span>`;
    }).join("");

    const mistakeChips = IB_MISTAKES.map((m) => {
      const on = mistakes.includes(m.id);
      return `<button type="button" class="mistake-chip ${on ? "is-on" : ""}" data-q-mistake="${q}" data-m="${m.id}" title="${esc(m.ibRule)}">${esc(m.short)}</button>`;
    }).join("");

    const statusFlag = meta.mai2026 === "out"
      ? `<span class="pill-subtle pill-subtle--out" title="${esc(meta.outReason || "")}">Fuera MAI 2026</span>`
      : meta.syllabusFit === "proximo"
        ? `<span class="pill-subtle pill-subtle--warn">Próximo tema</span>`
        : "";

    const timeText = ex?.timeSpentSec > 0
      ? `<span class="pill-subtle pill-subtle--good mono" title="Tiempo real dedicado">⏱ ${formatDurationCompact(ex.timeSpentSec)}</span>`
      : "";

    exRowsHtml += `
      <div class="exercise-item ${rowCls}" data-ex-row="${q}">
        <div class="exercise-head-line">
          <div class="exercise-head-left">
            <span class="exercise-num">Ejercicio ${q}</span>
            <span class="muted mono" style="font-size:0.78rem">${qMax} pts · ${meta.optimalMin} min</span>
            ${statusFlag}
            ${timeText}
          </div>
          <div class="exercise-head-right">
            <button type="button" class="btn btn-cyan btn-xs" data-q-timer="${q}" title="Temporizador óptimo IB (${meta.optimalMin} min)">▶ ${meta.optimalMin} min</button>
            <button type="button" class="btn btn-ghost btn-xs" data-q-toggle-mai="${q}" title="Cambiar si entra en MAI 2026">${meta.mai2026 === "out" ? "Incluir en MAI" : "Fuera MAI"}</button>
          </div>
        </div>

        <div class="exercise-context">${esc(meta.title)}</div>

        <div class="exercise-controls">
          <div class="status-seg">${segBtns}</div>
          <div class="score10-wrap" title="Nota intuitiva del 0 al 10 (se pondera automáticamente a puntos IB)">
            <span class="muted">1–10</span>
            <input type="number" step="0.5" min="0" max="10" class="input" data-q-s10="${q}" value="${ex?.score10 ?? ""}" placeholder="—" />
          </div>
          <div class="pts-inline tabular" title="Puntos IB ponderados">
            <span class="muted">IB</span>
            <input type="number" step="0.5" min="0" max="99" class="input" data-q-pts="${q}" value="${ex?.points ?? ""}" placeholder="Pts" />
            <span class="muted">/</span>
            <input type="number" step="0.5" min="1" max="99" class="input" data-q-max="${q}" value="${qMax}" />
          </div>
          <select class="select ex-subtopic-select" data-q-subtopic="${q}" aria-label="Subtema del ejercicio ${q}">
            ${subtopicOptsHtml(primarySub)}
          </select>
        </div>

        <div class="mistakes-summary-row">
          <button type="button" class="mistakes-toggle-btn ${isMistakesOpen ? "is-open" : ""}" data-q-toggle-mistakes="${q}">
            ${mistakes.length > 0 ? `Fallos IB (${mistakes.length})` : "+ Marcar fallos IB"} ${isMistakesOpen ? "▴" : "▾"}
          </button>
          ${activeMistakePills}
        </div>

        ${isMistakesOpen ? `<div class="mistakes-tray">${mistakeChips}</div>` : ""}

        ${suggestion ? `
          <div class="ib-advice-strip">
            <span>${esc(suggestion.advice)}</span>
            <button type="button" class="btn btn-soft-gold btn-xs" data-q-apply-sugg="${q}" data-sugg-pts="${suggestion.suggestedPoints}" data-sugg-s10="${suggestion.suggestedScore10}">
              Aplicar ${suggestion.suggestedScore10}/10 (${suggestion.suggestedPoints}/${qMax} pts)
            </button>
          </div>
        ` : ""}

        <input type="text" class="input exercise-note-input" data-q-note="${q}" value="${esc(ex?.note || "")}" placeholder="Añadir nota sobre este ejercicio (truco GDC, fallo concreto, repasar apartado)…" />
      </div>
    `;
  }

  const attempts = rec?.attempts || [];
  const attemptsHtml = attempts.length
    ? `<div class="attempts-list" style="margin-top:0.9rem">${attempts.map((a) => `
        <div class="attempt-row">
          <div>
            <div class="meta-line">
              <strong>${esc(formatDateES(a.date))}</strong>
              <span class="meta-sep">·</span>
              <span>${esc((MODE_MAP[a.mode] || PRACTICE_MODES[0]).label)}</span>
              ${a.authorRole ? `<span class="meta-sep">·</span><span>${esc(roleLabel(a.authorRole))}</span>` : ""}
            </div>
            <div class="muted" style="margin-top:0.2rem">${esc(a.summary)}</div>
          </div>
          <div style="display:flex; align-items:center; gap:0.45rem">
            ${a.ibGrade ? `<span class="ib-badge ${gradeBadgeClass(a.ibGrade)}" style="width:30px; height:30px; font-size:1rem">${a.ibGrade}</span>` : ""}
            <button type="button" class="btn btn-ghost btn-xs" data-del-attempt="${esc(a.id)}" title="Eliminar intento">✕</button>
          </div>
        </div>
      `).join("")}</div>`
    : "";

  const heroTitle = derived.ibGrade ? getIBGradeDescription(derived.ibGrade) : "Sin nota todavía";
  const heroSub = derived.score !== null
    ? `${derived.score}/${derived.maxMarks} pts · ${derived.percent}% (nota del examen)`
    : derived.hasExercisePoints
      ? `Proyección: ${derived.exercisePointsEarned}/${derived.exercisePointsMax} pts (${derived.projectedPercent}%)`
      : "Puntúa cualquier ejercicio del 1 al 10 abajo para calcular la Nota IB real.";

  document.getElementById("drawer-exam-body").innerHTML = `
    <div class="panel-card">
      <div class="panel-card-head">
        <div>
          <h3>Resultado y Nota IB (1–7)</h3>
          <p class="panel-sub">Calificación automática ponderada según umbrales IB MAI NM</p>
        </div>
        ${derived.hasExercisePoints ? `<button type="button" class="btn btn-cyan btn-sm" id="btn-apply-ex-sum">Pasar suma (${derived.exercisePointsEarned} pts)</button>` : ""}
      </div>

      <div class="drawer-result-grid">
        <div>
          <div class="form-grid-3">
            <div><label class="field-label" for="dx-status">Estado</label><select id="dx-status" class="select">${statusOpts}</select></div>
            <div><label class="field-label" for="dx-mode">Modalidad</label><select id="dx-mode" class="select">${modeOpts}</select></div>
            <div><label class="field-label" for="dx-date">Fecha</label><input id="dx-date" class="input" type="date" value="${esc(derived.lastPracticed || todayISO())}" /></div>
          </div>

          <div class="score-inputs-grid">
            <div><label class="field-label" for="dx-score">Puntuación IB</label><input id="dx-score" class="input tabular" type="number" step="0.5" min="0" max="300" value="${derived.score ?? ""}" placeholder="Auto" /></div>
            <span class="score-slash">/</span>
            <div><label class="field-label" for="dx-max">Máximo</label><input id="dx-max" class="input tabular" type="number" min="1" max="300" value="${derived.maxMarks}" /></div>
            <div><label class="field-label" for="dx-duration">Minutos</label><input id="dx-duration" class="input tabular" type="number" value="${rec?.durationMin || ""}" placeholder="90" /></div>
          </div>
        </div>

        <div class="grade-hero-box">
          <div class="grade-hero-top">
            <div class="grade-hero-badge tabular ${gradeBadgeClass(derived.ibGrade)}" id="dx-hero-badge">${derived.ibGrade ?? "—"}</div>
            <div class="grade-hero-meta">
              <div class="grade-hero-title" id="dx-hero-title">${esc(heroTitle)}</div>
              <div class="grade-hero-sub tabular" id="dx-hero-sub">${esc(heroSub)}</div>
            </div>
          </div>
          <div>
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:0.32rem">
              <span class="muted" style="font-size:0.74rem">Ajuste manual 1–7</span>
              ${derived.manualGrade ? `<button type="button" class="btn btn-ghost btn-xs" id="btn-clear-manual-grade">Usar auto</button>` : ""}
            </div>
            <div class="ib-selector">${gradeButtons}</div>
          </div>
        </div>
      </div>

      <div class="drawer-save-row">
        <span class="muted micro-hint">${attempts.length ? `${attempts.length} intento${attempts.length === 1 ? "" : "s"} en historial` : "Guarda un intento para registrar la evolución en la gráfica."}</span>
        <button type="button" class="btn btn-primary btn-sm" id="btn-save-attempt">Guardar intento</button>
      </div>

      ${attemptsHtml}
    </div>

    <div class="panel-card">
      <div class="panel-card-head">
        <div>
          <h3>Ejercicios (${derived.doneCount}/${derived.totalQuestions})</h3>
          <p class="panel-sub">${derived.maiInCount} entran en MAI NM 2026${hiddenOutCount > 0 ? ` · ${hiddenOutCount} ocultos fuera de temario` : ""}</p>
        </div>
        <div class="btn-row">
          ${derived.maiOutCount > 0 ? `
            <label class="check-label" style="font-size:0.8rem">
              <input type="checkbox" id="chk-hide-out" ${hideOutInDrawer ? "checked" : ""} />
              Ocultar fuera de MAI (${derived.maiOutCount})
            </label>
          ` : ""}
          <button type="button" class="btn btn-soft btn-xs" id="btn-log-ex-today">Guardar sesión</button>
          <button type="button" class="btn btn-ghost btn-xs" id="btn-add-question">+ Ej.</button>
        </div>
      </div>
      <div class="exercise-list" id="drawer-exercise-list">${exRowsHtml}</div>
    </div>

    <div class="panel-card">
      <div class="panel-card-head">
        <div>
          <h3>Notas generales del examen</h3>
          <p class="panel-sub">Visibles también en la pestaña «Notas» y sincronizadas con Google Drive</p>
        </div>
      </div>
      <textarea id="dx-notes" class="textarea" rows="3" placeholder="Conclusiones generales del examen, gestión del tiempo o dudas para la próxima clase…">${esc(rec?.examNotes || "")}</textarea>
    </div>
  `;

  bindDrawerEvents();
}

function bindDrawerEvents() {
  const examId = openExamId;
  if (!examId) return;

  const mockBtn = document.getElementById("btn-start-mock-timer");
  if (mockBtn) mockBtn.addEventListener("click", () => startExamMockTimer(examId));

  document.getElementById("dx-status").addEventListener("change", (e) => {
    updateExamFields(state, examId, { status: e.target.value }, syncConfig.role);
    renderAll();
  });
  document.getElementById("dx-mode").addEventListener("change", (e) => {
    updateExamFields(state, examId, { mode: e.target.value }, syncConfig.role);
  });
  document.getElementById("dx-date").addEventListener("change", (e) => {
    updateExamFields(state, examId, { lastPracticed: e.target.value }, syncConfig.role);
    renderAll();
  });
  document.getElementById("dx-score").addEventListener("input", (e) => {
    updateExamFields(state, examId, { score: e.target.value === "" ? null : Number(e.target.value), manualGrade: null }, syncConfig.role);
    const def = getExamDef(examId);
    const d = getExamDerived(def, state.exams[examId], state.settings.gradeBoundaries, state.settings.syllabusStatus);
    const badge = document.getElementById("dx-hero-badge");
    const title = document.getElementById("dx-hero-title");
    const sub = document.getElementById("dx-hero-sub");
    if (badge) {
      badge.textContent = d.ibGrade ?? "—";
      badge.className = `grade-hero-badge tabular ${gradeBadgeClass(d.ibGrade)}`;
    }
    if (title) title.textContent = d.ibGrade ? getIBGradeDescription(d.ibGrade) : "Sin nota todavía";
    if (sub) {
      sub.textContent = d.score !== null
        ? `${d.score}/${d.maxMarks} pts · ${d.percent}% (nota del examen)`
        : "Sin puntuación manual";
    }
    renderAll();
  });
  document.getElementById("dx-max").addEventListener("input", (e) => {
    if (Number(e.target.value) > 0) {
      updateExamFields(state, examId, { maxMarks: Number(e.target.value) }, syncConfig.role);
      renderAll();
    }
  });
  document.getElementById("dx-duration").addEventListener("input", (e) => {
    updateExamFields(state, examId, { durationMin: e.target.value === "" ? null : Number(e.target.value) }, syncConfig.role);
  });
  document.getElementById("dx-notes").addEventListener("input", (e) => {
    updateExamFields(state, examId, { examNotes: e.target.value }, syncConfig.role);
    updateBrandAndBadges();
  });

  document.querySelectorAll("[data-set-grade]").forEach((btn) => {
    btn.addEventListener("click", () => {
      updateExamFields(state, examId, { manualGrade: Number(btn.dataset.setGrade) }, syncConfig.role);
      renderExamDrawer();
      renderAll();
      showToast(`Nota IB ${btn.dataset.setGrade} seleccionada`);
    });
  });

  const clearMan = document.getElementById("btn-clear-manual-grade");
  if (clearMan) {
    clearMan.addEventListener("click", () => {
      updateExamFields(state, examId, { manualGrade: null }, syncConfig.role);
      renderExamDrawer();
      renderAll();
    });
  }

  const applySum = document.getElementById("btn-apply-ex-sum");
  if (applySum) {
    applySum.addEventListener("click", () => {
      applyExerciseSumToExam(state, examId, syncConfig.role);
      renderExamDrawer();
      renderAll();
      showToast("Suma ponderada aplicada al examen");
    });
  }

  document.getElementById("btn-save-attempt").addEventListener("click", () => {
    saveExamAttempt(state, examId, "", syncConfig.role);
    renderExamDrawer();
    renderAll();
    showToast("Intento guardado en historial");
  });

  document.querySelectorAll("[data-del-attempt]").forEach((btn) => {
    btn.addEventListener("click", () => {
      deleteAttempt(state, examId, btn.dataset.delAttempt);
      renderExamDrawer();
      renderAll();
    });
  });

  const chkHide = document.getElementById("chk-hide-out");
  if (chkHide) {
    chkHide.addEventListener("change", () => {
      hideOutInDrawer = chkHide.checked;
      renderExamDrawer();
    });
  }

  document.getElementById("btn-add-question").addEventListener("click", () => {
    const rec = ensureExamRecord(state, examId);
    rec.questionCount = (rec.questionCount || 1) + 1;
    updateExamFields(state, examId, { questionCount: rec.questionCount }, syncConfig.role);
    renderExamDrawer();
    renderAll();
  });

  document.getElementById("btn-log-ex-today").addEventListener("click", () => {
    const rec = ensureExamRecord(state, examId);
    const worked = Object.entries(rec.exercises)
      .filter(([, ex]) => ex && ex.status && ex.status !== "pendiente")
      .map(([k]) => Number(k));
    if (worked.length === 0) return showToast("Marca al menos un ejercicio primero");
    logExercisesSession(state, examId, document.getElementById("dx-date").value || todayISO(), worked, "", syncConfig.role);
    renderAll();
    showToast(`Sesión guardada (${worked.length} ejercicios)`);
  });

  const exList = document.getElementById("drawer-exercise-list");

  exList.querySelectorAll("[data-q-timer]").forEach((btn) => {
    btn.addEventListener("click", () => startExerciseTimer(examId, Number(btn.dataset.qTimer)));
  });

  exList.querySelectorAll("[data-q-toggle-mai]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const q = Number(btn.dataset.qToggleMai);
      const meta = getExerciseMeta(examId, q, state.exams[examId]?.exercises?.[String(q)], state.settings.syllabusStatus);
      const next = meta.mai2026 === "out" ? "in" : "out";
      updateExercise(state, examId, q, { mai2026: next }, syncConfig.role);
      renderExamDrawer();
      renderAll();
    });
  });

  exList.querySelectorAll("[data-q-toggle-mistakes]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = `${examId}:${btn.dataset.qToggleMistakes}`;
      if (expandedMistakeRows.has(key)) expandedMistakeRows.delete(key);
      else expandedMistakeRows.add(key);
      renderExamDrawer();
    });
  });

  exList.querySelectorAll("[data-q][data-st]").forEach((btn) => {
    btn.addEventListener("click", () => {
      updateExercise(state, examId, Number(btn.dataset.q), { status: btn.dataset.st }, syncConfig.role);
      renderExamDrawer();
      renderAll();
    });
  });

  exList.querySelectorAll("[data-q-s10]").forEach((inp) => {
    inp.addEventListener("change", () => {
      const q = Number(inp.dataset.qS10);
      const raw = inp.value;
      updateExercise(state, examId, q, { score10: raw === "" ? null : Math.max(0, Math.min(10, Number(raw))) }, syncConfig.role);
      renderExamDrawer();
      renderAll();
    });
  });

  exList.querySelectorAll("[data-q-pts]").forEach((inp) => {
    inp.addEventListener("change", () => {
      const q = Number(inp.dataset.qPts);
      const raw = inp.value;
      updateExercise(state, examId, q, { points: raw === "" ? null : Number(raw) }, syncConfig.role);
      renderExamDrawer();
      renderAll();
    });
  });

  exList.querySelectorAll("[data-q-max]").forEach((inp) => {
    inp.addEventListener("change", () => {
      const q = Number(inp.dataset.qMax);
      const val = Number(inp.value);
      if (val > 0) {
        updateExercise(state, examId, q, { maxPoints: val }, syncConfig.role);
        renderExamDrawer();
        renderAll();
      }
    });
  });

  exList.querySelectorAll("[data-q-subtopic]").forEach((sel) => {
    sel.addEventListener("change", () => {
      const q = Number(sel.dataset.qSubtopic);
      const stDef = SUBTOPIC_MAP[sel.value];
      updateExercise(state, examId, q, {
        subtopics: [sel.value],
        topic: stDef ? stDef.topic : "T2",
        mai2026: stDef && !stDef.mai2026 ? "out" : "in"
      }, syncConfig.role);
      renderExamDrawer();
      renderAll();
    });
  });

  exList.querySelectorAll("[data-q-mistake]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const q = Number(btn.dataset.qMistake);
      const mid = btn.dataset.m;
      const cur = state.exams[examId]?.exercises?.[String(q)]?.mistakes || [];
      const next = cur.includes(mid) ? cur.filter((x) => x !== mid) : [...cur, mid];
      expandedMistakeRows.add(`${examId}:${q}`);
      updateExercise(state, examId, q, { mistakes: next }, syncConfig.role);
      renderExamDrawer();
      renderAll();
    });
  });

  exList.querySelectorAll("[data-q-apply-sugg]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const q = Number(btn.dataset.qApplySugg);
      const pts = Number(btn.dataset.suggPts);
      const s10 = Number(btn.dataset.suggS10);
      const status = s10 >= 7 ? "bien" : s10 >= 4 ? "repasar" : "fallado";
      updateExercise(state, examId, q, { points: pts, score10: s10, status }, syncConfig.role);
      renderExamDrawer();
      renderAll();
      showToast(`Sugerencia IB aplicada (${s10}/10 · ${pts} pts)`);
    });
  });

  exList.querySelectorAll("[data-q-note]").forEach((inp) => {
    inp.addEventListener("input", () => {
      updateExercise(state, examId, Number(inp.dataset.qNote), { note: inp.value }, syncConfig.role);
    });
  });
}

/* ==========================================================================
   View 3: Historial, Gráficos, Top Fallos IB y Cola de Repaso
   ========================================================================== */

function renderHistoryView() {
  const stats = getGlobalStats(state);
  document.getElementById("evolution-chart-container").innerHTML =
    renderEvolutionChart(stats.evolutionPoints, state.settings.gradeBoundaries);
  document.getElementById("topics-chart-container").innerHTML =
    renderTopicsMastery(stats.topicStats, stats.untaggedExercises);
  document.getElementById("top-mistakes-container").innerHTML =
    renderTopMistakes(stats.topMistakes);

  document.querySelectorAll("[data-open-exam]").forEach((el) => {
    el.addEventListener("click", () => openExamDrawer(el.dataset.openExam));
  });

  let queue = getReviewQueue(state);
  if (filters.queueTopic !== "all") {
    queue = queue.filter((i) => i.topic === filters.queueTopic);
  }
  const qHost = document.getElementById("review-queue-list");
  if (queue.length === 0) {
    qHost.innerHTML = `<div class="chart-empty"><p class="chart-empty-title">Cola de repaso despejada</p><p class="chart-empty-sub">Los ejercicios marcados como «Repasar» o «Duda» aparecerán aquí ordenados por prioridad.</p></div>`;
  } else {
    qHost.innerHTML = `<div class="queue-list">${queue.map((item) => {
      const isFail = item.status === "fallado";
      const label = item.type === "exercise" ? `${item.examDef.shortTitle} · Ej. ${item.qNum}` : `${item.examDef.title}`;
      const mText = (item.mistakes || []).map((id) => IB_MISTAKE_MAP[id]?.short || id).join(", ");
      return `
        <div class="queue-item ${isFail ? "queue-item--fallado" : "queue-item--repasar"}">
          <div>
            <div class="meta-line">
              <strong>${esc(label)}</strong>
              <span class="pill-subtle ${isFail ? "pill-subtle--bad" : "pill-subtle--warn"}">${isFail ? "Duda" : "Repasar"}</span>
              ${item.score10 != null ? `<span class="mono muted">${item.score10}/10</span>` : ""}
              ${mText ? `<span class="meta-sep">·</span><span class="muted">${esc(mText)}</span>` : ""}
            </div>
            ${item.note ? `<div class="muted" style="font-size:0.82rem; margin-top:0.28rem">${esc(item.note)}</div>` : ""}
          </div>
          <div style="display:flex; gap:0.35rem; flex-shrink:0">
            ${item.type === "exercise" ? `<button type="button" class="btn btn-good btn-xs" data-resolve-ex="${esc(item.examId)}" data-resolve-q="${item.qNum}">✓ Bien</button>` : ""}
            <button type="button" class="btn btn-ghost btn-xs" data-jump-exam="${esc(item.examId)}" data-jump-q="${item.qNum || ""}">Abrir</button>
          </div>
        </div>
      `;
    }).join("")}</div>`;

    qHost.querySelectorAll("[data-jump-exam]").forEach((b) => {
      b.addEventListener("click", () => openExamDrawer(b.dataset.jumpExam, b.dataset.jumpQ ? Number(b.dataset.jumpQ) : null));
    });
    qHost.querySelectorAll("[data-resolve-ex]").forEach((b) => {
      b.addEventListener("click", () => {
        updateExercise(state, b.dataset.resolveEx, Number(b.dataset.resolveQ), { status: "bien" }, syncConfig.role);
        renderAll();
        showToast("Ejercicio superado ✓");
      });
    });
  }

  const tHost = document.getElementById("activity-timeline");
  const logs = [...state.activityLog].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  if (logs.length === 0) {
    tHost.innerHTML = `<div class="chart-empty"><p class="chart-empty-title">Sin sesiones registradas todavía</p><p class="chart-empty-sub">Guarda un intento desde cualquier examen o pulsa «+ Registrar sesión».</p></div>`;
  } else {
    tHost.innerHTML = `<div class="timeline-list">${logs.map((entry) => {
      const def = getExamDef(entry.examId);
      const exStr = entry.exerciseNumbers?.length ? `Ej. ${entry.exerciseNumbers.join(", ")}` : "";
      return `
        <div class="timeline-item">
          <div>
            <div class="meta-line">
              <span class="timeline-date">${esc(formatDateES(entry.date))}</span>
              <strong>${esc(def ? def.title : entry.examId)}</strong>
              ${entry.ibGrade ? `<span class="pill-subtle pill-subtle--good">IB ${entry.ibGrade}</span>` : ""}
              ${entry.authorRole ? `<span class="muted">· ${esc(roleLabel(entry.authorRole))}</span>` : ""}
              ${exStr ? `<span class="muted">· ${esc(exStr)}</span>` : ""}
            </div>
            <div class="muted" style="font-size:0.83rem; margin-top:0.25rem">${esc(entry.summary)}</div>
          </div>
          <div style="display:flex; gap:0.28rem; flex-shrink:0">
            ${def ? `<button type="button" class="btn btn-ghost btn-xs" data-log-jump="${esc(def.id)}">Abrir</button>` : ""}
            <button type="button" class="btn btn-ghost btn-xs" data-log-del="${esc(entry.id)}" title="Eliminar">✕</button>
          </div>
        </div>
      `;
    }).join("")}</div>`;

    tHost.querySelectorAll("[data-log-jump]").forEach((b) => b.addEventListener("click", () => openExamDrawer(b.dataset.logJump)));
    tHost.querySelectorAll("[data-log-del]").forEach((b) => b.addEventListener("click", () => {
      deleteActivityEntry(state, b.dataset.logDel);
      renderAll();
    }));
  }
}

/* ==========================================================================
   View 4: Notas y Repaso
   ========================================================================== */

function renderNotesView() {
  document.querySelectorAll("[data-nscope]").forEach((p) => {
    p.classList.toggle("is-active", p.dataset.nscope === filters.noteScope);
  });
  const host = document.getElementById("notes-list");
  const q = filters.noteSearch.trim().toLowerCase();

  if (filters.noteScope === "from-exams") {
    let items = getExamAndExerciseNotes(state);
    if (filters.noteTopic !== "all") items = items.filter((i) => i.topic === filters.noteTopic);
    if (q) items = items.filter((i) => `${i.examDef.title} ${i.text}`.toLowerCase().includes(q));
    if (items.length === 0) {
      host.innerHTML = `<div class="empty-state"><strong>Sin notas escritas dentro de exámenes o ejercicios.</strong></div>`;
      return;
    }
    host.innerHTML = items.map((item) => {
      const metaParts = [
        item.date ? esc(formatDateES(item.date)) : null,
        esc(roleLabel(item.authorRole)),
        item.topic && TOPIC_MAP[item.topic] ? esc(TOPIC_MAP[item.topic].short) : null
      ].filter(Boolean);
      return `
        <article class="note-card">
          <div class="note-card-head">
            <div>
              <h4 class="note-title">${esc(item.source === "exercise" ? `${item.examDef.title} · Ej. ${item.qNum}` : `${item.examDef.title} · General`)}</h4>
              <div class="meta-line note-meta">${metaParts.join(`<span class="meta-sep">·</span>`)}</div>
            </div>
            <button type="button" class="btn btn-soft btn-xs" data-note-open-exam="${esc(item.examId)}" data-note-q="${item.qNum || ""}">Abrir</button>
          </div>
          <p class="note-body">${esc(item.text)}</p>
        </article>
      `;
    }).join("");
    host.querySelectorAll("[data-note-open-exam]").forEach((b) => {
      b.addEventListener("click", () => openExamDrawer(b.dataset.noteOpenExam, b.dataset.noteQ ? Number(b.dataset.noteQ) : null));
    });
    return;
  }

  let list = [...state.notes];
  if (filters.noteScope === "pending") list = list.filter((n) => !n.reviewed);
  if (filters.noteScope === "pinned") list = list.filter((n) => n.pinned);
  if (filters.noteCategory !== "all") list = list.filter((n) => n.category === filters.noteCategory);
  if (filters.noteTopic !== "all") list = list.filter((n) => n.topic === filters.noteTopic);
  if (q) list = list.filter((n) => `${n.title} ${n.body}`.toLowerCase().includes(q));
  list.sort((a, b) => (a.pinned !== b.pinned ? (a.pinned ? -1 : 1) : (b.date || "").localeCompare(a.date || "")));

  if (list.length === 0) {
    host.innerHTML = `<div class="empty-state"><strong>Aún no hay notas aquí.</strong><p class="chart-empty-sub">Crea resúmenes de clase, errores frecuentes o deberes en el panel izquierdo.</p></div>`;
    return;
  }

  host.innerHTML = list.map((n) => {
    const cat = NOTE_CAT_MAP[n.category] || NOTE_CATEGORIES[0];
    const topicObj = n.topic ? TOPIC_MAP[n.topic] : null;
    const examDef = n.examId ? getExamDef(n.examId) : null;
    const metaParts = [
      `<span class="tabular">${esc(formatDateES(n.date))}</span>`,
      esc(roleLabel(n.authorRole)),
      esc(cat.label),
      topicObj ? esc(topicObj.short) : null,
      examDef ? `<button type="button" class="btn btn-ghost btn-xs" data-note-open-exam="${esc(examDef.id)}">${esc(examDef.shortTitle)} ↗</button>` : null
    ].filter(Boolean);

    return `
      <article class="note-card ${n.pinned ? "note-card--pinned" : ""} ${n.reviewed ? "note-card--reviewed" : ""}">
        <div class="note-card-head">
          <div>
            <div class="exam-title-line">
              <h4 class="note-title">${n.pinned ? "📌 " : ""}${esc(n.title)}</h4>
              <span class="pill-subtle ${n.reviewed ? "pill-subtle--good" : "pill-subtle--warn"}">${n.reviewed ? "Repasado ✓" : "Por repasar"}</span>
            </div>
            <div class="meta-line note-meta">${metaParts.join(`<span class="meta-sep">·</span>`)}</div>
          </div>
          <div class="note-actions">
            <button type="button" class="btn btn-xs ${n.reviewed ? "btn-ghost" : "btn-good"}" data-note-review="${esc(n.id)}">${n.reviewed ? "Reabrir" : "✓ Repasado"}</button>
            <button type="button" class="btn btn-ghost btn-xs" data-note-pin="${esc(n.id)}" title="Fijar">📌</button>
            <button type="button" class="btn btn-ghost btn-xs" data-note-edit="${esc(n.id)}">Editar</button>
            <button type="button" class="btn btn-ghost btn-xs" data-note-del="${esc(n.id)}" title="Eliminar">✕</button>
          </div>
        </div>
        <p class="note-body">${esc(n.body)}</p>
      </article>
    `;
  }).join("");

  host.querySelectorAll("[data-note-open-exam]").forEach((b) => b.addEventListener("click", () => openExamDrawer(b.dataset.noteOpenExam)));
  host.querySelectorAll("[data-note-review]").forEach((b) => b.addEventListener("click", () => { toggleNoteField(state, b.dataset.noteReview, "reviewed"); renderAll(); }));
  host.querySelectorAll("[data-note-pin]").forEach((b) => b.addEventListener("click", () => { toggleNoteField(state, b.dataset.notePin, "pinned"); renderNotesView(); }));
  host.querySelectorAll("[data-note-del]").forEach((b) => b.addEventListener("click", () => { deleteNote(state, b.dataset.noteDel); renderAll(); showToast("Nota eliminada"); }));
  host.querySelectorAll("[data-note-edit]").forEach((b) => b.addEventListener("click", () => {
    const note = state.notes.find((x) => x.id === b.dataset.noteEdit);
    if (!note) return;
    document.getElementById("note-edit-id").value = note.id;
    document.getElementById("note-title").value = note.title;
    document.getElementById("note-date").value = note.date || todayISO();
    document.getElementById("note-category").value = note.category || "clase";
    document.getElementById("note-topic").value = note.topic || "";
    document.getElementById("note-exam").value = note.examId || "";
    document.getElementById("note-body").value = note.body || "";
    document.getElementById("note-pinned").checked = Boolean(note.pinned);
    document.getElementById("note-form-heading").textContent = "Editando nota";
    document.getElementById("btn-note-save").textContent = "Actualizar";
    document.getElementById("btn-note-cancel").style.display = "inline-flex";
  }));
}

function resetNoteForm() {
  document.getElementById("note-form").reset();
  document.getElementById("note-edit-id").value = "";
  document.getElementById("note-date").value = todayISO();
  document.getElementById("note-form-heading").textContent = "Nueva nota";
  document.getElementById("btn-note-save").textContent = "Guardar nota";
  document.getElementById("btn-note-cancel").style.display = "none";
}

/* ==========================================================================
   Modals: Countdowns, Syllabus, GDC, Settings & Google Drive Sync Wizard
   ========================================================================== */

function openModal(id) {
  const el = document.getElementById(id);
  if (el) { el.classList.add("is-open"); el.setAttribute("aria-hidden", "false"); }
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) { el.classList.remove("is-open"); el.setAttribute("aria-hidden", "true"); }
}

function switchSettingsTab(tabName) {
  document.querySelectorAll(".modal-tab").forEach((b) => {
    b.classList.toggle("is-active", b.dataset.stab === tabName);
  });
  document.querySelectorAll(".modal-tab-panel").forEach((p) => {
    p.classList.toggle("is-active", p.id === `spanel-${tabName}`);
  });
}

function openSettingsModal(defaultTab = "sync") {
  populateSettingsModal();
  switchSettingsTab(defaultTab);
  openModal("settings-modal-backdrop");
}

function closeToolsMenu() {
  const dd = document.getElementById("tools-dropdown");
  const btn = document.getElementById("btn-tools-menu");
  if (dd) {
    dd.classList.remove("is-open");
    dd.setAttribute("aria-hidden", "true");
  }
  if (btn) btn.setAttribute("aria-expanded", "false");
}

function openCountdownModal() {
  const cd = state.settings.countdowns;
  document.getElementById("cd-mock-label").value = cd.mock.label;
  document.getElementById("cd-mock-date").value = cd.mock.date;
  document.getElementById("cd-mock-detail").value = cd.mock.detail;
  document.getElementById("cd-off-label").value = cd.official.label;
  document.getElementById("cd-off-date").value = cd.official.date;
  document.getElementById("cd-off-detail").value = cd.official.detail;
  openModal("countdown-modal-backdrop");
}

function openSyllabusModal() {
  const host = document.getElementById("syllabus-checklist");
  const maiSubs = SUBTOPICS.filter((s) => s.mai2026);
  host.innerHTML = maiSubs.map((s) => {
    const cur = state.settings.syllabusStatus[s.id] || s.defaultSyllabus || "visto";
    return `
      <div class="syllabus-row">
        <div>
          <span class="pill-subtle">${esc(s.topic)}</span>
          <strong style="margin-left:0.45rem">${esc(s.label)}</strong>
        </div>
        <select class="select select--compact" data-syl-id="${esc(s.id)}">
          ${SYLLABUS_LEVELS.map((l) => `<option value="${l.id}" ${cur === l.id ? "selected" : ""}>${esc(l.label)}</option>`).join("")}
        </select>
      </div>
    `;
  }).join("");

  host.querySelectorAll("[data-syl-id]").forEach((sel) => {
    sel.addEventListener("change", () => {
      const next = { ...state.settings.syllabusStatus, [sel.dataset.sylId]: sel.value };
      updateSettings(state, { syllabusStatus: next });
      renderAll();
    });
  });

  openModal("syllabus-modal-backdrop");
}

function openGdcModal() {
  document.getElementById("gdc-cheatsheet-body").innerHTML = GDC_CHEATSHEET.map((item) => `
    <div class="gdc-card">
      <h4>${esc(item.topic)}</h4>
      <div class="gdc-line"><strong>TI-84 Plus:</strong> <span class="mono" style="font-size:0.79rem">${esc(item.ti84)}</span></div>
      <div class="gdc-line"><strong>Casio CG50:</strong> <span class="mono" style="font-size:0.79rem">${esc(item.casio)}</span></div>
      <div class="gdc-line muted">💡 ${esc(item.tip)}</div>
    </div>
  `).join("");
  openModal("gdc-modal-backdrop");
}

function populateSettingsModal() {
  document.getElementById("sync-script-url").value = syncConfig.scriptUrl || "";
  document.getElementById("sync-room-code").value = syncConfig.roomCode || "";
  document.getElementById("apps-script-box").textContent = APPS_SCRIPT_CODE;

  const wizard = document.getElementById("sync-wizard-details");
  if (wizard) {
    wizard.open = !syncConfig.enabled;
  }

  updateSyncUI(syncClient.status, syncClient.lastDetail, {
    rev: syncClient.rev,
    lastSyncedAt: syncClient.lastSyncedAt,
    dirty: syncClient.dirty
  });

  document.getElementById("set-role").value = syncConfig.role || "profesor";
  document.getElementById("set-student-name").value = state.settings.studentName || "";
  document.getElementById("set-target-session").value = state.settings.targetSession || "Mayo 2027";
  document.getElementById("set-hide-solutions").checked = Boolean(state.settings.hideSolutionsForStudent);

  const presetSel = document.getElementById("set-curve-preset");
  presetSel.innerHTML = `<option value="">Aplicar preset oficial IB…</option>` +
    IB_CURVE_PRESETS.map((p) => `<option value="${p.id}">${esc(p.label)}</option>`).join("");

  document.getElementById("boundaries-inputs").innerHTML = state.settings.gradeBoundaries.map((val, idx) => `
    <div class="boundary-cell">
      <span>IB ${idx + 1}</span>
      <input type="number" class="input tabular" min="0" max="100" data-bound-idx="${idx}" value="${val}" ${idx === 0 ? "disabled" : ""} />
    </div>
  `).join("");

  document.getElementById("backup-status-text").textContent = state.lastExportedAt
    ? `Última copia JSON exportada: ${formatDateES(state.lastExportedAt.slice(0, 10))}.`
    : "Además de la sincronización con tu Google Drive, puedes descargar una copia local JSON o CSV cuando quieras.";
}

async function copyStudentInviteLink() {
  const scriptUrl = document.getElementById("sync-script-url").value.trim() || syncConfig.scriptUrl;
  const roomCode = document.getElementById("sync-room-code").value.trim() || syncConfig.roomCode;
  const check = validateScriptUrl(scriptUrl);
  if (!check.ok || !roomCode || roomCode.trim().length < 3) {
    showToast("Completa primero la URL /exec y el código de sala en el paso 4");
    const wizard = document.getElementById("sync-wizard-details");
    if (wizard) wizard.open = true;
    return;
  }
  const link = encodeInviteLink(window.location.href, check.url, roomCode, "alumno");
  try {
    await navigator.clipboard.writeText(link);
    showToast("Enlace listo para tu alumno copiado — envíaselo por WhatsApp");
  } catch {
    window.prompt("Copia este enlace y envíaselo a tu alumno:", link);
  }
}

function triggerDownload(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function buildPrintReportAndPrint() {
  const stats = getGlobalStats(state);
  const queue = getReviewQueue(state);
  const pendingNotes = state.notes.filter((n) => !n.reviewed);
  const workedExams = EXAMS.map((def) => ({
    def, rec: state.exams[def.id],
    d: getExamDerived(def, state.exams[def.id], state.settings.gradeBoundaries, state.settings.syllabusStatus)
  })).filter(({ d }) => d.status !== "pendiente" || d.hasNotes);

  document.getElementById("print-report").innerHTML = `
    <h1>Informe de Seguimiento — IB Matemáticas MAI NM (2026)</h1>
    <p style="margin:0 0 10px">${state.settings.studentName ? `Alumno: ${esc(state.settings.studentName)} · ` : ""}Simulacro: ${esc(formatDateES(state.settings.countdowns.mock.date))} · Examen IB: ${esc(formatDateES(state.settings.countdowns.official.date))} · Generado el ${esc(formatDateES(todayISO()))}</p>
    <p style="margin:0 0 12px">
      <strong>Cobertura temario visto:</strong> ${stats.vistoDone}/${stats.vistoTotal} ejercicios ·
      <strong>Nota IB media:</strong> ${stats.avgIbGrade ?? "—"} ${stats.avgPercent !== null ? `(${stats.avgPercent}%)` : ""} ·
      <strong>Exámenes trabajados:</strong> ${stats.examsWorked}/${stats.examsTotal}
    </p>
    <h2>1. Exámenes trabajados</h2>
    <table>
      <thead><tr><th>Examen</th><th>Estado</th><th>Fecha</th><th>Ejercicios</th><th>Puntuación</th><th>IB</th><th>Notas</th></tr></thead>
      <tbody>
        ${workedExams.length ? workedExams.map(({ def, rec, d }) => `
          <tr>
            <td>${esc(def.title)}</td>
            <td>${esc((EXAM_STATUS_MAP[d.status] || EXAM_STATUSES[0]).label)}</td>
            <td>${esc(formatDateES(d.lastPracticed) || "—")}</td>
            <td>${d.doneCount}/${d.totalQuestions} (${d.bienCount}✓)</td>
            <td>${d.score !== null ? `${d.score}/${d.maxMarks} (${d.percent}%)` : d.hasExercisePoints ? `~${d.exercisePointsEarned}/${d.exercisePointsMax} (${d.projectedPercent}%)` : "—"}</td>
            <td><strong>${d.ibGrade ?? "—"}</strong></td>
            <td>${esc(rec?.examNotes || "")}</td>
          </tr>
        `).join("") : `<tr><td colspan="7">Sin exámenes trabajados todavía.</td></tr>`}
      </tbody>
    </table>
    <h2>2. Top fallos típicos IB detectados</h2>
    <ul>${stats.topMistakes.length ? stats.topMistakes.map((m) => `<li><strong>${esc(m.label)}</strong> (${m.count}×): ${esc(m.ibRule)}</li>`).join("") : "<li>Sin fallos registrados.</li>"}</ul>
    <h2>3. Cola de repaso (${queue.length})</h2>
    <ul>${queue.length ? queue.map((q) => `<li><strong>${esc(q.type === "exercise" ? `${q.examDef.shortTitle} Ej. ${q.qNum}` : q.examDef.title)}</strong>: ${esc(q.note || q.status)}</li>`).join("") : "<li>Al día.</li>"}</ul>
    <h2>4. Notas de repaso activas (${pendingNotes.length})</h2>
    <ul>${pendingNotes.length ? pendingNotes.map((n) => `<li><strong>${esc(n.title)}</strong> (${esc(formatDateES(n.date))}): ${esc(n.body)}</li>`).join("") : "<li>Sin notas pendientes.</li>"}</ul>
  `;
  window.print();
}

/* ==========================================================================
   Navigation, Static Populators & Event Bindings
   ========================================================================== */

function switchView(viewName) {
  currentView = viewName;
  document.querySelectorAll(".nav-tab").forEach((t) => t.classList.toggle("is-active", t.dataset.view === viewName));
  document.querySelectorAll(".view-panel").forEach((p) => p.classList.toggle("is-active", p.id === `view-${viewName}`));
  if (viewName === "bank") renderBankView();
  if (viewName === "history") renderHistoryView();
  if (viewName === "notes") renderNotesView();
}

function renderAll() {
  applyTheme();
  updateBrandAndBadges();
  renderHudStrip();
  renderKPIs();
  renderCategoryPills();
  renderExtraResources();
  renderExamList();
  if (currentView === "bank") renderBankView();
  if (currentView === "history") renderHistoryView();
  if (currentView === "notes") renderNotesView();
}

function populateStaticSelects() {
  document.getElementById("drive-root-link").href = DRIVE_ROOT_URL;

  const topicOpts = MAI_TOPICS.map((t) => `<option value="${t.id}">${esc(t.short)}</option>`).join("");
  document.getElementById("bank-topic").insertAdjacentHTML("beforeend", topicOpts);
  document.getElementById("queue-topic-filter").insertAdjacentHTML("beforeend", topicOpts);
  document.getElementById("note-topic").insertAdjacentHTML("beforeend", topicOpts);
  document.getElementById("notes-filter-topic").insertAdjacentHTML("beforeend", topicOpts);

  const subOpts = SUBTOPICS.map((s) => `<option value="${s.id}">${esc(s.topic)} · ${esc(s.label)}</option>`).join("");
  document.getElementById("filter-exam-subtopic").insertAdjacentHTML("beforeend", subOpts);
  document.getElementById("bank-subtopic").insertAdjacentHTML("beforeend", subOpts);

  const catOpts = NOTE_CATEGORIES.map((c) => `<option value="${c.id}">${esc(c.label)}</option>`).join("");
  document.getElementById("note-category").innerHTML = catOpts;
  document.getElementById("notes-filter-cat").insertAdjacentHTML("beforeend", catOpts);

  const examOpts = EXAMS.map((e) => `<option value="${e.id}">${esc(e.title)}</option>`).join("");
  document.getElementById("note-exam").insertAdjacentHTML("beforeend", examOpts);
  document.getElementById("log-exam").innerHTML = examOpts;

  document.getElementById("note-date").value = todayISO();
  document.getElementById("log-date").value = todayISO();
}

function bindGlobalEvents() {
  document.querySelectorAll(".nav-tab").forEach((tab) => {
    tab.addEventListener("click", () => switchView(tab.dataset.view));
  });

  document.getElementById("btn-toggle-theme").addEventListener("click", () => {
    state.settings.theme = state.settings.theme === "dark" ? "light" : "dark";
    saveState(state);
    applyTheme();
  });

  document.getElementById("btn-role-pill").addEventListener("click", () => {
    syncConfig = saveSyncConfig({ ...syncConfig, role: syncConfig.role === "profesor" ? "alumno" : "profesor" });
    syncClient.config = syncConfig;
    renderAll();
    if (openExamId) renderExamDrawer();
    showToast(`Cambiado a Modo ${syncConfig.role === "alumno" ? "Alumno" : "Profesor"}`);
  });

  document.getElementById("btn-sync-pill").addEventListener("click", () => openSettingsModal("sync"));
  document.getElementById("btn-sync-now-top").addEventListener("click", handleSyncNow);
  document.getElementById("btn-sync-now-modal").addEventListener("click", handleSyncNow);

  // Recursos dropdown
  const toolsBtn = document.getElementById("btn-tools-menu");
  const toolsDd = document.getElementById("tools-dropdown");
  toolsBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = !toolsDd.classList.contains("is-open");
    toolsDd.classList.toggle("is-open", open);
    toolsDd.setAttribute("aria-hidden", String(!open));
    toolsBtn.setAttribute("aria-expanded", String(open));
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".tools-menu-wrap")) closeToolsMenu();
  });

  document.getElementById("btn-open-gdc").addEventListener("click", () => { closeToolsMenu(); openGdcModal(); });
  document.getElementById("btn-menu-syllabus").addEventListener("click", () => { closeToolsMenu(); openSyllabusModal(); });
  document.getElementById("btn-open-syllabus").addEventListener("click", openSyllabusModal);
  document.getElementById("btn-print-report").addEventListener("click", () => { closeToolsMenu(); buildPrintReportAndPrint(); });
  document.getElementById("drive-root-link").addEventListener("click", closeToolsMenu);

  // Settings modal tabs
  document.getElementById("btn-open-settings").addEventListener("click", () => openSettingsModal("sync"));
  document.querySelectorAll(".modal-tab").forEach((tab) => {
    tab.addEventListener("click", () => switchSettingsTab(tab.dataset.stab));
  });

  // Exams filters
  document.getElementById("category-pills").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-cat]");
    if (!btn) return;
    filters.category = btn.dataset.cat;
    renderCategoryPills();
    renderExtraResources();
    renderExamList();
  });
  document.getElementById("filter-search").addEventListener("input", (e) => { filters.search = e.target.value; renderExamList(); });
  document.getElementById("filter-exam-subtopic").addEventListener("change", (e) => { filters.examSubtopic = e.target.value; renderExamList(); });
  document.getElementById("filter-paper").addEventListener("change", (e) => { filters.paper = e.target.value; renderExamList(); });
  document.getElementById("filter-status").addEventListener("change", (e) => { filters.status = e.target.value; renderExamList(); });
  document.getElementById("filter-sort").addEventListener("change", (e) => { filters.sort = e.target.value; renderExamList(); });

  const examList = document.getElementById("exam-list");
  examList.addEventListener("click", (e) => {
    const ob = e.target.closest("[data-open-btn]");
    if (ob) return openExamDrawer(ob.dataset.openBtn);
    if (e.target.closest("[data-stop-row]")) return;
    const row = e.target.closest("[data-exam-id]");
    if (row) openExamDrawer(row.dataset.examId);
  });
  examList.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      const row = e.target.closest("[data-exam-id]");
      if (row && !e.target.closest("[data-stop-row]")) {
        e.preventDefault();
        openExamDrawer(row.dataset.examId);
      }
    }
  });

  // Bank filters
  document.getElementById("bank-scope-pills").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-bscope]");
    if (!btn) return;
    filters.bankScope = btn.dataset.bscope;
    bankPageLimit = 60;
    renderBankView();
  });
  document.getElementById("bank-search").addEventListener("input", (e) => { filters.bankSearch = e.target.value; bankPageLimit = 60; renderBankView(); });
  document.getElementById("bank-topic").addEventListener("change", (e) => { filters.bankTopic = e.target.value; bankPageLimit = 60; renderBankView(); });
  document.getElementById("bank-subtopic").addEventListener("change", (e) => { filters.bankSubtopic = e.target.value; bankPageLimit = 60; renderBankView(); });
  document.getElementById("bank-status").addEventListener("change", (e) => { filters.bankStatus = e.target.value; bankPageLimit = 60; renderBankView(); });
  document.getElementById("bank-sol").addEventListener("change", (e) => { filters.bankSol = e.target.value; bankPageLimit = 60; renderBankView(); });

  // Timer HUD controls
  document.getElementById("btn-timer-toggle").addEventListener("click", () => timer.toggle());
  document.getElementById("btn-timer-reset").addEventListener("click", () => timer.reset());
  document.getElementById("btn-timer-mute").addEventListener("click", () => timer.toggleMute());
  document.getElementById("btn-timer-close").addEventListener("click", () => timer.close());
  document.getElementById("btn-timer-finish").addEventListener("click", () => {
    const res = timer.finish();
    if (!res) return;
    if (res.mode === "exercise" && res.examId && res.qNum) {
      updateExercise(state, res.examId, res.qNum, { timeSpentSec: res.elapsedSec }, syncConfig.role);
      showToast(`Guardados ${formatDurationCompact(res.elapsedSec)} en Ej. ${res.qNum}`);
    } else if (res.mode === "exam" && res.examId) {
      updateExamFields(state, res.examId, { durationMin: Math.max(1, Math.round(res.elapsedSec / 60)), mode: "simulacro" }, syncConfig.role);
      showToast(`Simulacro guardado: ${Math.max(1, Math.round(res.elapsedSec / 60))} min`);
    }
    renderAll();
    if (openExamId === res.examId) renderExamDrawer();
  });

  // Drawer close
  document.getElementById("btn-close-drawer").addEventListener("click", closeExamDrawer);
  document.getElementById("exam-drawer-overlay").addEventListener("click", (e) => {
    if (e.target.id === "exam-drawer-overlay") closeExamDrawer();
  });

  // Countdowns modal
  document.getElementById("countdown-form").addEventListener("submit", (e) => {
    e.preventDefault();
    updateSettings(state, {
      countdowns: {
        mock: {
          label: document.getElementById("cd-mock-label").value.trim(),
          date: document.getElementById("cd-mock-date").value,
          detail: document.getElementById("cd-mock-detail").value.trim()
        },
        official: {
          label: document.getElementById("cd-off-label").value.trim(),
          date: document.getElementById("cd-off-date").value,
          detail: document.getElementById("cd-off-detail").value.trim()
        }
      }
    });
    closeModal("countdown-modal-backdrop");
    renderHudStrip();
    showToast("Contadores actualizados");
  });

  // Reset syllabus
  document.getElementById("btn-reset-syllabus").addEventListener("click", () => {
    updateSettings(state, { syllabusStatus: createDefaultSyllabusMap() });
    openSyllabusModal();
    renderAll();
    showToast("Temario inicial restaurado");
  });

  // History & manual log
  document.getElementById("queue-topic-filter").addEventListener("change", (e) => { filters.queueTopic = e.target.value; renderHistoryView(); });
  document.getElementById("btn-open-log-modal").addEventListener("click", () => { document.getElementById("log-date").value = todayISO(); openModal("log-modal-backdrop"); });
  document.getElementById("log-session-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const nums = document.getElementById("log-exercises").value.split(/[,\s;]+/).map(Number).filter((n) => Number.isFinite(n) && n >= 1);
    logExercisesSession(state, document.getElementById("log-exam").value, document.getElementById("log-date").value || todayISO(), nums, document.getElementById("log-summary").value, syncConfig.role);
    e.target.reset();
    closeModal("log-modal-backdrop");
    renderAll();
    showToast("Sesión añadida al historial");
  });

  // Notes form & filters
  document.getElementById("note-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const editId = document.getElementById("note-edit-id").value;
    addOrUpdateNote(state, {
      id: editId || undefined,
      title: document.getElementById("note-title").value,
      date: document.getElementById("note-date").value || todayISO(),
      category: document.getElementById("note-category").value,
      topic: document.getElementById("note-topic").value,
      examId: document.getElementById("note-exam").value,
      body: document.getElementById("note-body").value,
      pinned: document.getElementById("note-pinned").checked
    }, syncConfig.role);
    resetNoteForm();
    renderAll();
    showToast(editId ? "Nota actualizada" : "Nota guardada");
  });
  document.getElementById("btn-note-cancel").addEventListener("click", resetNoteForm);
  document.getElementById("notes-scope-pills").addEventListener("click", (e) => { const b = e.target.closest("[data-nscope]"); if (b) { filters.noteScope = b.dataset.nscope; renderNotesView(); } });
  document.getElementById("notes-search").addEventListener("input", (e) => { filters.noteSearch = e.target.value; renderNotesView(); });
  document.getElementById("notes-filter-cat").addEventListener("change", (e) => { filters.noteCategory = e.target.value; renderNotesView(); });
  document.getElementById("notes-filter-topic").addEventListener("change", (e) => { filters.noteTopic = e.target.value; renderNotesView(); });

  // 4-step Drive Sync wizard controls
  document.getElementById("btn-copy-script").addEventListener("click", async () => {
    const btn = document.getElementById("btn-copy-script");
    try {
      await navigator.clipboard.writeText(APPS_SCRIPT_CODE);
      const orig = btn.textContent;
      btn.textContent = "✓ Script copiado al portapapeles";
      showToast("Script Code.gs copiado — pégalo ahora en script.new");
      setTimeout(() => { btn.textContent = orig; }, 2400);
    } catch {
      const box = document.getElementById("apps-script-box");
      if (box) box.hidden = false;
      showToast("Desplegamos el código abajo para que puedas copiarlo manualmente");
    }
  });

  document.getElementById("btn-toggle-script-preview").addEventListener("click", () => {
    const box = document.getElementById("apps-script-box");
    const btn = document.getElementById("btn-toggle-script-preview");
    if (!box) return;
    box.hidden = !box.hidden;
    btn.textContent = box.hidden ? "Ver código" : "Ocultar código";
  });

  document.getElementById("btn-generate-room").addEventListener("click", () => {
    const inp = document.getElementById("sync-room-code");
    inp.value = generateRoomCode();
    inp.focus();
  });

  document.getElementById("btn-sync-connect").addEventListener("click", async () => {
    const scriptUrl = document.getElementById("sync-script-url").value.trim();
    let roomCode = document.getElementById("sync-room-code").value.trim();
    if (!roomCode) {
      roomCode = generateRoomCode();
      document.getElementById("sync-room-code").value = roomCode;
    }
    const check = validateScriptUrl(scriptUrl);
    if (!check.ok) return showToast(check.error);

    const btn = document.getElementById("btn-sync-connect");
    const orig = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Probando conexión…";
    try {
      await syncClient.testConnection(check.url, roomCode);
      syncConfig = saveSyncConfig({ ...syncConfig, enabled: true, scriptUrl: check.url, roomCode });
      await syncClient.connect(syncConfig, state);
      populateSettingsModal();
      showToast("¡Conectado gratis con tu Google Drive!");
    } catch (err) {
      showToast(err.message || "Error al conectar con Google Drive");
    } finally {
      btn.disabled = false;
      btn.textContent = orig;
    }
  });

  document.getElementById("btn-copy-student-link").addEventListener("click", copyStudentInviteLink);
  document.getElementById("btn-copy-student-link-wizard").addEventListener("click", copyStudentInviteLink);

  document.getElementById("btn-sync-disconnect").addEventListener("click", () => {
    syncClient.disconnect();
    syncConfig = saveSyncConfig({ ...syncConfig, enabled: false });
    syncClient.setStatus("local", "Solo guardado local");
    populateSettingsModal();
    showToast("Sincronización desconectada (modo local)");
  });

  document.getElementById("set-curve-preset").addEventListener("change", (e) => {
    const preset = IB_CURVE_PRESETS.find((p) => p.id === e.target.value);
    if (!preset) return;
    preset.boundaries.forEach((v, idx) => {
      const inp = document.querySelector(`[data-bound-idx="${idx}"]`);
      if (inp) inp.value = v;
    });
  });

  document.getElementById("btn-save-settings").addEventListener("click", () => {
    const nextRole = document.getElementById("set-role").value;
    syncConfig = saveSyncConfig({ ...syncConfig, role: nextRole });
    syncClient.config = syncConfig;
    const bounds = [];
    document.querySelectorAll("[data-bound-idx]").forEach((inp) => { bounds[Number(inp.dataset.boundIdx)] = Number(inp.value); });
    updateSettings(state, {
      studentName: document.getElementById("set-student-name").value.trim(),
      targetSession: document.getElementById("set-target-session").value.trim(),
      hideSolutionsForStudent: document.getElementById("set-hide-solutions").checked,
      gradeBoundaries: normalizeBoundaries(bounds)
    });
    renderAll();
    if (openExamId) renderExamDrawer();
    showToast("Ajustes guardados");
  });

  document.getElementById("btn-export-json").addEventListener("click", () => {
    triggerDownload(`cuaderno-ib-mai-${todayISO()}.json`, buildExportPayload(state), "application/json");
    populateSettingsModal();
    showToast("Copia JSON descargada");
  });
  document.getElementById("btn-export-csv").addEventListener("click", () => {
    triggerDownload(`resultados-ib-mai-${todayISO()}.csv`, buildCSVExport(state), "text/csv;charset=utf-8");
    showToast("CSV exportado");
  });
  document.getElementById("import-json-file").addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const mode = document.getElementById("import-mode").value;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        state = importBackupJSON(state, String(reader.result || ""), mode);
        if (syncClient.config.enabled) syncClient.pushFullState(state, { silent: true });
        renderAll();
        if (openExamId) renderExamDrawer();
        showToast("Copia importada correctamente");
      } catch (err) {
        showToast(err.message || "Error al importar JSON");
      }
      e.target.value = "";
    };
    reader.readAsText(f);
  });

  document.getElementById("btn-clear-all").addEventListener("click", () => {
    if (!window.confirm("¿Seguro que quieres reiniciar los datos locales de este navegador?")) return;
    state = createDefaultState();
    saveState(state);
    closeExamDrawer();
    renderAll();
    showToast("Datos locales reiniciados");
  });

  document.getElementById("btn-modal-print").addEventListener("click", () => { closeModal("settings-modal-backdrop"); buildPrintReportAndPrint(); });

  document.querySelectorAll("[data-close-modal]").forEach((btn) => btn.addEventListener("click", () => closeModal(btn.dataset.closeModal)));
  document.querySelectorAll(".modal-backdrop").forEach((bd) => bd.addEventListener("click", (e) => { if (e.target === bd) closeModal(bd.id); }));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeToolsMenu();
      document.querySelectorAll(".modal-backdrop").forEach((m) => closeModal(m.id));
      closeExamDrawer();
    }
  });
}

// Auto-importar enlace de invitación del alumno (?sync=...&role=alumno)
const invite = parseInviteFromSearch(window.location.search);
if (invite) {
  syncConfig = saveSyncConfig(invite);
  try {
    window.history.replaceState({}, document.title, window.location.pathname);
  } catch {
    // ignorar
  }
}

populateStaticSelects();
bindGlobalEvents();
renderAll();
updateSyncUI(syncConfig.enabled ? "connecting" : "local", syncConfig.enabled ? "Conectando con Google Drive…" : "Solo guardado local");

// Conectar automáticamente con Google Drive si ya estaba configurado
if (syncConfig.enabled) {
  syncClient.connect(syncConfig, state);
}

// Refrescar contadores cada minuto
setInterval(renderHudStrip, 60000);

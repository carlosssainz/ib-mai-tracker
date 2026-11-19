import {
  DRIVE_ROOT_URL,
  EXAMS,
  EXTRA_RESOURCES,
  MAI_TOPICS,
  NOTE_CATEGORIES,
  EXAM_STATUSES,
  EXERCISE_STATUSES,
  PRACTICE_MODES,
  DEFAULT_GRADE_BOUNDARIES
} from "./data.js";

import {
  loadState,
  saveState,
  createDefaultState,
  todayISO,
  getExamDef,
  ensureExamRecord,
  getQuestionMaxMarks,
  getExamDerived,
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
  getReviewQueue,
  getExamAndExerciseNotes,
  getGlobalStats,
  buildExportPayload,
  importBackupJSON,
  buildCSVExport,
  normalizeBoundaries
} from "./store.js";

import {
  renderEvolutionChart,
  renderTopicsMastery
} from "./charts.js";

const TOPIC_MAP = Object.fromEntries(MAI_TOPICS.map((t) => [t.id, t]));
const NOTE_CAT_MAP = Object.fromEntries(NOTE_CATEGORIES.map((c) => [c.id, c]));
const MODE_MAP = Object.fromEntries(PRACTICE_MODES.map((m) => [m.id, m]));
const EXAM_STATUS_MAP = Object.fromEntries(EXAM_STATUSES.map((s) => [s.id, s]));

let state = loadState();
let currentView = "exams";
let openExamId = null;

const filters = {
  category: "all",
  search: "",
  paper: "all",
  status: "all",
  sort: "newest",
  queueTopic: "all",
  noteScope: "all",
  noteSearch: "",
  noteCategory: "all",
  noteTopic: "all"
};

let toastTimer = null;

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
  toastTimer = setTimeout(() => el.classList.remove("is-visible"), 2600);
}

function formatDateES(iso) {
  if (!iso) return "";
  const parts = iso.split("-");
  if (parts.length !== 3) return iso;
  const months = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  const mIdx = Number(parts[1]) - 1;
  return `${Number(parts[2])} ${months[mIdx] || parts[1]} ${parts[0]}`;
}

function gradeBadgeClass(grade) {
  if (!grade) return "";
  if (grade >= 6) return "ib-badge--high";
  if (grade >= 4) return "ib-badge--mid";
  return "ib-badge--low";
}

function statusTagClass(status) {
  if (status === "completado") return "tag--sol";
  if (status === "en-progreso") return "tag--info";
  if (status === "repasar") return "tag--warn";
  return "";
}

function applyTheme() {
  const theme = state.settings.theme === "dark" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", theme);
  const btn = document.getElementById("btn-toggle-theme");
  if (btn) {
    btn.textContent = theme === "dark" ? "☀" : "◐";
    btn.title = theme === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro";
  }
}

function updateBrandAndBadges() {
  const stats = getGlobalStats(state);
  const sub = document.getElementById("brand-subtitle");
  const pieces = ["Matemáticas: Aplicaciones e Interpretación · NM"];
  if (state.settings.studentName) pieces.unshift(`Alumno: ${state.settings.studentName}`);
  if (state.settings.targetSession) pieces.push(`Meta: ${state.settings.targetSession}`);
  sub.textContent = pieces.join(" · ");

  document.getElementById("badge-exams").textContent = `${stats.examsWorked}/${stats.examsTotal}`;
  const reviewBadge = document.getElementById("badge-review");
  reviewBadge.textContent = String(stats.reviewQueueCount);
  reviewBadge.classList.toggle("nav-badge--warn", stats.reviewQueueCount > 0);

  const notesBadge = document.getElementById("badge-notes");
  notesBadge.textContent = String(stats.pendingNotesCount);
  notesBadge.classList.toggle("nav-badge--warn", stats.pendingNotesCount > 0);

  const saveInd = document.getElementById("save-indicator");
  if (saveInd) {
    saveInd.innerHTML = `<i class="save-dot"></i> Guardado local`;
  }
}

function renderKPIs() {
  const s = getGlobalStats(state);
  const avgGradeText = s.avgIbGrade !== null ? `IB ${s.avgIbGrade}` : "—";
  const avgPctText = s.avgPercent !== null ? `${s.avgPercent}% de media` : "Sin exámenes puntuados";
  const exDetail = s.exercisesDone > 0
    ? `${s.exercisesBien} bien · ${s.exercisesRepasar} repasar · ${s.exercisesFallado} duda`
    : "Marca ejercicios dentro de cada examen";

  document.getElementById("kpi-strip").innerHTML = `
    <div class="kpi-card">
      <div class="kpi-label">Exámenes trabajados</div>
      <div class="kpi-value tabular">${s.examsWorked} <span class="muted" style="font-size:0.95rem; font-weight:600">/ ${s.examsTotal}</span></div>
      <div class="kpi-sub">${s.examsCompleted} completado${s.examsCompleted === 1 ? "" : "s"}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Ejercicios hechos</div>
      <div class="kpi-value tabular">${s.exercisesDone}</div>
      <div class="kpi-sub">${exDetail}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Nota IB media</div>
      <div class="kpi-value tabular">${avgGradeText}</div>
      <div class="kpi-sub">${avgPctText}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Pendiente de repaso</div>
      <div class="kpi-value tabular">${s.reviewQueueCount + s.pendingNotesCount}</div>
      <div class="kpi-sub">${s.reviewQueueCount} ejercicio${s.reviewQueueCount === 1 ? "" : "s"} · ${s.pendingNotesCount} nota${s.pendingNotesCount === 1 ? "" : "s"}</div>
    </div>
  `;
}

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
    { id: "mai-2021", label: "01 · MAI NM (2021)" },
    { id: "con-solucion", label: "02 · Con Soluciones (2015–2018)" },
    { id: "solo-enunciado", label: "03 · Solo Enunciados (2000–2016)" },
    { id: "retos-otros", label: "04 · Retos / Otros (2020)" }
  ];
  document.getElementById("category-pills").innerHTML = defs.map((d) => `
    <button type="button" class="pill ${filters.category === d.id ? "is-active" : ""}" data-cat="${d.id}">
      ${esc(d.label)} <span class="pill-count tabular">${counts[d.id]}</span>
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
  host.innerHTML = `
    <div class="resource-strip">
      <div class="resource-strip-info">
        <span class="tag tag--info">Guía práctica</span>
        <strong>${esc(g.title)}</strong>
        <span class="muted">${esc(g.subtitle)}</span>
      </div>
      <a class="btn btn-soft btn-sm" href="${esc(g.url)}" target="_blank" rel="noopener">Abrir guía PDF ↗</a>
    </div>
  `;
}

function getFilteredExams() {
  const q = filters.search.trim().toLowerCase();
  const boundaries = state.settings.gradeBoundaries;

  const list = EXAMS.map((def) => {
    const rec = state.exams[def.id];
    const derived = getExamDerived(def, rec, boundaries);
    return { def, rec, derived };
  }).filter(({ def, rec, derived }) => {
    if (filters.category !== "all" && def.category !== filters.category) return false;
    if (filters.paper !== "all" && String(def.paper) !== filters.paper) return false;
    if (filters.status !== "all" && derived.status !== filters.status) return false;
    if (q) {
      const hay = [
        def.title,
        def.folderLabel,
        def.subject,
        String(def.year),
        def.session,
        `p${def.paper}`,
        rec ? rec.examNotes || "" : ""
      ].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  if (filters.sort === "oldest") {
    list.sort((a, b) => a.def.year - b.def.year || a.def.sessionNum - b.def.sessionNum || a.def.paper - b.def.paper);
  } else if (filters.sort === "practiced") {
    list.sort((a, b) => (b.derived.lastPracticed || "").localeCompare(a.derived.lastPracticed || "") || b.def.year - a.def.year);
  } else if (filters.sort === "grade-asc") {
    list.sort((a, b) => {
      const ga = a.derived.ibGrade ?? 99;
      const gb = b.derived.ibGrade ?? 99;
      if (ga !== gb) return ga - gb;
      return (a.derived.percent ?? 999) - (b.derived.percent ?? 999);
    });
  } else {
    list.sort((a, b) => b.def.year - a.def.year || b.def.sessionNum - a.def.sessionNum || a.def.paper - b.def.paper);
  }

  return list;
}

function renderExamList() {
  const items = getFilteredExams();
  document.getElementById("catalog-count").textContent =
    `Mostrando ${items.length} de ${EXAMS.length} exámenes`;

  const host = document.getElementById("exam-list");
  if (items.length === 0) {
    host.innerHTML = `
      <div class="empty-state">
        <strong>No hay exámenes que coincidan con estos filtros.</strong>
        <p style="margin:0.4rem 0 0; font-size:0.84rem">Prueba a limpiar la búsqueda o cambiar el bloque seleccionado.</p>
      </div>
    `;
    return;
  }

  host.innerHTML = items.map(({ def, derived }) => {
    const pBien = derived.totalQuestions ? (derived.bienCount / derived.totalQuestions) * 100 : 0;
    const pRep = derived.totalQuestions ? (derived.repasarCount / derived.totalQuestions) * 100 : 0;
    const pFail = derived.totalQuestions ? (derived.falladoCount / derived.totalQuestions) * 100 : 0;

    const statusObj = EXAM_STATUS_MAP[derived.status] || EXAM_STATUSES[0];
    const subjectTag = def.subject === "MAI NM"
      ? `<span class="tag tag--mai">MAI NM · Actual</span>`
      : def.subject === "Matemáticas NM"
        ? `<span class="tag tag--warn">Mat. NM${def.calculator ? "" : " · Sin calc."}</span>`
        : `<span class="tag">Estudios NM</span>`;

    const solBadge = def.hasSolution ? `<span class="tag tag--sol">Con solución</span>` : "";
    const statusBadge = derived.status !== "pendiente"
      ? `<span class="tag ${statusTagClass(derived.status)}">${esc(statusObj.label)}</span>`
      : "";
    const noteCount = (derived.hasNotes ? 1 : 0) + derived.exerciseNotesCount;
    const noteChip = noteCount > 0 ? `<span>· ${noteCount} nota${noteCount === 1 ? "" : "s"}</span>` : "";

    const scorePrimary = derived.score !== null
      ? `${derived.score}/${derived.maxMarks}`
      : derived.ibGrade
        ? `Nota IB ${derived.ibGrade}`
        : "Sin nota";
    const scoreSecondary = derived.percent !== null
      ? `${derived.percent}%`
      : derived.lastPracticed
        ? formatDateES(derived.lastPracticed)
        : `Máx. ${derived.maxMarks} pts`;

    return `
      <article class="exam-row" data-exam-id="${esc(def.id)}" tabindex="0" role="button" aria-label="Abrir ${esc(def.title)}">
        <div class="exam-main">
          <div class="exam-title-line">
            <span class="exam-title">${esc(def.year)} ${esc(def.session)} · Prueba ${def.paper}</span>
            ${subjectTag}
            ${solBadge}
            ${statusBadge}
          </div>
          <div class="exam-sub">
            <span>${esc(def.folderLabel)}</span>
            ${derived.lastPracticed ? `<span>· Última vez: ${esc(formatDateES(derived.lastPracticed))}</span>` : ""}
            ${derived.attemptsCount > 0 ? `<span>· ${derived.attemptsCount} intento${derived.attemptsCount === 1 ? "" : "s"}</span>` : ""}
            ${noteChip}
          </div>
        </div>

        <div class="exam-progress-col">
          <div class="mini-progress-label tabular">
            <span>Ejercicios: <strong>${derived.doneCount}/${derived.totalQuestions}</strong></span>
            <span class="muted">${derived.bienCount ? `${derived.bienCount}✓` : ""} ${derived.repasarCount ? `${derived.repasarCount}!` : ""} ${derived.falladoCount ? `${derived.falladoCount}✕` : ""}</span>
          </div>
          <div class="mini-bar" aria-hidden="true">
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
          <div class="ib-badge ${gradeBadgeClass(derived.ibGrade)}" title="${derived.ibGrade ? `Nota IB ${derived.ibGrade}` : "Sin calificación IB"}">
            ${derived.ibGrade ?? "—"}
          </div>
        </div>

        <div class="exam-actions-col" data-stop-row="true">
          <a class="btn btn-sm" href="${esc(def.enunciadoUrl)}" target="_blank" rel="noopener" title="Abrir enunciado PDF en Google Drive">Enunciado ↗</a>
          ${def.solucionUrl
            ? `<a class="btn btn-good btn-sm" href="${esc(def.solucionUrl)}" target="_blank" rel="noopener" title="Abrir esquema de calificación en Google Drive">Solución ↗</a>`
            : `<button type="button" class="btn btn-soft btn-sm" data-open-btn="${esc(def.id)}">Registrar</button>`}
        </div>
      </article>
    `;
  }).join("");
}

/* ==========================================================================
   Exam Detail Drawer
   ========================================================================== */

function openExamDrawer(examId) {
  const def = getExamDef(examId);
  if (!def) return;
  openExamId = examId;
  renderExamDrawer();
  const overlay = document.getElementById("exam-drawer-overlay");
  overlay.classList.add("is-open");
  overlay.setAttribute("aria-hidden", "false");
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
  const derived = getExamDerived(def, rec, state.settings.gradeBoundaries);

  document.getElementById("drawer-exam-title").textContent = def.title;

  const linkHtml = [
    `<a class="btn btn-primary btn-sm" href="${esc(def.enunciadoUrl)}" target="_blank" rel="noopener">Abrir Enunciado PDF ↗</a>`,
    def.solucionUrl
      ? `<a class="btn btn-good btn-sm" href="${esc(def.solucionUrl)}" target="_blank" rel="noopener">Abrir Solución / Esquema ↗</a>`
      : `<span class="tag">Solo enunciado en Drive</span>`,
    !def.calculator ? `<span class="tag tag--warn">Prueba sin calculadora (Mat. NM)</span>` : `<span class="tag">Calculadora gráfica (GDC)</span>`
  ].join("");
  document.getElementById("drawer-exam-links").innerHTML = linkHtml;

  const statusOpts = EXAM_STATUSES.map((s) =>
    `<option value="${s.id}" ${derived.status === s.id ? "selected" : ""}>${esc(s.label)}</option>`
  ).join("");
  const modeOpts = PRACTICE_MODES.map((m) =>
    `<option value="${m.id}" ${derived.mode === m.id ? "selected" : ""}>${esc(m.label)}</option>`
  ).join("");

  const gradeButtons = [1, 2, 3, 4, 5, 6, 7].map((g) => {
    const isManual = derived.manualGrade === g;
    const isAuto = !derived.manualGrade && derived.autoGrade === g;
    return `<button type="button" class="ib-grade-btn tabular ${isManual ? "is-active" : isAuto ? "is-auto" : ""}" data-set-grade="${g}" title="Seleccionar Nota IB ${g}">${g}</button>`;
  }).join("");

  const exercises = rec && rec.exercises ? rec.exercises : {};
  const topicOptsHtml = (selected) =>
    `<option value="">Tema MAI…</option>` +
    MAI_TOPICS.map((t) => `<option value="${t.id}" ${selected === t.id ? "selected" : ""}>${esc(t.short)}</option>`).join("");

  let exRowsHtml = "";
  for (let q = 1; q <= derived.totalQuestions; q++) {
    const ex = exercises[String(q)] || {
      status: "pendiente",
      points: null,
      maxPoints: getQuestionMaxMarks(def, q),
      topic: "",
      note: ""
    };
    const qMax = ex.maxPoints ?? getQuestionMaxMarks(def, q);
    const st = ex.status || "pendiente";
    const rowCls = st !== "pendiente" ? `exercise-item--${st}` : "";
    const segBtns = EXERCISE_STATUSES.map((s) =>
      `<button type="button" data-q="${q}" data-st="${s.id}" class="${st === s.id ? "is-active" : ""}" title="${esc(s.label)}">${esc(s.short)}</button>`
    ).join("");

    exRowsHtml += `
      <div class="exercise-item ${rowCls}" data-ex-row="${q}">
        <div class="exercise-top">
          <span class="exercise-num mono">Ej. ${q}</span>
          <div class="status-seg" role="group" aria-label="Estado ejercicio ${q}">${segBtns}</div>
          <div class="pts-inline tabular">
            <input type="number" step="0.5" min="0" max="99" class="input" data-q-pts="${q}" value="${ex.points ?? ""}" placeholder="Pts" aria-label="Puntos ejercicio ${q}" />
            <span class="muted">/</span>
            <input type="number" step="0.5" min="1" max="99" class="input" data-q-max="${q}" value="${qMax}" aria-label="Máximo ejercicio ${q}" />
          </div>
          <select class="select" style="padding:0.28rem 0.5rem; font-size:0.8rem" data-q-topic="${q}" aria-label="Tema MAI ejercicio ${q}">
            ${topicOptsHtml(ex.topic || "")}
          </select>
        </div>
        <input type="text" class="input exercise-note-input" data-q-note="${q}" value="${esc(ex.note || "")}" placeholder="Nota rápida de este ejercicio (ej. error de redondeo, truco TI-84, repasar apartado b)…" />
      </div>
    `;
  }

  const attempts = rec && Array.isArray(rec.attempts) ? rec.attempts : [];
  const attemptsHtml = attempts.length
    ? `<div class="attempts-list">${attempts.map((a) => `
        <div class="attempt-row">
          <div>
            <strong>${esc(formatDateES(a.date))}</strong>
            <span class="tag" style="margin-left:0.35rem">${esc((MODE_MAP[a.mode] || PRACTICE_MODES[0]).label)}</span>
            <div class="muted" style="margin-top:0.15rem">${esc(a.summary)}</div>
          </div>
          <div style="display:flex; align-items:center; gap:0.45rem">
            ${a.ibGrade ? `<span class="ib-badge ${gradeBadgeClass(a.ibGrade)}" style="width:28px; height:28px; font-size:0.84rem">${a.ibGrade}</span>` : ""}
            <button type="button" class="btn btn-ghost btn-sm" data-del-attempt="${esc(a.id)}" title="Eliminar intento">✕</button>
          </div>
        </div>
      `).join("")}</div>`
    : `<p class="muted" style="font-size:0.81rem; margin:0.6rem 0 0">Aún no hay intentos guardados en el historial para este examen.</p>`;

  document.getElementById("drawer-exam-body").innerHTML = `
    <div class="panel-card">
      <div class="panel-card-head">
        <h3>Resultado global y calificación IB</h3>
        <div style="display:flex; align-items:center; gap:0.45rem">
          ${derived.hasExercisePoints ? `<button type="button" class="btn btn-soft btn-sm" id="btn-apply-ex-sum">Sumar ejercicios (${derived.exercisePointsEarned}/${derived.exercisePointsMax})</button>` : ""}
        </div>
      </div>

      <div class="form-grid-3" style="margin-bottom:0.8rem">
        <div>
          <label class="field-label" for="dx-status">Estado</label>
          <select id="dx-status" class="select">${statusOpts}</select>
        </div>
        <div>
          <label class="field-label" for="dx-mode">Modalidad</label>
          <select id="dx-mode" class="select">${modeOpts}</select>
        </div>
        <div>
          <label class="field-label" for="dx-date">Fecha de práctica</label>
          <input id="dx-date" class="input" type="date" value="${esc(derived.lastPracticed || todayISO())}" />
        </div>
      </div>

      <div class="form-grid-2">
        <div>
          <div class="score-row">
            <div>
              <label class="field-label" for="dx-score">Puntuación</label>
              <input id="dx-score" class="input tabular" type="number" step="0.5" min="0" max="300" value="${derived.score ?? ""}" placeholder="Ej. 64" />
            </div>
            <span class="score-slash">/</span>
            <div>
              <label class="field-label" for="dx-max">Máximo</label>
              <input id="dx-max" class="input tabular" type="number" step="1" min="1" max="300" value="${derived.maxMarks}" />
            </div>
            <div>
              <label class="field-label" for="dx-duration">Min.</label>
              <input id="dx-duration" class="input tabular" style="width:74px" type="number" min="5" max="300" value="${rec && rec.durationMin ? rec.durationMin : ""}" placeholder="90" />
            </div>
          </div>
        </div>

        <div>
          <span class="field-label">Selección rápida de Nota IB (1–7) ${derived.manualGrade ? `<button type="button" class="btn btn-ghost btn-sm" id="btn-clear-manual-grade" style="padding:0 0.35rem; font-size:0.74rem">Usar automática</button>` : ""}</span>
          <div class="ib-selector">${gradeButtons}</div>
        </div>
      </div>

      <div class="score-summary-box tabular" id="dx-score-summary">
        <div>
          <strong>Resultado actual:</strong>
          ${derived.score !== null ? `${derived.score}/${derived.maxMarks} (${derived.percent}%)` : "Sin puntuación numérica"}
          · <strong>Nota IB: ${derived.ibGrade ?? "—"}</strong>
          ${derived.manualGrade ? `<span class="muted">(seleccionada manualmente)</span>` : derived.autoGrade ? `<span class="muted">(calculada automáticamente)</span>` : ""}
        </div>
        <div style="display:flex; gap:0.4rem; flex-wrap:wrap">
          <button type="button" class="btn btn-primary btn-sm" id="btn-save-attempt">Guardar intento en historial</button>
        </div>
      </div>

      ${attemptsHtml}
    </div>

    <div class="panel-card">
      <div class="panel-card-head">
        <h3>Ejercicios del examen (${derived.doneCount}/${derived.totalQuestions} hechos)</h3>
        <div style="display:flex; gap:0.35rem; flex-wrap:wrap">
          <button type="button" class="btn btn-soft btn-sm" id="btn-log-ex-today">Registrar sesión en historial</button>
          <button type="button" class="btn btn-sm" id="btn-mark-all-bien">Marcar todos Bien</button>
          <button type="button" class="btn btn-sm" id="btn-add-question">+ Ejercicio</button>
        </div>
      </div>
      <div class="exercise-list" id="drawer-exercise-list">
        ${exRowsHtml}
      </div>
    </div>

    <div class="panel-card">
      <div class="panel-card-head">
        <h3>Notas generales de este examen</h3>
        <span class="muted" style="font-size:0.78rem">Aparecen también en «Notas y Repaso»</span>
      </div>
      <textarea id="dx-notes" class="textarea" rows="4" placeholder="Escribe conclusiones del examen, tiempo sobrante o faltante, dudas para la siguiente clase o fórmulas que conviene repasar…">${esc(rec ? rec.examNotes || "" : "")}</textarea>
    </div>
  `;

  bindDrawerEvents();
}

function updateDrawerLiveSummary() {
  if (!openExamId) return;
  const def = getExamDef(openExamId);
  const rec = state.exams[openExamId] || null;
  const derived = getExamDerived(def, rec, state.settings.gradeBoundaries);
  const box = document.getElementById("dx-score-summary");
  if (box) {
    box.querySelector("div").innerHTML = `
      <strong>Resultado actual:</strong>
      ${derived.score !== null ? `${derived.score}/${derived.maxMarks} (${derived.percent}%)` : "Sin puntuación numérica"}
      · <strong>Nota IB: ${derived.ibGrade ?? "—"}</strong>
      ${derived.manualGrade ? `<span class="muted">(seleccionada manualmente)</span>` : derived.autoGrade ? `<span class="muted">(calculada automáticamente)</span>` : ""}
    `;
  }
  // Highlight auto/manual grade buttons
  document.querySelectorAll(".ib-grade-btn").forEach((btn) => {
    const g = Number(btn.dataset.setGrade);
    btn.classList.toggle("is-active", derived.manualGrade === g);
    btn.classList.toggle("is-auto", !derived.manualGrade && derived.autoGrade === g);
  });
  // Refresh sum button if present
  const sumBtn = document.getElementById("btn-apply-ex-sum");
  if (sumBtn && derived.hasExercisePoints) {
    sumBtn.textContent = `Sumar ejercicios (${derived.exercisePointsEarned}/${derived.exercisePointsMax})`;
  }
  updateBrandAndBadges();
  renderKPIs();
  renderExamList();
}

function bindDrawerEvents() {
  const examId = openExamId;
  if (!examId) return;

  document.getElementById("dx-status").addEventListener("change", (e) => {
    updateExamFields(state, examId, { status: e.target.value });
    updateDrawerLiveSummary();
    showToast("Estado del examen actualizado");
  });

  document.getElementById("dx-mode").addEventListener("change", (e) => {
    updateExamFields(state, examId, { mode: e.target.value });
    updateDrawerLiveSummary();
  });

  document.getElementById("dx-date").addEventListener("change", (e) => {
    updateExamFields(state, examId, { lastPracticed: e.target.value });
    updateDrawerLiveSummary();
  });

  document.getElementById("dx-score").addEventListener("input", (e) => {
    const raw = e.target.value;
    updateExamFields(state, examId, { score: raw === "" ? null : Number(raw), manualGrade: null });
    updateDrawerLiveSummary();
  });

  document.getElementById("dx-max").addEventListener("input", (e) => {
    const val = Number(e.target.value);
    if (val > 0) {
      updateExamFields(state, examId, { maxMarks: val });
      updateDrawerLiveSummary();
    }
  });

  document.getElementById("dx-duration").addEventListener("input", (e) => {
    const raw = e.target.value;
    updateExamFields(state, examId, { durationMin: raw === "" ? null : Number(raw) });
  });

  document.getElementById("dx-notes").addEventListener("input", (e) => {
    updateExamFields(state, examId, { examNotes: e.target.value });
    updateBrandAndBadges();
    renderExamList();
  });

  document.querySelectorAll("[data-set-grade]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const g = Number(btn.dataset.setGrade);
      updateExamFields(state, examId, { manualGrade: g });
      renderExamDrawer();
      updateBrandAndBadges();
      renderKPIs();
      renderExamList();
      showToast(`Nota IB ${g} seleccionada`);
    });
  });

  const clearManBtn = document.getElementById("btn-clear-manual-grade");
  if (clearManBtn) {
    clearManBtn.addEventListener("click", () => {
      updateExamFields(state, examId, { manualGrade: null });
      renderExamDrawer();
      updateBrandAndBadges();
      renderKPIs();
      renderExamList();
    });
  }

  const applySumBtn = document.getElementById("btn-apply-ex-sum");
  if (applySumBtn) {
    applySumBtn.addEventListener("click", () => {
      applyExerciseSumToExam(state, examId);
      renderExamDrawer();
      updateBrandAndBadges();
      renderKPIs();
      renderExamList();
      showToast("Suma de ejercicios aplicada al resultado global");
    });
  }

  document.getElementById("btn-save-attempt").addEventListener("click", () => {
    saveExamAttempt(state, examId);
    renderExamDrawer();
    renderAll();
    showToast("Intento guardado en el historial");
  });

  document.querySelectorAll("[data-del-attempt]").forEach((btn) => {
    btn.addEventListener("click", () => {
      deleteAttempt(state, examId, btn.dataset.delAttempt);
      renderExamDrawer();
      renderAll();
      showToast("Intento eliminado");
    });
  });

  document.getElementById("btn-add-question").addEventListener("click", () => {
    const rec = ensureExamRecord(state, examId);
    rec.questionCount = (rec.questionCount || 1) + 1;
    saveState(state);
    renderExamDrawer();
    renderExamList();
  });

  document.getElementById("btn-mark-all-bien").addEventListener("click", () => {
    const def = getExamDef(examId);
    const rec = ensureExamRecord(state, examId);
    const total = rec.questionCount || def.defaultQuestions;
    for (let q = 1; q <= total; q++) {
      updateExercise(state, examId, q, { status: "bien" });
    }
    renderExamDrawer();
    renderAll();
    showToast("Todos los ejercicios marcados como Bien");
  });

  document.getElementById("btn-log-ex-today").addEventListener("click", () => {
    const rec = ensureExamRecord(state, examId);
    const worked = Object.entries(rec.exercises)
      .filter(([, ex]) => ex && ex.status && ex.status !== "pendiente")
      .map(([k]) => Number(k));
    if (worked.length === 0) {
      showToast("Marca al menos un ejercicio primero");
      return;
    }
    const dateVal = document.getElementById("dx-date").value || todayISO();
    logExercisesSession(state, examId, dateVal, worked);
    renderAll();
    showToast(`Sesión registrada en historial (${worked.length} ejercicios)`);
  });

  // Exercise segmented status buttons
  const exList = document.getElementById("drawer-exercise-list");
  exList.querySelectorAll("[data-q][data-st]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const q = Number(btn.dataset.q);
      const st = btn.dataset.st;
      updateExercise(state, examId, q, { status: st });
      renderExamDrawer();
      updateBrandAndBadges();
      renderKPIs();
      renderExamList();
    });
  });

  exList.querySelectorAll("[data-q-pts]").forEach((inp) => {
    inp.addEventListener("input", () => {
      const q = Number(inp.dataset.qPts);
      const raw = inp.value;
      updateExercise(state, examId, q, { points: raw === "" ? null : Number(raw) });
      const hadBtn = Boolean(document.getElementById("btn-apply-ex-sum"));
      if (!hadBtn && raw !== "") {
        // Inject sum button without re-rendering inputs and losing focus
        const headActions = document.querySelector("#drawer-exam-body .panel-card-head > div");
        if (headActions) {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "btn btn-soft btn-sm";
          b.id = "btn-apply-ex-sum";
          b.addEventListener("click", () => {
            applyExerciseSumToExam(state, examId);
            renderExamDrawer();
            renderAll();
            showToast("Suma de ejercicios aplicada al resultado global");
          });
          headActions.appendChild(b);
        }
      }
      updateDrawerLiveSummary();
    });
  });

  exList.querySelectorAll("[data-q-max]").forEach((inp) => {
    inp.addEventListener("input", () => {
      const q = Number(inp.dataset.qMax);
      const val = Number(inp.value);
      if (val > 0) {
        updateExercise(state, examId, q, { maxPoints: val });
        updateDrawerLiveSummary();
      }
    });
  });

  exList.querySelectorAll("[data-q-topic]").forEach((sel) => {
    sel.addEventListener("change", () => {
      const q = Number(sel.dataset.qTopic);
      updateExercise(state, examId, q, { topic: sel.value });
      updateBrandAndBadges();
    });
  });

  exList.querySelectorAll("[data-q-note]").forEach((inp) => {
    inp.addEventListener("input", () => {
      const q = Number(inp.dataset.qNote);
      updateExercise(state, examId, q, { note: inp.value });
      renderExamList();
    });
  });
}

/* ==========================================================================
   History View (Charts + Review Queue + Activity Timeline)
   ========================================================================== */

function renderHistoryView() {
  const stats = getGlobalStats(state);
  document.getElementById("evolution-chart-container").innerHTML =
    renderEvolutionChart(stats.evolutionPoints, state.settings.gradeBoundaries);
  document.getElementById("topics-chart-container").innerHTML =
    renderTopicsMastery(stats.topicStats, stats.untaggedExercises);

  // Bind chart point clicks
  document.querySelectorAll("[data-open-exam]").forEach((el) => {
    el.addEventListener("click", () => openExamDrawer(el.dataset.openExam));
  });

  // Review Queue
  let queue = getReviewQueue(state);
  if (filters.queueTopic !== "all") {
    queue = queue.filter((item) => item.topic === filters.queueTopic);
  }
  const qHost = document.getElementById("review-queue-list");
  if (queue.length === 0) {
    qHost.innerHTML = `
      <div class="chart-empty">
        <p class="chart-empty-title">Cola de repaso al día</p>
        <p class="chart-empty-sub">Cualquier ejercicio que marques como «Con ayuda / Repasar» o «Fallado / Duda» aparecerá aquí listo para volver a trabajarlo.</p>
      </div>
    `;
  } else {
    qHost.innerHTML = `<div class="queue-list">${queue.map((item) => {
      const isFail = item.status === "fallado";
      const topicObj = item.topic ? TOPIC_MAP[item.topic] : null;
      const label = item.type === "exercise"
        ? `${item.examDef.shortTitle} · Ejercicio ${item.qNum}`
        : `${item.examDef.title} (Examen marcado para repasar)`;
      return `
        <div class="queue-item ${isFail ? "queue-item--fallado" : "queue-item--repasar"}">
          <div>
            <div style="display:flex; align-items:center; gap:0.4rem; flex-wrap:wrap">
              <strong>${esc(label)}</strong>
              <span class="tag ${isFail ? "tag--bad" : "tag--warn"}">${isFail ? "Fallado / Duda" : "Repasar"}</span>
              ${topicObj ? `<span class="tag">${esc(topicObj.short)}</span>` : ""}
            </div>
            ${item.note ? `<div class="muted" style="font-size:0.82rem; margin-top:0.25rem">${esc(item.note)}</div>` : ""}
            ${item.date ? `<div class="muted" style="font-size:0.75rem; margin-top:0.15rem">${esc(formatDateES(item.date))}</div>` : ""}
          </div>
          <div style="display:flex; gap:0.3rem; flex-shrink:0">
            ${item.type === "exercise"
              ? `<button type="button" class="btn btn-good btn-sm" data-resolve-ex="${esc(item.examId)}" data-resolve-q="${item.qNum}" title="Marcar ejercicio como dominado">✓ Bien</button>`
              : ""}
            <button type="button" class="btn btn-sm" data-jump-exam="${esc(item.examId)}">Abrir</button>
          </div>
        </div>
      `;
    }).join("")}</div>`;

    qHost.querySelectorAll("[data-jump-exam]").forEach((b) => {
      b.addEventListener("click", () => openExamDrawer(b.dataset.jumpExam));
    });
    qHost.querySelectorAll("[data-resolve-ex]").forEach((b) => {
      b.addEventListener("click", () => {
        updateExercise(state, b.dataset.resolveEx, Number(b.dataset.resolveQ), { status: "bien" });
        renderAll();
        showToast("Ejercicio marcado como dominado ✓");
      });
    });
  }

  // Timeline
  const tHost = document.getElementById("activity-timeline");
  const logs = [...state.activityLog].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  if (logs.length === 0) {
    tHost.innerHTML = `
      <div class="chart-empty">
        <p class="chart-empty-title">Sin sesiones registradas todavía</p>
        <p class="chart-empty-sub">Guarda un intento desde cualquier examen o pulsa «+ Registrar sesión» para llevar el diario de ejercicios realizados.</p>
      </div>
    `;
  } else {
    tHost.innerHTML = `<div class="timeline-list">${logs.map((entry) => {
      const def = getExamDef(entry.examId);
      const title = def ? def.title : entry.examId;
      const exChips = entry.exerciseNumbers && entry.exerciseNumbers.length
        ? `<span class="tag">Ej. ${entry.exerciseNumbers.join(", ")}</span>`
        : "";
      return `
        <div class="timeline-item">
          <div>
            <div style="display:flex; align-items:center; gap:0.45rem; flex-wrap:wrap">
              <span class="timeline-date tabular">${esc(formatDateES(entry.date))}</span>
              <strong>${esc(title)}</strong>
              ${entry.ibGrade ? `<span class="tag tag--info">IB ${entry.ibGrade}</span>` : ""}
              ${exChips}
            </div>
            <div class="muted" style="font-size:0.83rem; margin-top:0.22rem">${esc(entry.summary)}</div>
          </div>
          <div style="display:flex; gap:0.3rem; flex-shrink:0">
            ${def ? `<button type="button" class="btn btn-sm" data-log-jump="${esc(def.id)}">Abrir</button>` : ""}
            <button type="button" class="btn btn-ghost btn-sm" data-log-del="${esc(entry.id)}" title="Borrar entrada">✕</button>
          </div>
        </div>
      `;
    }).join("")}</div>`;

    tHost.querySelectorAll("[data-log-jump]").forEach((b) => {
      b.addEventListener("click", () => openExamDrawer(b.dataset.logJump));
    });
    tHost.querySelectorAll("[data-log-del]").forEach((b) => {
      b.addEventListener("click", () => {
        deleteActivityEntry(state, b.dataset.logDel);
        renderAll();
        showToast("Entrada eliminada del historial");
      });
    });
  }
}

/* ==========================================================================
   Notes & Review View
   ========================================================================== */

function renderNotesView() {
  document.querySelectorAll("[data-nscope]").forEach((p) => {
    p.classList.toggle("is-active", p.dataset.nscope === filters.noteScope);
  });

  const host = document.getElementById("notes-list");
  const q = filters.noteSearch.trim().toLowerCase();

  if (filters.noteScope === "from-exams") {
    let items = getExamAndExerciseNotes(state);
    if (filters.noteTopic !== "all") {
      items = items.filter((i) => i.topic === filters.noteTopic);
    }
    if (q) {
      items = items.filter((i) =>
        `${i.examDef.title} ${i.text} ${i.topic}`.toLowerCase().includes(q)
      );
    }
    if (items.length === 0) {
      host.innerHTML = `
        <div class="empty-state">
          <strong>No hay notas escritas dentro de exámenes o ejercicios.</strong>
          <p style="margin:0.35rem 0 0; font-size:0.83rem">Las notas que añadas dentro de cualquier examen o pregunta se recopilarán aquí automáticamente.</p>
        </div>
      `;
      return;
    }
    host.innerHTML = items.map((item) => {
      const topicObj = item.topic ? TOPIC_MAP[item.topic] : null;
      const head = item.source === "exercise"
        ? `${item.examDef.title} · Ejercicio ${item.qNum}`
        : `${item.examDef.title} · Nota general`;
      return `
        <article class="note-card">
          <div class="note-card-head">
            <div>
              <h4 class="note-title">${esc(head)}</h4>
              <div class="note-meta">
                ${item.date ? `<span>${esc(formatDateES(item.date))}</span>` : ""}
                <span class="tag">${item.source === "exercise" ? "Ejercicio" : "Examen"}</span>
                ${topicObj ? `<span class="tag">${esc(topicObj.short)}</span>` : ""}
              </div>
            </div>
            <button type="button" class="btn btn-soft btn-sm" data-note-open-exam="${esc(item.examId)}">Abrir examen</button>
          </div>
          <p class="note-body">${esc(item.text)}</p>
        </article>
      `;
    }).join("");

    host.querySelectorAll("[data-note-open-exam]").forEach((b) => {
      b.addEventListener("click", () => openExamDrawer(b.dataset.noteOpenExam));
    });
    return;
  }

  let list = [...state.notes];
  if (filters.noteScope === "pending") list = list.filter((n) => !n.reviewed);
  if (filters.noteScope === "pinned") list = list.filter((n) => n.pinned);
  if (filters.noteCategory !== "all") list = list.filter((n) => n.category === filters.noteCategory);
  if (filters.noteTopic !== "all") list = list.filter((n) => n.topic === filters.noteTopic);
  if (q) {
    list = list.filter((n) =>
      `${n.title} ${n.body} ${n.topic} ${n.category}`.toLowerCase().includes(q)
    );
  }

  list.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return (b.date || "").localeCompare(a.date || "") || (b.updatedAt || "").localeCompare(a.updatedAt || "");
  });

  if (list.length === 0) {
    host.innerHTML = `
      <div class="empty-state">
        <strong>Aún no hay notas en esta vista.</strong>
        <p style="margin:0.35rem 0 0; font-size:0.83rem">Usa el panel izquierdo para crear resúmenes de clase, errores frecuentes, trucos de calculadora GDC o deberes pendientes.</p>
      </div>
    `;
    return;
  }

  host.innerHTML = list.map((n) => {
    const cat = NOTE_CAT_MAP[n.category] || NOTE_CATEGORIES[0];
    const topicObj = n.topic ? TOPIC_MAP[n.topic] : null;
    const examDef = n.examId ? getExamDef(n.examId) : null;
    return `
      <article class="note-card ${n.pinned ? "note-card--pinned" : ""} ${n.reviewed ? "note-card--reviewed" : ""}">
        <div class="note-card-head">
          <div>
            <h4 class="note-title">${n.pinned ? "📌 " : ""}${esc(n.title)}</h4>
            <div class="note-meta">
              <span class="tabular">${esc(formatDateES(n.date))}</span>
              <span class="tag">${esc(cat.label)}</span>
              ${topicObj ? `<span class="tag tag--info">${esc(topicObj.short)}</span>` : ""}
              ${examDef ? `<button type="button" class="btn btn-ghost btn-sm" style="padding:0.1rem 0.45rem; font-size:0.75rem" data-note-open-exam="${esc(examDef.id)}">${esc(examDef.shortTitle)} ↗</button>` : ""}
              ${n.reviewed ? `<span class="tag tag--sol">Repasado ✓</span>` : `<span class="tag tag--warn">Por repasar</span>`}
            </div>
          </div>
          <div class="note-actions">
            <button type="button" class="btn btn-sm ${n.reviewed ? "" : "btn-good"}" data-note-review="${esc(n.id)}" title="Alternar estado repasado">
              ${n.reviewed ? "Reabrir" : "✓ Repasado"}
            </button>
            <button type="button" class="btn btn-ghost btn-sm" data-note-pin="${esc(n.id)}" title="${n.pinned ? "Desfijar" : "Fijar arriba"}">📌</button>
            <button type="button" class="btn btn-ghost btn-sm" data-note-edit="${esc(n.id)}" title="Editar nota">Editar</button>
            <button type="button" class="btn btn-ghost btn-sm" data-note-del="${esc(n.id)}" title="Eliminar nota">✕</button>
          </div>
        </div>
        <p class="note-body">${esc(n.body)}</p>
      </article>
    `;
  }).join("");

  host.querySelectorAll("[data-note-open-exam]").forEach((b) => {
    b.addEventListener("click", () => openExamDrawer(b.dataset.noteOpenExam));
  });
  host.querySelectorAll("[data-note-review]").forEach((b) => {
    b.addEventListener("click", () => {
      toggleNoteField(state, b.dataset.noteReview, "reviewed");
      renderAll();
    });
  });
  host.querySelectorAll("[data-note-pin]").forEach((b) => {
    b.addEventListener("click", () => {
      toggleNoteField(state, b.dataset.notePin, "pinned");
      renderNotesView();
    });
  });
  host.querySelectorAll("[data-note-edit]").forEach((b) => {
    b.addEventListener("click", () => {
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
      document.getElementById("btn-note-save").textContent = "Actualizar nota";
      document.getElementById("btn-note-cancel").style.display = "inline-flex";
      document.getElementById("note-title").focus();
    });
  });
  host.querySelectorAll("[data-note-del]").forEach((b) => {
    b.addEventListener("click", () => {
      deleteNote(state, b.dataset.noteDel);
      renderAll();
      showToast("Nota eliminada");
    });
  });
}

function resetNoteForm() {
  document.getElementById("note-form").reset();
  document.getElementById("note-edit-id").value = "";
  document.getElementById("note-date").value = todayISO();
  document.getElementById("note-form-heading").textContent = "Nueva nota de repaso / clase";
  document.getElementById("btn-note-save").textContent = "Guardar nota";
  document.getElementById("btn-note-cancel").style.display = "none";
}

/* ==========================================================================
   Settings, Backup & Print Report
   ========================================================================== */

function openModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add("is-open");
  el.setAttribute("aria-hidden", "false");
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove("is-open");
  el.setAttribute("aria-hidden", "true");
}

function populateSettingsModal() {
  document.getElementById("set-student-name").value = state.settings.studentName || "";
  document.getElementById("set-target-session").value = state.settings.targetSession || "Mayo 2027";
  const bHost = document.getElementById("boundaries-inputs");
  bHost.innerHTML = state.settings.gradeBoundaries.map((val, idx) => `
    <div class="boundary-cell">
      <span>IB ${idx + 1}</span>
      <input type="number" class="input tabular" min="0" max="100" data-bound-idx="${idx}" value="${val}" ${idx === 0 ? "disabled" : ""} />
    </div>
  `).join("");

  const statusEl = document.getElementById("backup-status-text");
  if (state.lastExportedAt) {
    statusEl.textContent = `Última copia exportada: ${formatDateES(state.lastExportedAt.slice(0, 10))}. Tus datos se guardan automáticamente en este navegador.`;
  } else {
    statusEl.textContent = "Todavía no has exportado ninguna copia de seguridad. Te recomendamos exportar un archivo JSON de vez en cuando.";
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
    def,
    rec: state.exams[def.id],
    d: getExamDerived(def, state.exams[def.id], state.settings.gradeBoundaries)
  })).filter(({ d }) => d.status !== "pendiente" || d.hasNotes);

  const studentLine = state.settings.studentName
    ? `Alumno: ${esc(state.settings.studentName)} · `
    : "";

  const examsRows = workedExams.length
    ? workedExams.map(({ def, rec, d }) => `
        <tr>
          <td>${esc(def.title)}</td>
          <td>${esc((EXAM_STATUS_MAP[d.status] || EXAM_STATUSES[0]).label)}</td>
          <td>${esc(formatDateES(d.lastPracticed) || "—")}</td>
          <td>${d.doneCount}/${d.totalQuestions} (${d.bienCount} bien)</td>
          <td>${d.score !== null ? `${d.score}/${d.maxMarks} (${d.percent}%)` : "—"}</td>
          <td><strong>${d.ibGrade ?? "—"}</strong></td>
          <td>${esc((rec && rec.examNotes) || "")}</td>
        </tr>
      `).join("")
    : `<tr><td colspan="7">Sin exámenes registrados todavía.</td></tr>`;

  const topicRows = stats.topicStats.map((t) => `
    <tr>
      <td>${esc(t.name)}</td>
      <td>${t.total}</td>
      <td>${t.bien}</td>
      <td>${t.repasar}</td>
      <td>${t.fallado}</td>
      <td>${t.total ? `${Math.round((t.bien / t.total) * 100)}%` : "—"}</td>
    </tr>
  `).join("");

  const queueRows = queue.length
    ? queue.map((q) => `
        <li><strong>${esc(q.type === "exercise" ? `${q.examDef.shortTitle} · Ej. ${q.qNum}` : q.examDef.title)}</strong> (${q.status === "fallado" ? "Fallado/Duda" : "Repasar"}${q.topic ? ` · ${esc(q.topic)}` : ""})${q.note ? `: ${esc(q.note)}` : ""}</li>
      `).join("")
    : `<li>Ningún ejercicio pendiente de repaso.</li>`;

  const noteRows = pendingNotes.length
    ? pendingNotes.map((n) => `
        <li><strong>${esc(n.title)}</strong> (${esc(formatDateES(n.date))}${n.topic ? ` · ${esc(n.topic)}` : ""}): ${esc(n.body)}</li>
      `).join("")
    : `<li>No hay notas pendientes de repaso.</li>`;

  document.getElementById("print-report").innerHTML = `
    <h1>Informe de Seguimiento — IB Matemáticas MAI NM</h1>
    <p style="margin:0 0 10px; color:#555">${studentLine}Convocatoria objetivo: ${esc(state.settings.targetSession || "—")} · Generado el ${esc(formatDateES(todayISO()))}</p>
    <p style="margin:0 0 12px">
      <strong>Exámenes trabajados:</strong> ${stats.examsWorked}/${stats.examsTotal} (${stats.examsCompleted} completados) ·
      <strong>Ejercicios realizados:</strong> ${stats.exercisesDone} (${stats.exercisesBien} bien, ${stats.exercisesRepasar} repasar, ${stats.exercisesFallado} duda) ·
      <strong>Nota IB media:</strong> ${stats.avgIbGrade ?? "—"} ${stats.avgPercent !== null ? `(${stats.avgPercent}%)` : ""}
    </p>

    <h2>1. Exámenes trabajados</h2>
    <table>
      <thead>
        <tr><th>Examen</th><th>Estado</th><th>Fecha</th><th>Ejercicios</th><th>Puntuación</th><th>IB</th><th>Notas</th></tr>
      </thead>
      <tbody>${examsRows}</tbody>
    </table>

    <h2>2. Dominio por tema oficial MAI NM</h2>
    <table>
      <thead>
        <tr><th>Tema</th><th>Total</th><th>Bien</th><th>Repasar</th><th>Duda</th><th>% Bien</th></tr>
      </thead>
      <tbody>${topicRows}</tbody>
    </table>

    <h2>3. Ejercicios pendientes de repaso (${queue.length})</h2>
    <ul>${queueRows}</ul>

    <h2>4. Notas de repaso activas (${pendingNotes.length})</h2>
    <ul>${noteRows}</ul>
  `;

  window.print();
}

/* ==========================================================================
   Navigation & Initialization
   ========================================================================== */

function switchView(viewName) {
  currentView = viewName;
  document.querySelectorAll(".nav-tab").forEach((t) => {
    t.classList.toggle("is-active", t.dataset.view === viewName);
  });
  document.querySelectorAll(".view-panel").forEach((p) => {
    p.classList.toggle("is-active", p.id === `view-${viewName}`);
  });
  if (viewName === "history") renderHistoryView();
  if (viewName === "notes") renderNotesView();
}

function renderAll() {
  applyTheme();
  updateBrandAndBadges();
  renderKPIs();
  renderCategoryPills();
  renderExtraResources();
  renderExamList();
  if (currentView === "history") renderHistoryView();
  if (currentView === "notes") renderNotesView();
}

function populateStaticSelects() {
  document.getElementById("drive-root-link").href = DRIVE_ROOT_URL;

  const topicOpts = MAI_TOPICS.map((t) => `<option value="${t.id}">${esc(t.short)}</option>`).join("");
  document.getElementById("queue-topic-filter").insertAdjacentHTML("beforeend", topicOpts);
  document.getElementById("note-topic").insertAdjacentHTML("beforeend", topicOpts);
  document.getElementById("notes-filter-topic").insertAdjacentHTML("beforeend", topicOpts);

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
  // Navigation tabs
  document.querySelectorAll(".nav-tab").forEach((tab) => {
    tab.addEventListener("click", () => switchView(tab.dataset.view));
  });

  // Theme toggle
  document.getElementById("btn-toggle-theme").addEventListener("click", () => {
    state.settings.theme = state.settings.theme === "dark" ? "light" : "dark";
    saveState(state);
    applyTheme();
  });

  // Category pills delegation
  document.getElementById("category-pills").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-cat]");
    if (!btn) return;
    filters.category = btn.dataset.cat;
    renderCategoryPills();
    renderExtraResources();
    renderExamList();
  });

  // Exam catalog filters
  document.getElementById("filter-search").addEventListener("input", (e) => {
    filters.search = e.target.value;
    renderExamList();
  });
  document.getElementById("filter-paper").addEventListener("change", (e) => {
    filters.paper = e.target.value;
    renderExamList();
  });
  document.getElementById("filter-status").addEventListener("change", (e) => {
    filters.status = e.target.value;
    renderExamList();
  });
  document.getElementById("filter-sort").addEventListener("change", (e) => {
    filters.sort = e.target.value;
    renderExamList();
  });

  // Exam row click / keyboard delegation
  const examList = document.getElementById("exam-list");
  examList.addEventListener("click", (e) => {
    const openBtn = e.target.closest("[data-open-btn]");
    if (openBtn) {
      openExamDrawer(openBtn.dataset.openBtn);
      return;
    }
    if (e.target.closest("[data-stop-row]")) return;
    const row = e.target.closest("[data-exam-id]");
    if (row) openExamDrawer(row.dataset.examId);
  });
  examList.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      const row = e.target.closest("[data-exam-id]");
      if (row && e.target === row) {
        e.preventDefault();
        openExamDrawer(row.dataset.examId);
      }
    }
  });

  // Drawer close
  document.getElementById("btn-close-drawer").addEventListener("click", closeExamDrawer);
  document.getElementById("exam-drawer-overlay").addEventListener("click", (e) => {
    if (e.target.id === "exam-drawer-overlay") closeExamDrawer();
  });

  // History view controls
  document.getElementById("queue-topic-filter").addEventListener("change", (e) => {
    filters.queueTopic = e.target.value;
    renderHistoryView();
  });
  document.getElementById("btn-open-log-modal").addEventListener("click", () => {
    document.getElementById("log-date").value = todayISO();
    openModal("log-modal-backdrop");
  });
  document.getElementById("log-session-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const examId = document.getElementById("log-exam").value;
    const date = document.getElementById("log-date").value || todayISO();
    const rawNums = document.getElementById("log-exercises").value;
    const nums = rawNums
      .split(/[,\s;]+/)
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n >= 1);
    const summary = document.getElementById("log-summary").value;
    logExercisesSession(state, examId, date, nums, summary);
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
    });
    resetNoteForm();
    renderAll();
    showToast(editId ? "Nota actualizada" : "Nota guardada");
  });

  document.getElementById("btn-note-cancel").addEventListener("click", resetNoteForm);

  document.getElementById("notes-scope-pills").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-nscope]");
    if (!btn) return;
    filters.noteScope = btn.dataset.nscope;
    renderNotesView();
  });
  document.getElementById("notes-search").addEventListener("input", (e) => {
    filters.noteSearch = e.target.value;
    renderNotesView();
  });
  document.getElementById("notes-filter-cat").addEventListener("change", (e) => {
    filters.noteCategory = e.target.value;
    renderNotesView();
  });
  document.getElementById("notes-filter-topic").addEventListener("change", (e) => {
    filters.noteTopic = e.target.value;
    renderNotesView();
  });

  // Settings & Backup modal
  document.getElementById("btn-open-settings").addEventListener("click", () => {
    populateSettingsModal();
    openModal("settings-modal-backdrop");
  });

  document.getElementById("btn-save-settings").addEventListener("click", () => {
    state.settings.studentName = document.getElementById("set-student-name").value.trim();
    state.settings.targetSession = document.getElementById("set-target-session").value.trim();
    const bounds = [];
    document.querySelectorAll("[data-bound-idx]").forEach((inp) => {
      bounds[Number(inp.dataset.boundIdx)] = Number(inp.value);
    });
    state.settings.gradeBoundaries = normalizeBoundaries(bounds);
    saveState(state);
    renderAll();
    if (openExamId) renderExamDrawer();
    showToast("Ajustes guardados");
  });

  document.getElementById("btn-reset-boundaries").addEventListener("click", () => {
    state.settings.gradeBoundaries = [...DEFAULT_GRADE_BOUNDARIES];
    saveState(state);
    populateSettingsModal();
    renderAll();
    showToast("Umbrales IB restaurados");
  });

  document.getElementById("btn-export-json").addEventListener("click", () => {
    const json = buildExportPayload(state);
    triggerDownload(`cuaderno-ib-mai-${todayISO()}.json`, json, "application/json");
    populateSettingsModal();
    showToast("Copia JSON descargada");
  });

  document.getElementById("btn-export-csv").addEventListener("click", () => {
    const csv = buildCSVExport(state);
    triggerDownload(`resultados-ib-mai-${todayISO()}.csv`, csv, "text/csv;charset=utf-8");
    showToast("Resultados exportados a CSV");
  });

  document.getElementById("import-json-file").addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const mode = document.getElementById("import-mode").value;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        state = importBackupJSON(state, String(reader.result || ""), mode);
        renderAll();
        if (openExamId) renderExamDrawer();
        populateSettingsModal();
        showToast(mode === "merge" ? "Copia fusionada correctamente" : "Copia restaurada correctamente");
      } catch (err) {
        showToast(err.message || "Error al importar JSON");
      }
      e.target.value = "";
    };
    reader.readAsText(file);
  });

  document.getElementById("btn-clear-all").addEventListener("click", () => {
    if (!window.confirm("¿Seguro que quieres borrar todos los resultados, historial y notas guardados en este navegador? Haz primero una copia JSON si deseas conservarlos.")) {
      return;
    }
    state = createDefaultState();
    saveState(state);
    closeExamDrawer();
    populateSettingsModal();
    renderAll();
    showToast("Datos reiniciados");
  });

  // Print buttons
  document.getElementById("btn-print-report").addEventListener("click", buildPrintReportAndPrint);
  document.getElementById("btn-modal-print").addEventListener("click", () => {
    closeModal("settings-modal-backdrop");
    buildPrintReportAndPrint();
  });

  // Modal close buttons & backdrop clicks
  document.querySelectorAll("[data-close-modal]").forEach((btn) => {
    btn.addEventListener("click", () => closeModal(btn.dataset.closeModal));
  });
  document.querySelectorAll(".modal-backdrop").forEach((bd) => {
    bd.addEventListener("click", (e) => {
      if (e.target === bd) closeModal(bd.id);
    });
  });

  // Escape key closes modals / drawer
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeModal("settings-modal-backdrop");
      closeModal("log-modal-backdrop");
      closeExamDrawer();
    }
  });
}

// Boot
populateStaticSelects();
bindGlobalEvents();
renderAll();

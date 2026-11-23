import {
  EXAMS,
  EXTRA_RESOURCES,
  MAI_TOPICS,
  DEFAULT_GRADE_BOUNDARIES,
  DEFAULT_COUNTDOWNS
} from "./data.js";

import {
  SUBTOPICS,
  SUBTOPIC_MAP,
  EXERCISE_CATALOG
} from "./exercises_catalog.js";

import {
  calcIBGrade,
  normalizeBoundaries,
  score10ToIBPoints,
  ibPointsToScore10,
  computeTopMistakes
} from "./ib_grading.js";

export { calcIBGrade, normalizeBoundaries };

export const STORAGE_KEY = "ib_mai_tracker_v1";
export const SCHEMA_VERSION = 2;

const EXAMS_BY_ID = Object.fromEntries(EXAMS.map((e) => [e.id, e]));
const GUIDE_DEF = {
  id: "guia-funciones-derivadas",
  year: 2021,
  session: "Guía",
  sessionNum: 1,
  subject: "Guía TI-84",
  paper: 1,
  category: "retos-otros",
  folderLabel: "04 - Retos y Apuntes",
  title: "Guía — Funciones y Derivadas (TI-84 Plus)",
  shortTitle: "Guía TI-84",
  maxMarks: 96,
  defaultQuestions: 16,
  questionMarks: Array(16).fill(6),
  calculator: true,
  enunciadoUrl: EXTRA_RESOURCES[0]?.url || "",
  solucionUrl: null,
  hasSolution: false
};

let mutationHook = null;

export function setMutationHook(fn) {
  mutationHook = typeof fn === "function" ? fn : null;
}

function notifyMutation(subPath, payload) {
  if (mutationHook) {
    try {
      mutationHook(subPath, payload);
    } catch {
      // mantener resiliencia local
    }
  }
}

export function getExamDef(examId) {
  if (examId === GUIDE_DEF.id) return GUIDE_DEF;
  return EXAMS_BY_ID[examId] || null;
}

export function getCatalogExercise(examId, qNum) {
  const list = EXERCISE_CATALOG[examId];
  if (!Array.isArray(list)) return null;
  return list.find((item) => item.q === Number(qNum)) || null;
}

export function createDefaultSyllabusMap() {
  const map = {};
  for (const st of SUBTOPICS) {
    if (st.mai2026) {
      map[st.id] = st.defaultSyllabus || "visto";
    }
  }
  return map;
}

export function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function makeId(prefix = "id") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function createDefaultState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: null,
    lastExportedAt: null,
    settings: {
      studentName: "",
      targetSession: "Mayo 2027",
      theme: "dark",
      hideSolutionsForStudent: false,
      gradeBoundaries: [...DEFAULT_GRADE_BOUNDARIES],
      countdowns: structuredClone(DEFAULT_COUNTDOWNS),
      syllabusStatus: createDefaultSyllabusMap(),
      updatedAt: null
    },
    exams: {},
    activityLog: [],
    notes: []
  };
}

function getSafeStorage() {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      const testKey = "__ib_mai_test__";
      window.localStorage.setItem(testKey, "1");
      window.localStorage.removeItem(testKey);
      return window.localStorage;
    }
  } catch {
    return null;
  }
  return null;
}

export function sanitizeState(raw) {
  const base = createDefaultState();
  if (!raw || typeof raw !== "object") return base;
  const s = raw.settings && typeof raw.settings === "object" ? raw.settings : {};
  const rawC = s.countdowns && typeof s.countdowns === "object" ? s.countdowns : {};
  const mergedSyllabus = { ...createDefaultSyllabusMap(), ...(s.syllabusStatus && typeof s.syllabusStatus === "object" ? s.syllabusStatus : {}) };

  return {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : null,
    lastExportedAt: typeof raw.lastExportedAt === "string" ? raw.lastExportedAt : null,
    settings: {
      studentName: typeof s.studentName === "string" ? s.studentName.slice(0, 100) : "",
      targetSession: typeof s.targetSession === "string" ? s.targetSession.slice(0, 60) : "Mayo 2027",
      theme: s.theme === "light" ? "light" : "dark",
      hideSolutionsForStudent: Boolean(s.hideSolutionsForStudent),
      gradeBoundaries: normalizeBoundaries(s.gradeBoundaries),
      countdowns: {
        mock: {
          label: rawC.mock?.label || DEFAULT_COUNTDOWNS.mock.label,
          detail: rawC.mock?.detail || DEFAULT_COUNTDOWNS.mock.detail,
          date: rawC.mock?.date || DEFAULT_COUNTDOWNS.mock.date
        },
        official: {
          label: rawC.official?.label || DEFAULT_COUNTDOWNS.official.label,
          detail: rawC.official?.detail || DEFAULT_COUNTDOWNS.official.detail,
          date: rawC.official?.date || DEFAULT_COUNTDOWNS.official.date
        }
      },
      syllabusStatus: mergedSyllabus,
      updatedAt: typeof s.updatedAt === "string" ? s.updatedAt : null
    },
    exams: raw.exams && typeof raw.exams === "object" ? raw.exams : {},
    activityLog: Array.isArray(raw.activityLog) ? raw.activityLog : [],
    notes: Array.isArray(raw.notes) ? raw.notes : []
  };
}

export function loadState() {
  const storage = getSafeStorage();
  if (!storage) return createDefaultState();
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return createDefaultState();
    return sanitizeState(JSON.parse(raw));
  } catch {
    return createDefaultState();
  }
}

export function saveState(state) {
  state.updatedAt = new Date().toISOString();
  const storage = getSafeStorage();
  if (!storage) return false;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function updateSettings(state, patch) {
  Object.assign(state.settings, patch);
  state.settings.updatedAt = new Date().toISOString();
  saveState(state);
  notifyMutation("settings", state.settings);
  return state.settings;
}

export function ensureExamRecord(state, examId) {
  const def = getExamDef(examId);
  if (!def) throw new Error(`Examen desconocido: ${examId}`);
  if (!state.exams[examId]) {
    state.exams[examId] = {
      status: "pendiente",
      mode: "clase",
      score: null,
      maxMarks: def.maxMarks,
      manualGrade: null,
      lastPracticed: "",
      durationMin: null,
      examNotes: "",
      questionCount: def.defaultQuestions,
      attempts: [],
      exercises: {},
      updatedAt: null
    };
  }
  const rec = state.exams[examId];
  if (!rec.exercises || typeof rec.exercises !== "object") rec.exercises = {};
  if (!Array.isArray(rec.attempts)) rec.attempts = [];
  if (!Number.isFinite(Number(rec.maxMarks)) || Number(rec.maxMarks) <= 0) {
    rec.maxMarks = def.maxMarks;
  }
  if (!Number.isFinite(Number(rec.questionCount)) || Number(rec.questionCount) < 1) {
    rec.questionCount = def.defaultQuestions;
  }
  return rec;
}

export function getQuestionMaxMarks(examDef, qNum) {
  const cat = getCatalogExercise(examDef.id, qNum);
  if (cat && Number(cat.marks) > 0) return Number(cat.marks);
  if (examDef && Array.isArray(examDef.questionMarks) && examDef.questionMarks[qNum - 1] !== undefined) {
    return examDef.questionMarks[qNum - 1];
  }
  return examDef && examDef.paper === 1 ? 6 : 15;
}

export function getExerciseMeta(examId, qNum, userEx = null, syllabusStatus = null) {
  const cat = getCatalogExercise(examId, qNum);
  const topic = userEx?.topic || cat?.topic || "T2";
  const subtopics = Array.isArray(userEx?.subtopics) && userEx.subtopics.length
    ? userEx.subtopics
    : (cat?.subtopics || []);
  const mai2026 = userEx?.mai2026 || cat?.mai2026 || (topic === "OUT" ? "out" : "in");
  const outReason = mai2026 === "out" ? (userEx?.outReason || cat?.outReason || "Marcado fuera de MAI NM 2026") : null;
  const optimalMin = cat?.optimalMin || 6;
  const title = cat?.title || `Ejercicio ${qNum}`;

  // Determinar estado respecto al temario actual del alumno
  let syllabusFit = "out";
  if (mai2026 === "in") {
    const levels = subtopics
      .filter((id) => SUBTOPIC_MAP[id]?.mai2026)
      .map((id) => (syllabusStatus && syllabusStatus[id]) || SUBTOPIC_MAP[id]?.defaultSyllabus || "visto");
    if (levels.length === 0 || levels.every((l) => l === "visto")) syllabusFit = "visto";
    else if (levels.some((l) => l === "proximo")) syllabusFit = "proximo";
    else syllabusFit = "parcial";
  }

  return { topic, subtopics, mai2026, outReason, optimalMin, title, syllabusFit };
}

export function getExamDerived(examDef, record, boundaries = DEFAULT_GRADE_BOUNDARIES, syllabusStatus = null) {
  const rec = record || null;
  const totalQuestions = rec && rec.questionCount ? rec.questionCount : examDef.defaultQuestions;
  const maxMarks = rec && Number(rec.maxMarks) > 0 ? Number(rec.maxMarks) : examDef.maxMarks;
  const exercises = rec && rec.exercises ? rec.exercises : {};

  let doneCount = 0;
  let bienCount = 0;
  let repasarCount = 0;
  let falladoCount = 0;
  let exercisePointsEarned = 0;
  let exercisePointsMax = 0;
  let hasExercisePoints = false;
  let maiInCount = 0;
  let maiOutCount = 0;
  let maiInDoneCount = 0;
  let totalTimeSec = 0;
  const subtopicSet = new Set();
  const topicSet = new Set();

  for (let q = 1; q <= totalQuestions; q++) {
    const ex = exercises[String(q)];
    const meta = getExerciseMeta(examDef.id, q, ex, syllabusStatus);
    if (meta.mai2026 === "in") maiInCount++;
    else maiOutCount++;
    for (const st of meta.subtopics) subtopicSet.add(st);
    if (meta.topic && meta.topic !== "OUT") topicSet.add(meta.topic);

    if (!ex) continue;
    if (ex.timeSpentSec) totalTimeSec += Number(ex.timeSpentSec) || 0;
    if (ex.status && ex.status !== "pendiente") {
      doneCount++;
      if (meta.mai2026 === "in") maiInDoneCount++;
      if (ex.status === "bien") bienCount++;
      else if (ex.status === "repasar") repasarCount++;
      else if (ex.status === "fallado") falladoCount++;
    }
    const qMax = ex.maxPoints !== null && ex.maxPoints !== undefined && ex.maxPoints !== ""
      ? Number(ex.maxPoints)
      : getQuestionMaxMarks(examDef, q);
    let pts = null;
    if (ex.points !== null && ex.points !== undefined && ex.points !== "") {
      pts = Number(ex.points);
    } else if (ex.score10 !== null && ex.score10 !== undefined && ex.score10 !== "") {
      pts = score10ToIBPoints(ex.score10, qMax);
    }
    if (pts !== null && Number.isFinite(pts)) {
      hasExercisePoints = true;
      exercisePointsEarned += pts;
      if (Number.isFinite(qMax) && qMax > 0) exercisePointsMax += qMax;
    }
  }

  const score = rec && rec.score !== null && rec.score !== undefined && rec.score !== ""
    ? Number(rec.score)
    : null;
  const percent = score !== null && Number.isFinite(score) && maxMarks > 0
    ? Math.round((score / maxMarks) * 1000) / 10
    : null;

  // Proyección IB basada en los ejercicios puntuados (aunque el examen esté a medias)
  const projectedPercent = hasExercisePoints && exercisePointsMax > 0
    ? Math.round((exercisePointsEarned / exercisePointsMax) * 1000) / 10
    : null;
  const projectedIbGrade = projectedPercent !== null ? calcIBGrade(projectedPercent, boundaries) : null;

  const autoGrade = percent !== null ? calcIBGrade(percent, boundaries) : projectedIbGrade;
  const manualGrade = rec && rec.manualGrade ? Number(rec.manualGrade) : null;
  const ibGrade = manualGrade || autoGrade;
  const isProjectedOnly = percent === null && manualGrade === null && projectedIbGrade !== null;

  let status = rec ? rec.status || "pendiente" : "pendiente";
  if (status === "pendiente" && (doneCount > 0 || score !== null || manualGrade !== null || hasExercisePoints)) {
    status = "en-progreso";
  }

  const attemptsCount = rec && Array.isArray(rec.attempts) ? rec.attempts.length : 0;
  const hasNotes = Boolean(rec && rec.examNotes && rec.examNotes.trim().length > 0);
  const exerciseNotesCount = Object.values(exercises).filter(
    (ex) => ex && ex.note && ex.note.trim().length > 0
  ).length;

  return {
    status,
    mode: rec ? rec.mode || "clase" : "clase",
    score,
    maxMarks,
    percent,
    projectedPercent,
    projectedIbGrade,
    isProjectedOnly,
    autoGrade,
    manualGrade,
    ibGrade,
    totalQuestions,
    doneCount,
    bienCount,
    repasarCount,
    falladoCount,
    maiInCount,
    maiOutCount,
    maiInDoneCount,
    subtopics: [...subtopicSet],
    topics: [...topicSet],
    hasExercisePoints,
    exercisePointsEarned: Math.round(exercisePointsEarned * 10) / 10,
    exercisePointsMax: Math.round(exercisePointsMax * 10) / 10,
    totalTimeSec,
    attemptsCount,
    lastPracticed: rec ? rec.lastPracticed || "" : "",
    hasNotes,
    exerciseNotesCount
  };
}

export function updateExamFields(state, examId, patch, actorRole = "profesor") {
  const rec = ensureExamRecord(state, examId);
  Object.assign(rec, patch);
  rec.updatedAt = new Date().toISOString();
  rec.updatedBy = actorRole;
  if ((patch.score !== undefined && patch.score !== null && patch.score !== "") || patch.manualGrade) {
    if (!rec.lastPracticed) rec.lastPracticed = todayISO();
    if (rec.status === "pendiente") rec.status = "en-progreso";
  }
  saveState(state);
  notifyMutation(`exams/${examId}`, rec);
  return rec;
}

export function updateExercise(state, examId, qNum, patch, actorRole = "profesor") {
  const def = getExamDef(examId);
  const rec = ensureExamRecord(state, examId);
  const key = String(qNum);
  const cat = getCatalogExercise(examId, qNum);
  if (!rec.exercises[key]) {
    rec.exercises[key] = {
      status: "pendiente",
      score10: null,
      points: null,
      maxPoints: getQuestionMaxMarks(def, qNum),
      topic: cat?.topic || "",
      subtopics: cat?.subtopics ? [...cat.subtopics] : [],
      mai2026: cat?.mai2026 || "in",
      mistakes: [],
      timeSpentSec: 0,
      note: "",
      date: "",
      updatedAt: null,
      updatedBy: actorRole
    };
  }
  const ex = rec.exercises[key];
  const qMax = patch.maxPoints !== undefined ? Number(patch.maxPoints) : (Number(ex.maxPoints) || getQuestionMaxMarks(def, qNum));

  // Sincronización bidireccional score10 (0–10) ↔ points (IB)
  const finalPatch = { ...patch };
  if ("score10" in patch && !("points" in patch)) {
    finalPatch.points = patch.score10 === null || patch.score10 === "" ? null : score10ToIBPoints(patch.score10, qMax);
    // Inferir estado amigable si seguía en pendiente
    if (patch.score10 !== null && patch.score10 !== "" && (!ex.status || ex.status === "pendiente") && !patch.status) {
      const s10 = Number(patch.score10);
      finalPatch.status = s10 >= 7 ? "bien" : s10 >= 4 ? "repasar" : "fallado";
    }
  } else if ("points" in patch && !("score10" in patch)) {
    finalPatch.score10 = patch.points === null || patch.points === "" ? null : ibPointsToScore10(patch.points, qMax);
    if (patch.points !== null && patch.points !== "" && (!ex.status || ex.status === "pendiente") && !patch.status) {
      const s10 = finalPatch.score10;
      finalPatch.status = s10 >= 7 ? "bien" : s10 >= 4 ? "repasar" : "fallado";
    }
  }

  Object.assign(ex, finalPatch);
  ex.updatedAt = new Date().toISOString();
  ex.updatedBy = actorRole;
  rec.updatedAt = ex.updatedAt;

  if ((ex.status && ex.status !== "pendiente") || ex.score10 !== null || ex.points !== null) {
    if (!ex.date) ex.date = todayISO();
    rec.lastPracticed = ex.date;
    if (rec.status === "pendiente") rec.status = "en-progreso";
  }

  saveState(state);
  notifyMutation(`exams/${examId}`, rec);
  return ex;
}

export function applyExerciseSumToExam(state, examId, actorRole = "profesor") {
  const def = getExamDef(examId);
  const rec = ensureExamRecord(state, examId);
  const derived = getExamDerived(def, rec, state.settings.gradeBoundaries, state.settings.syllabusStatus);
  if (!derived.hasExercisePoints) return null;
  rec.score = derived.exercisePointsEarned;
  rec.manualGrade = null;
  rec.updatedAt = new Date().toISOString();
  rec.updatedBy = actorRole;
  if (!rec.lastPracticed) rec.lastPracticed = todayISO();
  if (rec.status === "pendiente") rec.status = "en-progreso";
  saveState(state);
  notifyMutation(`exams/${examId}`, rec);
  return rec;
}

export function saveExamAttempt(state, examId, summaryText = "", actorRole = "profesor") {
  const def = getExamDef(examId);
  const rec = ensureExamRecord(state, examId);
  const derived = getExamDerived(def, rec, state.settings.gradeBoundaries, state.settings.syllabusStatus);
  const date = rec.lastPracticed || todayISO();
  rec.lastPracticed = date;
  const nowIso = new Date().toISOString();
  rec.updatedAt = nowIso;

  const effPct = derived.percent ?? derived.projectedPercent;
  const effScore = derived.score ?? (derived.hasExercisePoints ? derived.exercisePointsEarned : null);
  const effMax = derived.score !== null ? derived.maxMarks : (derived.hasExercisePoints ? derived.exercisePointsMax : derived.maxMarks);

  const attempt = {
    id: makeId("att"),
    date,
    score: effScore,
    maxMarks: effMax,
    percent: effPct,
    ibGrade: derived.ibGrade,
    mode: rec.mode || "clase",
    durationMin: rec.durationMin || (derived.totalTimeSec ? Math.round(derived.totalTimeSec / 60) : null),
    doneQuestions: derived.doneCount,
    totalQuestions: derived.totalQuestions,
    authorRole: actorRole,
    summary: summaryText.trim() || (
      effScore !== null
        ? `Intento: ${effScore}/${effMax} (${effPct}% → IB ${derived.ibGrade ?? "—"})`
        : derived.ibGrade
          ? `Intento registrado: Nota IB ${derived.ibGrade}`
          : `Sesión registrada (${derived.doneCount}/${derived.totalQuestions} ejercicios)`
    )
  };
  rec.attempts.unshift(attempt);

  const logEntry = {
    id: makeId("log"),
    date,
    updatedAt: nowIso,
    authorRole: actorRole,
    type: "intento",
    examId,
    mode: rec.mode || "clase",
    score: effScore,
    maxMarks: effMax,
    percent: effPct,
    ibGrade: derived.ibGrade,
    exerciseNumbers: Object.entries(rec.exercises)
      .filter(([, ex]) => ex && ex.status && ex.status !== "pendiente")
      .map(([k]) => Number(k))
      .sort((a, b) => a - b),
    summary: attempt.summary
  };
  state.activityLog.unshift(logEntry);

  saveState(state);
  notifyMutation(`exams/${examId}`, rec);
  notifyMutation(`logMap/${logEntry.id}`, logEntry);
  return attempt;
}

export function logExercisesSession(state, examId, date, exerciseNums, summaryText = "", actorRole = "profesor") {
  const def = getExamDef(examId);
  const rec = ensureExamRecord(state, examId);
  const cleanNums = [...new Set(exerciseNums.map(Number).filter((n) => Number.isFinite(n) && n >= 1))].sort((a, b) => a - b);
  const sessionDate = date || todayISO();
  rec.lastPracticed = sessionDate;
  const nowIso = new Date().toISOString();

  const counts = { bien: 0, repasar: 0, fallado: 0 };
  for (const n of cleanNums) {
    const ex = rec.exercises[String(n)];
    if (ex) {
      if (ex.status === "bien") counts.bien++;
      else if (ex.status === "repasar") counts.repasar++;
      else if (ex.status === "fallado") counts.fallado++;
    }
  }

  const autoSummary = cleanNums.length
    ? `Ejercicios ${cleanNums.join(", ")} (${counts.bien} bien, ${counts.repasar} repasar, ${counts.fallado} duda)`
    : `Sesión de práctica en ${def.shortTitle}`;

  const entry = {
    id: makeId("log"),
    date: sessionDate,
    updatedAt: nowIso,
    authorRole: actorRole,
    type: "ejercicios",
    examId,
    mode: rec.mode || "clase",
    score: null,
    maxMarks: null,
    percent: null,
    ibGrade: null,
    exerciseNumbers: cleanNums,
    summary: summaryText.trim() || autoSummary
  };
  state.activityLog.unshift(entry);
  saveState(state);
  notifyMutation(`logMap/${entry.id}`, entry);
  return entry;
}

export function deleteActivityEntry(state, logId) {
  state.activityLog = state.activityLog.filter((item) => item.id !== logId);
  saveState(state);
  notifyMutation(`logMap/${logId}`, { id: logId, _deleted: true, updatedAt: new Date().toISOString() });
}

export function deleteAttempt(state, examId, attemptId) {
  const rec = state.exams[examId];
  if (!rec || !Array.isArray(rec.attempts)) return;
  rec.attempts = rec.attempts.filter((a) => a.id !== attemptId);
  rec.updatedAt = new Date().toISOString();
  saveState(state);
  notifyMutation(`exams/${examId}`, rec);
}

export function addOrUpdateNote(state, noteData, actorRole = "profesor") {
  const clean = {
    id: noteData.id || makeId("note"),
    date: noteData.date || todayISO(),
    title: (noteData.title || "").trim() || "Nota sin título",
    category: noteData.category || "clase",
    topic: noteData.topic || "",
    examId: noteData.examId || "",
    body: (noteData.body || "").trim(),
    pinned: Boolean(noteData.pinned),
    reviewed: Boolean(noteData.reviewed),
    authorRole: noteData.authorRole || actorRole,
    updatedAt: new Date().toISOString()
  };
  const idx = state.notes.findIndex((n) => n.id === clean.id);
  if (idx >= 0) {
    state.notes[idx] = { ...state.notes[idx], ...clean };
  } else {
    state.notes.unshift(clean);
  }
  saveState(state);
  notifyMutation(`notesMap/${clean.id}`, state.notes.find((n) => n.id === clean.id));
  return clean;
}

export function toggleNoteField(state, noteId, field) {
  const note = state.notes.find((n) => n.id === noteId);
  if (!note) return null;
  note[field] = !note[field];
  note.updatedAt = new Date().toISOString();
  saveState(state);
  notifyMutation(`notesMap/${noteId}`, note);
  return note;
}

export function deleteNote(state, noteId) {
  state.notes = state.notes.filter((n) => n.id !== noteId);
  saveState(state);
  notifyMutation(`notesMap/${noteId}`, { id: noteId, _deleted: true, updatedAt: new Date().toISOString() });
}

/**
 * Devuelve la lista plana de TODOS los ejercicios clasificados (609 de exámenes + 16 de guía TI-84)
 * combinada con el progreso actual del alumno.
 */
export function getAllCatalogExercises(state) {
  const syllabus = state.settings.syllabusStatus;
  const allDocs = [...EXAMS, GUIDE_DEF];
  const out = [];

  for (const def of allDocs) {
    const catList = EXERCISE_CATALOG[def.id] || [];
    const rec = state.exams[def.id];
    const exMap = rec?.exercises || {};
    for (const item of catList) {
      const userEx = exMap[String(item.q)] || null;
      const meta = getExerciseMeta(def.id, item.q, userEx, syllabus);
      const maxPoints = userEx?.maxPoints ?? item.marks;
      const points = userEx?.points ?? (userEx?.score10 != null ? score10ToIBPoints(userEx.score10, maxPoints) : null);
      const score10 = userEx?.score10 ?? (points != null ? ibPointsToScore10(points, maxPoints) : null);
      out.push({
        examId: def.id,
        examDef: def,
        q: item.q,
        marks: maxPoints,
        optimalMin: item.optimalMin,
        title: item.title,
        topic: meta.topic,
        subtopics: meta.subtopics,
        mai2026: meta.mai2026,
        outReason: meta.outReason,
        syllabusFit: meta.syllabusFit,
        status: userEx?.status || "pendiente",
        score10,
        points,
        mistakes: Array.isArray(userEx?.mistakes) ? userEx.mistakes : [],
        timeSpentSec: userEx?.timeSpentSec || 0,
        note: userEx?.note || "",
        date: userEx?.date || ""
      });
    }
  }
  return out;
}

export function getReviewQueue(state) {
  const items = [];
  for (const def of [...EXAMS, GUIDE_DEF]) {
    const rec = state.exams[def.id];
    if (!rec) continue;
    const exercises = rec.exercises || {};
    for (const [qKey, ex] of Object.entries(exercises)) {
      if (ex && (ex.status === "repasar" || ex.status === "fallado")) {
        const meta = getExerciseMeta(def.id, Number(qKey), ex, state.settings.syllabusStatus);
        items.push({
          type: "exercise",
          examId: def.id,
          examDef: def,
          qNum: Number(qKey),
          status: ex.status,
          topic: meta.topic,
          subtopics: meta.subtopics,
          score10: ex.score10 ?? null,
          mistakes: ex.mistakes || [],
          note: ex.note || meta.title,
          date: ex.date || rec.lastPracticed || ""
        });
      }
    }
    if (rec.status === "repasar") {
      items.push({
        type: "exam",
        examId: def.id,
        examDef: def,
        qNum: null,
        status: "repasar",
        topic: "",
        subtopics: [],
        score10: null,
        mistakes: [],
        note: rec.examNotes || "",
        date: rec.lastPracticed || ""
      });
    }
  }
  items.sort((a, b) => {
    const sevA = a.status === "fallado" ? 0 : 1;
    const sevB = b.status === "fallado" ? 0 : 1;
    if (sevA !== sevB) return sevA - sevB;
    return (b.date || "").localeCompare(a.date || "");
  });
  return items;
}

export function getExamAndExerciseNotes(state) {
  const out = [];
  for (const def of [...EXAMS, GUIDE_DEF]) {
    const rec = state.exams[def.id];
    if (!rec) continue;
    if (rec.examNotes && rec.examNotes.trim()) {
      out.push({
        id: `exam_note_${def.id}`,
        source: "exam",
        examId: def.id,
        examDef: def,
        qNum: null,
        date: rec.lastPracticed || "",
        topic: "",
        status: rec.status || "en-progreso",
        authorRole: rec.updatedBy || "profesor",
        text: rec.examNotes.trim()
      });
    }
    for (const [qKey, ex] of Object.entries(rec.exercises || {})) {
      if (ex && ex.note && ex.note.trim()) {
        const meta = getExerciseMeta(def.id, Number(qKey), ex, state.settings.syllabusStatus);
        out.push({
          id: `ex_note_${def.id}_${qKey}`,
          source: "exercise",
          examId: def.id,
          examDef: def,
          qNum: Number(qKey),
          date: ex.date || rec.lastPracticed || "",
          topic: meta.topic,
          status: ex.status || "pendiente",
          authorRole: ex.updatedBy || "profesor",
          text: ex.note.trim()
        });
      }
    }
  }
  out.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  return out;
}

export function getGlobalStats(state) {
  const boundaries = state.settings.gradeBoundaries;
  const syllabus = state.settings.syllabusStatus;
  let examsWorked = 0;
  let examsCompleted = 0;
  let exercisesDone = 0;
  let exercisesBien = 0;
  let exercisesRepasar = 0;
  let exercisesFallado = 0;
  let maiTotal = 0;
  let maiDone = 0;
  let vistoTotal = 0;
  let vistoDone = 0;
  const percents = [];
  const grades = [];

  const topicStats = Object.fromEntries(
    MAI_TOPICS.map((t) => [t.id, { ...t, bien: 0, repasar: 0, fallado: 0, total: 0, catalogTotal: 0 }])
  );
  let untaggedExercises = 0;
  const evolutionPoints = [];

  for (const def of EXAMS) {
    const rec = state.exams[def.id];
    const derived = getExamDerived(def, rec, boundaries, syllabus);
    if (derived.status !== "pendiente") examsWorked++;
    if (derived.status === "completado") examsCompleted++;
    exercisesDone += derived.doneCount;
    exercisesBien += derived.bienCount;
    exercisesRepasar += derived.repasarCount;
    exercisesFallado += derived.falladoCount;

    const effPct = derived.percent ?? derived.projectedPercent;
    if (effPct !== null) percents.push(effPct);
    if (derived.ibGrade !== null) grades.push(derived.ibGrade);

    const catList = EXERCISE_CATALOG[def.id] || [];
    for (const item of catList) {
      const ex = rec?.exercises?.[String(item.q)];
      const meta = getExerciseMeta(def.id, item.q, ex, syllabus);
      if (meta.mai2026 === "in") {
        maiTotal++;
        if (meta.syllabusFit === "visto" || meta.syllabusFit === "parcial") vistoTotal++;
        if (meta.topic && topicStats[meta.topic]) topicStats[meta.topic].catalogTotal++;
        if (ex && ex.status && ex.status !== "pendiente") {
          maiDone++;
          if (meta.syllabusFit === "visto" || meta.syllabusFit === "parcial") vistoDone++;
        }
      }
      if (ex && ex.status && ex.status !== "pendiente") {
        if (meta.topic && topicStats[meta.topic]) {
          topicStats[meta.topic].total++;
          if (ex.status === "bien") topicStats[meta.topic].bien++;
          else if (ex.status === "repasar") topicStats[meta.topic].repasar++;
          else if (ex.status === "fallado") topicStats[meta.topic].fallado++;
        } else {
          untaggedExercises++;
        }
      }
    }

    if (rec && Array.isArray(rec.attempts) && rec.attempts.length > 0) {
      for (const att of rec.attempts) {
        if (att.percent !== null && att.percent !== undefined) {
          evolutionPoints.push({
            date: att.date || rec.lastPracticed || "",
            label: def.shortTitle,
            examId: def.id,
            percent: att.percent,
            ibGrade: att.ibGrade || calcIBGrade(att.percent, boundaries),
            scoreText: att.score !== null ? `${att.score}/${att.maxMarks}` : `IB ${att.ibGrade}`
          });
        }
      }
    } else if (effPct !== null) {
      evolutionPoints.push({
        date: derived.lastPracticed || "",
        label: def.shortTitle,
        examId: def.id,
        percent: effPct,
        ibGrade: derived.ibGrade,
        scoreText: derived.score !== null
          ? `${derived.score}/${derived.maxMarks}`
          : `${derived.exercisePointsEarned}/${derived.exercisePointsMax} (proy.)`
      });
    } else if (derived.manualGrade !== null) {
      evolutionPoints.push({
        date: derived.lastPracticed || "",
        label: def.shortTitle,
        examId: def.id,
        percent: Math.min(100, boundaries[derived.manualGrade - 1] + 6),
        ibGrade: derived.manualGrade,
        scoreText: `IB ${derived.manualGrade}`
      });
    }
  }

  evolutionPoints.sort((a, b) => (a.date || "").localeCompare(b.date || ""));

  const avgPercent = percents.length
    ? Math.round((percents.reduce((s, v) => s + v, 0) / percents.length) * 10) / 10
    : null;
  const avgIbGrade = grades.length
    ? Math.round((grades.reduce((s, v) => s + v, 0) / grades.length) * 10) / 10
    : null;

  const pendingNotesCount = state.notes.filter((n) => !n.reviewed).length;
  const reviewQueueCount = getReviewQueue(state).length;
  const topMistakes = computeTopMistakes(state.exams);

  return {
    examsTotal: EXAMS.length,
    examsWorked,
    examsCompleted,
    exercisesDone,
    exercisesBien,
    exercisesRepasar,
    exercisesFallado,
    maiTotal,
    maiDone,
    vistoTotal,
    vistoDone,
    avgPercent,
    avgIbGrade,
    pendingNotesCount,
    totalNotesCount: state.notes.length,
    reviewQueueCount,
    topMistakes,
    topicStats: Object.values(topicStats),
    untaggedExercises,
    evolutionPoints
  };
}

export function buildExportPayload(state) {
  state.lastExportedAt = new Date().toISOString();
  saveState(state);
  return JSON.stringify(
    {
      app: "Cuaderno IB MAI NM",
      version: SCHEMA_VERSION,
      exportedAt: state.lastExportedAt,
      data: state
    },
    null,
    2
  );
}

export function importBackupJSON(currentState, jsonText, mode = "replace") {
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error("El archivo no es un JSON válido.");
  }
  const incomingRaw = parsed && parsed.data && typeof parsed.data === "object" ? parsed.data : parsed;
  if (!incomingRaw || typeof incomingRaw !== "object" || (!incomingRaw.exams && !incomingRaw.notes && !incomingRaw.activityLog)) {
    throw new Error("El archivo JSON no tiene el formato de respaldo de Cuaderno IB.");
  }
  const incoming = sanitizeState(incomingRaw);

  if (mode === "replace") {
    saveState(incoming);
    return incoming;
  }

  const merged = sanitizeState(currentState);
  if (incoming.settings.studentName && !merged.settings.studentName) {
    merged.settings.studentName = incoming.settings.studentName;
  }
  for (const [examId, incRec] of Object.entries(incoming.exams)) {
    if (!merged.exams[examId]) {
      merged.exams[examId] = incRec;
    } else {
      const cur = merged.exams[examId];
      const mergedExercises = { ...(cur.exercises || {}) };
      for (const [qKey, qVal] of Object.entries(incRec.exercises || {})) {
        if (!mergedExercises[qKey] || mergedExercises[qKey].status === "pendiente") {
          mergedExercises[qKey] = qVal;
        }
      }
      const seenAtt = new Set((cur.attempts || []).map((a) => a.id));
      const mergedAttempts = [...(cur.attempts || [])];
      for (const att of incRec.attempts || []) {
        if (!seenAtt.has(att.id)) mergedAttempts.push(att);
      }
      merged.exams[examId] = {
        ...cur,
        ...incRec,
        examNotes: cur.examNotes && incRec.examNotes && cur.examNotes !== incRec.examNotes
          ? `${cur.examNotes}\n\n${incRec.examNotes}`
          : (incRec.examNotes || cur.examNotes || ""),
        exercises: mergedExercises,
        attempts: mergedAttempts
      };
    }
  }

  const seenLog = new Set(merged.activityLog.map((l) => l.id));
  for (const entry of incoming.activityLog) {
    if (!seenLog.has(entry.id)) merged.activityLog.push(entry);
  }
  merged.activityLog.sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  const seenNotes = new Set(merged.notes.map((n) => n.id));
  for (const note of incoming.notes) {
    if (!seenNotes.has(note.id)) merged.notes.push(note);
  }
  merged.notes.sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  saveState(merged);
  return merged;
}

export function buildCSVExport(state) {
  const boundaries = state.settings.gradeBoundaries;
  const headers = [
    "Examen", "Año", "Convocatoria", "Asignatura", "Prueba", "Estado", "Modo", "Última fecha",
    "Puntuación", "Máximo", "Porcentaje", "Nota IB", "Ejercicios hechos", "Total MAI 2026",
    "Bien", "Repasar", "Fallado", "Notas"
  ];
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = [headers.map(esc).join(",")];
  for (const def of EXAMS) {
    const rec = state.exams[def.id];
    const d = getExamDerived(def, rec, boundaries, state.settings.syllabusStatus);
    if (d.status === "pendiente" && !d.hasNotes) continue;
    const effPct = d.percent ?? d.projectedPercent;
    rows.push([
      def.title, def.year, def.session, def.subject, `P${def.paper}`, d.status, d.mode,
      d.lastPracticed, d.score ?? d.exercisePointsEarned ?? "", d.score !== null ? d.maxMarks : (d.hasExercisePoints ? d.exercisePointsMax : d.maxMarks),
      effPct !== null ? `${effPct}%` : "", d.ibGrade ?? "", d.doneCount, d.maiInCount,
      d.bienCount, d.repasarCount, d.falladoCount, rec ? rec.examNotes || "" : ""
    ].map(esc).join(","));
  }
  return "\uFEFF" + rows.join("\n");
}

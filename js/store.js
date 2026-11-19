import {
  EXAMS,
  MAI_TOPICS,
  DEFAULT_GRADE_BOUNDARIES
} from "./data.js";

export const STORAGE_KEY = "ib_mai_tracker_v1";
export const SCHEMA_VERSION = 1;

const EXAMS_BY_ID = Object.fromEntries(EXAMS.map((e) => [e.id, e]));

export function getExamDef(examId) {
  return EXAMS_BY_ID[examId] || null;
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
      theme: "light",
      gradeBoundaries: [...DEFAULT_GRADE_BOUNDARIES]
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

export function normalizeBoundaries(arr) {
  if (!Array.isArray(arr) || arr.length !== 7) {
    return [...DEFAULT_GRADE_BOUNDARIES];
  }
  const cleaned = arr.map((n, i) => {
    const val = Number(n);
    if (!Number.isFinite(val)) return DEFAULT_GRADE_BOUNDARIES[i];
    return Math.max(0, Math.min(100, Math.round(val)));
  });
  cleaned[0] = 0;
  for (let i = 1; i < 7; i++) {
    if (cleaned[i] < cleaned[i - 1]) cleaned[i] = cleaned[i - 1];
  }
  return cleaned;
}

export function sanitizeState(raw) {
  const base = createDefaultState();
  if (!raw || typeof raw !== "object") return base;
  const s = raw.settings && typeof raw.settings === "object" ? raw.settings : {};
  return {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : null,
    lastExportedAt: typeof raw.lastExportedAt === "string" ? raw.lastExportedAt : null,
    settings: {
      studentName: typeof s.studentName === "string" ? s.studentName.slice(0, 100) : "",
      targetSession: typeof s.targetSession === "string" ? s.targetSession.slice(0, 60) : "Mayo 2027",
      theme: s.theme === "dark" ? "dark" : "light",
      gradeBoundaries: normalizeBoundaries(s.gradeBoundaries)
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

export function calcIBGrade(percent, boundaries = DEFAULT_GRADE_BOUNDARIES) {
  if (percent === null || percent === undefined || !Number.isFinite(Number(percent))) {
    return null;
  }
  const p = Math.max(0, Math.min(100, Number(percent)));
  const b = normalizeBoundaries(boundaries);
  let grade = 1;
  for (let i = 1; i < 7; i++) {
    if (p >= b[i]) grade = i + 1;
  }
  return grade;
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
      exercises: {}
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
  if (examDef && Array.isArray(examDef.questionMarks) && examDef.questionMarks[qNum - 1] !== undefined) {
    return examDef.questionMarks[qNum - 1];
  }
  return examDef && examDef.paper === 1 ? 6 : 15;
}

export function getExamDerived(examDef, record, boundaries = DEFAULT_GRADE_BOUNDARIES) {
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

  for (let q = 1; q <= totalQuestions; q++) {
    const ex = exercises[String(q)];
    if (!ex) continue;
    if (ex.status && ex.status !== "pendiente") {
      doneCount++;
      if (ex.status === "bien") bienCount++;
      else if (ex.status === "repasar") repasarCount++;
      else if (ex.status === "fallado") falladoCount++;
    }
    if (ex.points !== null && ex.points !== undefined && ex.points !== "") {
      const pts = Number(ex.points);
      const qMax = ex.maxPoints !== null && ex.maxPoints !== undefined && ex.maxPoints !== ""
        ? Number(ex.maxPoints)
        : getQuestionMaxMarks(examDef, q);
      if (Number.isFinite(pts)) {
        hasExercisePoints = true;
        exercisePointsEarned += pts;
        if (Number.isFinite(qMax) && qMax > 0) exercisePointsMax += qMax;
      }
    }
  }

  // Also check extra question numbers beyond totalQuestions just in case
  for (const [k, ex] of Object.entries(exercises)) {
    const num = Number(k);
    if (!Number.isFinite(num) || num <= totalQuestions) continue;
    if (ex.status && ex.status !== "pendiente") {
      doneCount++;
      if (ex.status === "bien") bienCount++;
      else if (ex.status === "repasar") repasarCount++;
      else if (ex.status === "fallado") falladoCount++;
    }
  }

  const score = rec && rec.score !== null && rec.score !== undefined && rec.score !== ""
    ? Number(rec.score)
    : null;
  const percent = score !== null && Number.isFinite(score) && maxMarks > 0
    ? Math.round((score / maxMarks) * 1000) / 10
    : null;
  const autoGrade = percent !== null ? calcIBGrade(percent, boundaries) : null;
  const manualGrade = rec && rec.manualGrade ? Number(rec.manualGrade) : null;
  const ibGrade = manualGrade || autoGrade;

  let status = rec ? rec.status || "pendiente" : "pendiente";
  if (status === "pendiente" && (doneCount > 0 || score !== null || manualGrade !== null)) {
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
    autoGrade,
    manualGrade,
    ibGrade,
    totalQuestions,
    doneCount,
    bienCount,
    repasarCount,
    falladoCount,
    hasExercisePoints,
    exercisePointsEarned: Math.round(exercisePointsEarned * 10) / 10,
    exercisePointsMax: Math.round(exercisePointsMax * 10) / 10,
    attemptsCount,
    lastPracticed: rec ? rec.lastPracticed || "" : "",
    hasNotes,
    exerciseNotesCount
  };
}

export function updateExamFields(state, examId, patch) {
  const rec = ensureExamRecord(state, examId);
  Object.assign(rec, patch);
  if ((patch.score !== undefined && patch.score !== null && patch.score !== "") || patch.manualGrade) {
    if (!rec.lastPracticed) rec.lastPracticed = todayISO();
    if (rec.status === "pendiente") rec.status = "en-progreso";
  }
  saveState(state);
  return rec;
}

export function updateExercise(state, examId, qNum, patch) {
  const def = getExamDef(examId);
  const rec = ensureExamRecord(state, examId);
  const key = String(qNum);
  if (!rec.exercises[key]) {
    rec.exercises[key] = {
      status: "pendiente",
      points: null,
      maxPoints: getQuestionMaxMarks(def, qNum),
      topic: "",
      note: "",
      date: ""
    };
  }
  const ex = rec.exercises[key];
  Object.assign(ex, patch);
  if (patch.status && patch.status !== "pendiente") {
    if (!ex.date) ex.date = todayISO();
    rec.lastPracticed = ex.date;
    if (rec.status === "pendiente") rec.status = "en-progreso";
  }
  saveState(state);
  return ex;
}

export function applyExerciseSumToExam(state, examId) {
  const def = getExamDef(examId);
  const rec = ensureExamRecord(state, examId);
  const derived = getExamDerived(def, rec, state.settings.gradeBoundaries);
  if (!derived.hasExercisePoints) return null;
  rec.score = derived.exercisePointsEarned;
  rec.manualGrade = null;
  if (!rec.lastPracticed) rec.lastPracticed = todayISO();
  if (rec.status === "pendiente") rec.status = "en-progreso";
  saveState(state);
  return rec;
}

export function saveExamAttempt(state, examId, summaryText = "") {
  const def = getExamDef(examId);
  const rec = ensureExamRecord(state, examId);
  const derived = getExamDerived(def, rec, state.settings.gradeBoundaries);
  const date = rec.lastPracticed || todayISO();
  rec.lastPracticed = date;

  const attempt = {
    id: makeId("att"),
    date,
    score: derived.score,
    maxMarks: derived.maxMarks,
    percent: derived.percent,
    ibGrade: derived.ibGrade,
    mode: rec.mode || "clase",
    durationMin: rec.durationMin || null,
    doneQuestions: derived.doneCount,
    totalQuestions: derived.totalQuestions,
    summary: summaryText.trim() || (
      derived.score !== null
        ? `Intento registrado: ${derived.score}/${derived.maxMarks} (${derived.percent}%)`
        : derived.ibGrade
          ? `Intento registrado: Nota IB ${derived.ibGrade}`
          : `Sesión registrada (${derived.doneCount}/${derived.totalQuestions} ejercicios)`
    )
  };
  rec.attempts.unshift(attempt);

  state.activityLog.unshift({
    id: makeId("log"),
    date,
    type: "intento",
    examId,
    mode: rec.mode || "clase",
    score: derived.score,
    maxMarks: derived.maxMarks,
    percent: derived.percent,
    ibGrade: derived.ibGrade,
    exerciseNumbers: Object.entries(rec.exercises)
      .filter(([, ex]) => ex && ex.status && ex.status !== "pendiente")
      .map(([k]) => Number(k))
      .sort((a, b) => a - b),
    summary: attempt.summary
  });

  saveState(state);
  return attempt;
}

export function logExercisesSession(state, examId, date, exerciseNums, summaryText = "") {
  const def = getExamDef(examId);
  const rec = ensureExamRecord(state, examId);
  const cleanNums = [...new Set(exerciseNums.map(Number).filter((n) => Number.isFinite(n) && n >= 1))].sort((a, b) => a - b);
  const sessionDate = date || todayISO();
  rec.lastPracticed = sessionDate;

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
  return entry;
}

export function deleteActivityEntry(state, logId) {
  state.activityLog = state.activityLog.filter((item) => item.id !== logId);
  saveState(state);
}

export function deleteAttempt(state, examId, attemptId) {
  const rec = state.exams[examId];
  if (!rec || !Array.isArray(rec.attempts)) return;
  rec.attempts = rec.attempts.filter((a) => a.id !== attemptId);
  saveState(state);
}

export function addOrUpdateNote(state, noteData) {
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
    updatedAt: new Date().toISOString()
  };
  const idx = state.notes.findIndex((n) => n.id === clean.id);
  if (idx >= 0) {
    state.notes[idx] = { ...state.notes[idx], ...clean };
  } else {
    state.notes.unshift(clean);
  }
  saveState(state);
  return clean;
}

export function toggleNoteField(state, noteId, field) {
  const note = state.notes.find((n) => n.id === noteId);
  if (!note) return null;
  note[field] = !note[field];
  note.updatedAt = new Date().toISOString();
  saveState(state);
  return note;
}

export function deleteNote(state, noteId) {
  state.notes = state.notes.filter((n) => n.id !== noteId);
  saveState(state);
}

export function getReviewQueue(state) {
  const items = [];
  for (const def of EXAMS) {
    const rec = state.exams[def.id];
    if (!rec) continue;
    const exercises = rec.exercises || {};
    for (const [qKey, ex] of Object.entries(exercises)) {
      if (ex && (ex.status === "repasar" || ex.status === "fallado")) {
        items.push({
          type: "exercise",
          examId: def.id,
          examDef: def,
          qNum: Number(qKey),
          status: ex.status,
          topic: ex.topic || "",
          points: ex.points,
          maxPoints: ex.maxPoints || getQuestionMaxMarks(def, Number(qKey)),
          note: ex.note || "",
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
        points: rec.score,
        maxPoints: rec.maxMarks || def.maxMarks,
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
  for (const def of EXAMS) {
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
        text: rec.examNotes.trim()
      });
    }
    const exercises = rec.exercises || {};
    for (const [qKey, ex] of Object.entries(exercises)) {
      if (ex && ex.note && ex.note.trim()) {
        out.push({
          id: `ex_note_${def.id}_${qKey}`,
          source: "exercise",
          examId: def.id,
          examDef: def,
          qNum: Number(qKey),
          date: ex.date || rec.lastPracticed || "",
          topic: ex.topic || "",
          status: ex.status || "pendiente",
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
  let examsWorked = 0;
  let examsCompleted = 0;
  let exercisesDone = 0;
  let exercisesBien = 0;
  let exercisesRepasar = 0;
  let exercisesFallado = 0;
  const percents = [];
  const grades = [];

  const topicStats = Object.fromEntries(
    MAI_TOPICS.map((t) => [t.id, { ...t, bien: 0, repasar: 0, fallado: 0, total: 0 }])
  );
  let untaggedExercises = 0;

  const evolutionPoints = [];

  for (const def of EXAMS) {
    const rec = state.exams[def.id];
    const derived = getExamDerived(def, rec, boundaries);
    if (derived.status !== "pendiente") examsWorked++;
    if (derived.status === "completado") examsCompleted++;
    exercisesDone += derived.doneCount;
    exercisesBien += derived.bienCount;
    exercisesRepasar += derived.repasarCount;
    exercisesFallado += derived.falladoCount;

    if (derived.percent !== null) percents.push(derived.percent);
    if (derived.ibGrade !== null) grades.push(derived.ibGrade);

    if (rec && rec.exercises) {
      for (const ex of Object.values(rec.exercises)) {
        if (!ex || !ex.status || ex.status === "pendiente") continue;
        if (ex.topic && topicStats[ex.topic]) {
          topicStats[ex.topic].total++;
          if (ex.status === "bien") topicStats[ex.topic].bien++;
          else if (ex.status === "repasar") topicStats[ex.topic].repasar++;
          else if (ex.status === "fallado") topicStats[ex.topic].fallado++;
        } else {
          untaggedExercises++;
        }
      }
    }

    // Evolution points: prefer saved attempts; if none, include current scored exam
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
        } else if (att.ibGrade) {
          const approxPct = boundaries[att.ibGrade - 1] + 6;
          evolutionPoints.push({
            date: att.date || rec.lastPracticed || "",
            label: def.shortTitle,
            examId: def.id,
            percent: Math.min(100, approxPct),
            ibGrade: att.ibGrade,
            scoreText: `IB ${att.ibGrade}`
          });
        }
      }
    } else if (derived.percent !== null) {
      evolutionPoints.push({
        date: derived.lastPracticed || "",
        label: def.shortTitle,
        examId: def.id,
        percent: derived.percent,
        ibGrade: derived.ibGrade,
        scoreText: `${derived.score}/${derived.maxMarks}`
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

  return {
    examsTotal: EXAMS.length,
    examsWorked,
    examsCompleted,
    exercisesDone,
    exercisesBien,
    exercisesRepasar,
    exercisesFallado,
    avgPercent,
    avgIbGrade,
    pendingNotesCount,
    totalNotesCount: state.notes.length,
    reviewQueueCount,
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

  // Merge mode: combine exams, deduplicate activityLog & notes by id
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
    "Examen",
    "Año",
    "Convocatoria",
    "Asignatura",
    "Prueba",
    "Estado",
    "Modo",
    "Última fecha",
    "Puntuación",
    "Máximo",
    "Porcentaje",
    "Nota IB",
    "Ejercicios hechos",
    "Total preguntas",
    "Bien",
    "Repasar",
    "Fallado",
    "Notas"
  ];
  const esc = (v) => {
    const str = v === null || v === undefined ? "" : String(v);
    return `"${str.replace(/"/g, '""')}"`;
  };
  const rows = [headers.map(esc).join(",")];
  for (const def of EXAMS) {
    const rec = state.exams[def.id];
    const d = getExamDerived(def, rec, boundaries);
    if (d.status === "pendiente" && !d.hasNotes) continue;
    rows.push([
      def.title,
      def.year,
      def.session,
      def.subject,
      `P${def.paper}`,
      d.status,
      d.mode,
      d.lastPracticed,
      d.score ?? "",
      d.maxMarks,
      d.percent !== null ? `${d.percent}%` : "",
      d.ibGrade ?? "",
      d.doneCount,
      d.totalQuestions,
      d.bienCount,
      d.repasarCount,
      d.falladoCount,
      rec ? rec.examNotes || "" : ""
    ].map(esc).join(","));
  }
  return "\uFEFF" + rows.join("\n");
}

import assert from "node:assert/strict";
import { EXAMS, EXTRA_RESOURCES, MAI_TOPICS, DEFAULT_GRADE_BOUNDARIES, GDC_CHEATSHEET } from "../js/data.js";
import { SUBTOPICS, EXERCISE_CATALOG } from "../js/exercises_catalog.js";
import {
  IB_CURVE_PRESETS,
  score10ToIBPoints,
  ibPointsToScore10,
  suggestScoreFromMistakes,
  calcOptimalSeconds,
  calcIBGrade
} from "../js/ib_grading.js";
import { PracticeTimer } from "../js/timer.js";
import {
  encodeInviteLink,
  parseInviteFromSearch,
  stateToRemoteMap,
  mergeSyncedStates
} from "../js/sync.js";
import {
  createDefaultState,
  updateExamFields,
  updateExercise,
  applyExerciseSumToExam,
  saveExamAttempt,
  logExercisesSession,
  addOrUpdateNote,
  toggleNoteField,
  getExamDerived,
  getAllCatalogExercises,
  getGlobalStats,
  getReviewQueue,
  getExamAndExerciseNotes,
  buildExportPayload,
  importBackupJSON,
  buildCSVExport
} from "../js/store.js";
import { renderEvolutionChart, renderTopicsMastery, renderTopMistakes } from "../js/charts.js";

console.log("1. Verificando catálogo completo de 625 ejercicios (MAI NM 2026)...");
assert.equal(EXAMS.length, 59);
assert.equal(EXTRA_RESOURCES.length, 1);
assert.equal(MAI_TOPICS.length, 5);
assert.ok(GDC_CHEATSHEET.length >= 5);

const state0 = createDefaultState();
const allEx = getAllCatalogExercises(state0);
assert.equal(allEx.length, 625, `Esperados 625 ejercicios (609 + 16), obtenidos ${allEx.length}`);

// Spot-checks pedagógicos MAI NM 2026
const logicQ = EXERCISE_CATALOG["2018-05-estudios-p1"].find((x) => x.q === 2);
assert.equal(logicQ.mai2026, "out", "Lógica proposicional de 2018 P1 Q2 debe quedar fuera de MAI 2026");

const derivQ = EXERCISE_CATALOG["2021-05-mai-p1"].find((x) => x.q === 13);
assert.equal(derivQ.mai2026, "in");
assert.equal(derivQ.topic, "T5");

const finQ = EXERCISE_CATALOG["2021-05-mai-p1"].find((x) => x.q === 10);
assert.equal(finQ.mai2026, "in");
assert.ok(finQ.subtopics.includes("finanzas"));

const ocrVenn = EXERCISE_CATALOG["2015-05-estudios-p1"].find((x) => x.q === 6);
assert.ok(ocrVenn.subtopics.includes("probabilidad-venn"), "OCR 2015 Mayo P1 Q6 debe detectarse como Venn");
console.log(`   OK 625 ejercicios clasificados (${allEx.filter((x) => x.mai2026 === "in").length} MAI 2026, ${allEx.filter((x) => x.mai2026 === "out").length} fuera MAI)`);

console.log("2. Verificando motor 1–10 → puntos IB ponderados → Nota IB (1–7) y fallos típicos...");
assert.equal(IB_CURVE_PRESETS.length, 3);
assert.equal(score10ToIBPoints(7.5, 6), 4.5);
assert.equal(score10ToIBPoints(8, 15), 12);
assert.equal(ibPointsToScore10(12, 15), 8);
assert.equal(calcIBGrade(37, DEFAULT_GRADE_BOUNDARIES), 4);
assert.equal(calcIBGrade(76, DEFAULT_GRADE_BOUNDARIES), 7);

const sSig = suggestScoreFromMistakes(["sig_figs"], 6);
assert.equal(sSig.suggestedPoints, 5, "Error de 3 c.s. en 6 pts debe descontar 1 pt AP -> 5/6");

const sFt = suggestScoreFromMistakes(["wrong_setup", "follow_through"], 16);
const sNoFt = suggestScoreFromMistakes(["wrong_setup"], 16);
assert.ok(sFt.suggestedPoints > sNoFt.suggestedPoints, "Error de arrastre (FT) debe proteger puntos respecto a sin FT");

assert.equal(calcOptimalSeconds(6, 90, 90), 360, "6 pts de 90 en 90 min = 6:00");
assert.equal(calcOptimalSeconds(16, 80, 90), 1080, "16 pts de 80 en 90 min = 18:00");
console.log("   OK calificación 1–10 ↔ IB real, sugerencias de fallos y tiempos óptimos");

console.log("3. Verificando flujo de examen, notas 1–10, temporizador y Top Errores...");
const state = createDefaultState();
state.settings.studentName = "Alumno MAI";
const targetId = "2018-05-estudios-p2";
const targetDef = EXAMS.find((e) => e.id === targetId);

updateExercise(state, targetId, 1, { score10: 8.5, mistakes: ["sig_figs"], note: "Casi perfecto, solo 2 c.s. en (d)" }, "profesor");
updateExercise(state, targetId, 2, { score10: 5, mistakes: ["gdc_error", "context_units"], note: "Revisar ventana GDC" }, "profesor");
updateExercise(state, targetId, 3, { score10: 3, mistakes: ["wrong_setup"], note: "Repasar planteamiento" }, "alumno");

const d = getExamDerived(targetDef, state.exams[targetId], state.settings.gradeBoundaries, state.settings.syllabusStatus);
assert.equal(d.doneCount, 3);
assert.equal(d.bienCount, 1);
assert.equal(d.repasarCount, 1);
assert.equal(d.falladoCount, 1);
assert.ok(d.projectedPercent > 50 && d.projectedPercent < 62, `Proyección esperada ~56%, recibida ${d.projectedPercent}`);
assert.equal(d.projectedIbGrade, 5);

applyExerciseSumToExam(state, targetId, "profesor");
saveExamAttempt(state, targetId, "Práctica en clase", "profesor");
logExercisesSession(state, "2021-05-mai-p1", "2026-11-23", [1, 2, 5], "Bloque inicial", "alumno");

const t = new PracticeTimer();
t.start({ mode: "exercise", examId: targetId, qNum: 1, optimalSec: 300, initialElapsedSec: 250 });
assert.equal(t.getSnapshot().phase, "warning");
t.elapsedSec = 320;
assert.equal(t.getSnapshot().phase, "overtime");
assert.equal(t.getSnapshot().overtimeSec, 20);
const finished = t.finish();
assert.equal(finished.elapsedSec, 320);

const stats = getGlobalStats(state);
assert.ok(stats.topMistakes.length === 4);
assert.ok(renderTopMistakes(stats.topMistakes).includes("Redondeo"));
assert.ok(renderEvolutionChart(stats.evolutionPoints, state.settings.gradeBoundaries).includes("<svg"));
assert.ok(renderTopicsMastery(stats.topicStats, stats.untaggedExercises).includes("del banco"));
console.log("   OK flujo de ejercicios, proyección IB, temporizador y analíticas");

console.log("4. Verificando sincronización Firebase (enlace invitación + fusión Profesor/Alumno)...");
const inviteUrl = encodeInviteLink("https://carlosssainz.github.io/ib-mai-tracker/", "https://mi-proyecto-default-rtdb.europe-west1.firebasedatabase.app/", "Sala MAI 2027", "alumno");
const parsedInvite = parseInviteFromSearch(new URL(inviteUrl).search);
assert.equal(parsedInvite.dbUrl, "https://mi-proyecto-default-rtdb.europe-west1.firebasedatabase.app");
assert.equal(parsedInvite.roomCode, "sala-mai-2027");
assert.equal(parsedInvite.role, "alumno");

// Simular edición concurrente: Profesor anota en 2018-05 P2 y crea Nota A; Alumno anota en 2021-05 P1 y crea Nota B
const profState = createDefaultState();
updateExercise(profState, "2018-05-estudios-p2", 1, { score10: 9, note: "Muy bien" }, "profesor");
addOrUpdateNote(profState, { title: "Nota del profesor", body: "Repasar TVM Solver" }, "profesor");

const studentState = createDefaultState();
updateExercise(studentState, "2021-05-mai-p1", 5, { score10: 7, note: "Duda en cuartiles" }, "alumno");
addOrUpdateNote(studentState, { title: "Duda del alumno", body: "¿Cómo meto frecuencias agrupadas?" }, "alumno");

const merged = mergeSyncedStates(profState, stateToRemoteMap(studentState));
assert.ok(merged.exams["2018-05-estudios-p2"]?.exercises["1"]?.score10 === 9, "Debe conservar ejercicio del profesor");
assert.ok(merged.exams["2021-05-mai-p1"]?.exercises["5"]?.score10 === 7, "Debe incluir ejercicio del alumno");
assert.equal(merged.notes.length, 2, "Debe conservar las notas de ambos sin sobrescribir");
console.log("   OK enlace invitación alumno y fusión bidireccional sin pérdida");

console.log("5. Verificando respaldo JSON y CSV...");
const exp = buildExportPayload(merged);
const rest = importBackupJSON(createDefaultState(), exp, "replace");
assert.equal(rest.notes.length, 2);
const csv = buildCSVExport(rest);
assert.ok(csv.includes("2018 Mayo") && csv.includes("2021 Mayo"));
console.log("   OK JSON y CSV");

console.log("\nTODAS LAS VERIFICACIONES V2 PASARON CORRECTAMENTE.");

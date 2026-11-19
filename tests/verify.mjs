import assert from "node:assert/strict";
import { EXAMS, EXTRA_RESOURCES, MAI_TOPICS, DEFAULT_GRADE_BOUNDARIES } from "../js/data.js";
import {
  createDefaultState,
  calcIBGrade,
  updateExamFields,
  updateExercise,
  applyExerciseSumToExam,
  saveExamAttempt,
  logExercisesSession,
  addOrUpdateNote,
  toggleNoteField,
  getExamDerived,
  getGlobalStats,
  getReviewQueue,
  getExamAndExerciseNotes,
  buildExportPayload,
  importBackupJSON,
  buildCSVExport
} from "../js/store.js";
import { renderEvolutionChart, renderTopicsMastery } from "../js/charts.js";

console.log("1. Verificando integridad del catálogo...");
assert.equal(EXAMS.length, 59, "Debe haber exactamente 59 exámenes únicos");
assert.equal(EXTRA_RESOURCES.length, 1, "Debe haber 1 guía extra");
assert.equal(MAI_TOPICS.length, 5, "Debe haber 5 temas oficiales MAI NM");

const seenIds = new Set();
const withSol = EXAMS.filter((e) => e.hasSolution);
assert.equal(withSol.length, 10, "Debe haber exactamente 10 exámenes con solución");
for (const e of EXAMS) {
  assert.ok(!seenIds.has(e.id), `ID duplicado: ${e.id}`);
  seenIds.add(e.id);
  assert.ok(e.enunciadoUrl.startsWith("https://drive.google.com/file/d/"), `URL inválida en ${e.id}`);
  assert.ok(e.maxMarks >= 60 && e.maxMarks <= 120, `maxMarks fuera de rango en ${e.id}: ${e.maxMarks}`);
  assert.ok(e.defaultQuestions >= 5 && e.defaultQuestions <= 15, `defaultQuestions inválido en ${e.id}`);
  if (e.hasSolution) {
    assert.ok(e.solucionUrl && e.solucionUrl.startsWith("https://drive.google.com/file/d/"), `Falta solucionUrl en ${e.id}`);
  }
}
const mai2021 = EXAMS.filter((e) => e.category === "mai-2021");
assert.equal(mai2021.length, 2, "Debe haber 2 exámenes MAI NM 2021");
assert.equal(mai2021[0].maxMarks, 80, "MAI 2021 debe tener máximo 80 puntos");
console.log("   OK catálogo (59 exámenes, 10 con solución, 0 IDs duplicados)");

console.log("2. Verificando cálculo de Nota IB (1–7)...");
assert.equal(calcIBGrade(0, DEFAULT_GRADE_BOUNDARIES), 1);
assert.equal(calcIBGrade(14, DEFAULT_GRADE_BOUNDARIES), 2);
assert.equal(calcIBGrade(41, DEFAULT_GRADE_BOUNDARIES), 4);
assert.equal(calcIBGrade(66, DEFAULT_GRADE_BOUNDARIES), 6);
assert.equal(calcIBGrade(78, DEFAULT_GRADE_BOUNDARIES), 7);
assert.equal(calcIBGrade(100, DEFAULT_GRADE_BOUNDARIES), 7);
assert.equal(calcIBGrade(null, DEFAULT_GRADE_BOUNDARIES), null);
console.log("   OK umbrales IB 1–7");

console.log("3. Verificando registro por ejercicio, suma automática, intentos e historial...");
let state = createDefaultState();
state.settings.studentName = "Alumno Prueba";
const targetId = "2018-05-estudios-p2";
const targetDef = EXAMS.find((e) => e.id === targetId);

updateExercise(state, targetId, 1, { status: "bien", points: 14, topic: "T4", note: "Diagrama de Venn perfecto" });
updateExercise(state, targetId, 2, { status: "repasar", points: 10, topic: "T1", note: "Revisar interés compuesto TVM" });
updateExercise(state, targetId, 3, { status: "fallado", points: 4, topic: "T5", note: "Repasar optimización con derivada" });

let derived = getExamDerived(targetDef, state.exams[targetId], state.settings.gradeBoundaries);
assert.equal(derived.doneCount, 3);
assert.equal(derived.bienCount, 1);
assert.equal(derived.repasarCount, 1);
assert.equal(derived.falladoCount, 1);
assert.equal(derived.exercisePointsEarned, 28);
assert.equal(derived.status, "en-progreso");

applyExerciseSumToExam(state, targetId);
updateExamFields(state, targetId, { status: "completado", score: 72, mode: "simulacro", examNotes: "Muy buena evolución en P2" });
derived = getExamDerived(targetDef, state.exams[targetId], state.settings.gradeBoundaries);
assert.equal(derived.percent, 80);
assert.equal(derived.ibGrade, 7);

saveExamAttempt(state, targetId, "Simulacro completo");
logExercisesSession(state, "2021-05-mai-p1", "2026-11-19", [1, 2, 3], "Práctica inicial MAI 2021");

const queue = getReviewQueue(state);
assert.equal(queue.length, 2, "Debe haber 2 ejercicios en cola de repaso (1 fallado + 1 repasar)");
assert.equal(queue[0].status, "fallado", "Fallados deben priorizarse primero");

const exNotes = getExamAndExerciseNotes(state);
assert.equal(exNotes.length, 4, "1 nota general de examen + 3 notas de ejercicios");
console.log("   OK flujo de examen, ejercicios, intentos y cola de repaso");

console.log("4. Verificando sección de Notas, estadísticas y gráficos SVG...");
const note = addOrUpdateNote(state, {
  title: "Truco TI-84 Chi-cuadrado",
  category: "gdc",
  topic: "T4",
  examId: targetId,
  body: "Usar STAT -> TESTS -> χ²-Test con matriz [A].",
  pinned: true
});
assert.equal(state.notes.length, 1);
toggleNoteField(state, note.id, "reviewed");
assert.equal(state.notes[0].reviewed, true);

const stats = getGlobalStats(state);
assert.equal(stats.examsWorked, 1);
assert.equal(stats.examsCompleted, 1);
assert.equal(stats.exercisesDone, 3);
assert.equal(stats.avgIbGrade, 7);
assert.equal(stats.evolutionPoints.length, 1);

const evoSvg = renderEvolutionChart(stats.evolutionPoints, state.settings.gradeBoundaries);
assert.ok(evoSvg.includes("<svg") && evoSvg.includes("IB 7"), "Gráfico SVG de evolución válido");
const topicsHtml = renderTopicsMastery(stats.topicStats, stats.untaggedExercises);
assert.ok(topicsHtml.includes("T4") && topicsHtml.includes("T5"), "Gráfico de temas MAI válido");
console.log("   OK notas, estadísticas globales y gráficos SVG");

console.log("5. Verificando Exportar/Importar JSON (replace y merge) y CSV...");
const exported = buildExportPayload(state);
const restored = importBackupJSON(createDefaultState(), exported, "replace");
assert.equal(restored.settings.studentName, "Alumno Prueba");
assert.equal(restored.notes.length, 1);
assert.equal(restored.activityLog.length, 2);
assert.equal(restored.exams[targetId].score, 72);

// Merge test: add another note to target state and merge backup
const otherState = createDefaultState();
addOrUpdateNote(otherState, { title: "Nota existente", body: "Conservar" });
const merged = importBackupJSON(otherState, exported, "merge");
assert.equal(merged.notes.length, 2, "Merge debe conservar notas de ambos lados");
assert.equal(merged.exams[targetId].score, 72);

const csv = buildCSVExport(restored);
assert.ok(csv.includes("2018 Mayo") && csv.includes("80%"), "CSV exportado contiene datos esperados");
console.log("   OK respaldo JSON (replace + merge) y exportación CSV");

console.log("\nTODAS LAS VERIFICACIONES PASARON CORRECTAMENTE.");

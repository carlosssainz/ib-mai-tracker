import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

import { EXAMS, EXTRA_RESOURCES, MAI_TOPICS, DEFAULT_GRADE_BOUNDARIES, GDC_CHEATSHEET } from "../js/data.js";
import { EXERCISE_CATALOG } from "../js/exercises_catalog.js";
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
  APPS_SCRIPT_CODE,
  POLL_INTERVALS,
  validateScriptUrl,
  generateRoomCode,
  encodeInviteLink,
  parseInviteFromSearch,
  stateToRemoteMap,
  mergeSyncedStates,
  DriveSyncClient
} from "../js/sync.js";
import {
  createDefaultState,
  updateExercise,
  applyExerciseSumToExam,
  saveExamAttempt,
  logExercisesSession,
  addOrUpdateNote,
  deleteNote,
  getExamDerived,
  getAllCatalogExercises,
  getGlobalStats,
  buildExportPayload,
  importBackupJSON,
  buildCSVExport
} from "../js/store.js";
import { renderEvolutionChart, renderTopicsMastery, renderTopMistakes } from "../js/charts.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

console.log("1. Verificando catálogo completo de 625 ejercicios (MAI NM 2026)...");
assert.equal(EXAMS.length, 59);
assert.equal(EXTRA_RESOURCES.length, 1);
assert.equal(MAI_TOPICS.length, 5);
assert.ok(GDC_CHEATSHEET.length >= 5);

const state0 = createDefaultState();
const allEx = getAllCatalogExercises(state0);
assert.equal(allEx.length, 625, `Esperados 625 ejercicios (609 + 16), obtenidos ${allEx.length}`);

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

console.log("4. Verificando eliminación total de Firebase y paridad de apps-script/Code.gs...");
const codeGsPath = path.join(repoRoot, "apps-script", "Code.gs");
const codeGsText = fs.readFileSync(codeGsPath, "utf8");
assert.equal(APPS_SCRIPT_CODE, codeGsText, "js/apps_script_template.js debe ser byte a byte idéntico a apps-script/Code.gs");

const filesToAudit = ["index.html", "styles.css", "js/sync.js", "js/app.js", "js/store.js", "apps-script/Code.gs"];
for (const rel of filesToAudit) {
  const txt = fs.readFileSync(path.join(repoRoot, rel), "utf8");
  assert.ok(!/firebase/i.test(txt), `No debe quedar ninguna referencia a Firebase en ${rel}`);
}
console.log("   OK cero referencias a Firebase y Code.gs sincronizado con el botón de copia en 1 clic");

console.log("5. Verificando apps-script/Code.gs (carpeta privada, LockService, CacheService, POST text/plain y fusión)...");
function createMockAppsScriptRuntime() {
  const folders = new Map();
  const files = new Map();
  const props = new Map();
  const cache = new Map();
  let lockAcquiredCount = 0;
  let lockReleasedCount = 0;
  let driveReadCount = 0;
  let idSeq = 1;

  const makeIter = (arr) => {
    let idx = 0;
    return {
      hasNext: () => idx < arr.length,
      next: () => arr[idx++]
    };
  };

  const makeFolder = (name) => {
    const id = `fld_${idSeq++}`;
    const f = {
      id,
      name,
      trashed: false,
      getId: () => id,
      getName: () => name,
      isTrashed: () => f.trashed,
      getFilesByName: (fname) => makeIter([...files.values()].filter((fl) => fl.folderId === id && fl.name === fname && !fl.trashed)),
      createFile: (fname, content) => {
        const fid = `fil_${idSeq++}`;
        const fileObj = {
          id: fid,
          folderId: id,
          name: fname,
          content: String(content || ""),
          trashed: false,
          getId: () => fid,
          isTrashed: () => fileObj.trashed,
          setContent: (txt) => { fileObj.content = String(txt); },
          getBlob: () => ({
            getDataAsString: () => {
              driveReadCount++;
              return fileObj.content;
            }
          })
        };
        files.set(fid, fileObj);
        return fileObj;
      }
    };
    folders.set(id, f);
    return f;
  };

  const rootFolder = {
    getFoldersByName: (name) => makeIter([...folders.values()].filter((fl) => fl.name === name && !fl.trashed)),
    createFolder: (name) => makeFolder(name)
  };

  const sandbox = {
    DriveApp: {
      getRootFolder: () => rootFolder,
      getFolderById: (id) => {
        const f = folders.get(id);
        if (!f) throw new Error("Not found");
        return f;
      },
      getFileById: (id) => {
        const f = files.get(id);
        if (!f) throw new Error("Not found");
        return f;
      }
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (props.has(k) ? props.get(k) : null),
        setProperty: (k, v) => props.set(k, String(v))
      })
    },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => (cache.has(k) ? cache.get(k) : null),
        getAll: (keys) => Object.fromEntries(keys.filter((k) => cache.has(k)).map((k) => [k, cache.get(k)])),
        putAll: (obj) => { for (const [k, v] of Object.entries(obj)) cache.set(k, String(v)); }
      })
    },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => { lockAcquiredCount++; return true; },
        releaseLock: () => { lockReleasedCount++; }
      })
    },
    ContentService: {
      MimeType: { JSON: "application/json" },
      createTextOutput: (txt) => ({
        _txt: txt,
        _mime: null,
        setMimeType(m) { this._mime = m; return this; },
        getContent() { return this._txt; }
      })
    },
    MimeType: { PLAIN_TEXT: "text/plain" }
  };

  vm.createContext(sandbox);
  vm.runInContext(codeGsText, sandbox);

  const callPost = (obj) => {
    const out = sandbox.doPost({ postData: { contents: JSON.stringify(obj), type: "text/plain" } });
    return JSON.parse(out.getContent());
  };

  const callGet = (params) => {
    const out = sandbox.doGet({ parameter: params });
    return JSON.parse(out.getContent());
  };

  return {
    sandbox,
    callPost,
    callGet,
    stats: () => ({
      folderNames: [...folders.values()].map((f) => f.name),
      fileNames: [...files.values()].map((f) => f.name),
      lockAcquiredCount,
      lockReleasedCount,
      driveReadCount,
      cacheSize: cache.size
    })
  };
}

const gas = createMockAppsScriptRuntime();
const pingRes = gas.callPost({ action: "ping", room: "Sala MAI 2027" });
assert.equal(pingRes.ok, true);
assert.equal(pingRes.folder, "Cuaderno_IB_MAI_Sync_Privado");
assert.ok(!pingRes.folder.includes("EXÁMENES EST MATEMATICOS"), "La carpeta de sync debe estar fuera de EXÁMENES EST MATEMATICOS");

// Probar validación de URLs y enlace de invitación
const scriptUrl = "https://script.google.com/macros/s/AKfycbxMockDeployId123/exec";
assert.equal(validateScriptUrl("https://script.google.com/d/abc/edit").ok, false, "Debe rechazar URLs /edit");
assert.equal(validateScriptUrl(scriptUrl).ok, true, "Debe aceptar URL /exec");
assert.ok(generateRoomCode().startsWith("mai-2027-"));

const inviteUrl = encodeInviteLink("https://carlosssainz.github.io/ib-mai-tracker/", scriptUrl, "Sala MAI 2027", "alumno");
const parsedInvite = parseInviteFromSearch(new URL(inviteUrl).search);
assert.equal(parsedInvite.scriptUrl, scriptUrl);
assert.equal(parsedInvite.roomCode, "sala-mai-2027");
assert.equal(parsedInvite.role, "alumno");

// Probar flujo end-to-end de dos clientes (Profesor + Alumno) contra Code.gs vía POST text/plain
let sentContentTypes = [];
const mockFetch = async (_url, opts) => {
  sentContentTypes.push(opts.headers["Content-Type"]);
  const bodyObj = JSON.parse(opts.body);
  const json = gas.callPost(bodyObj);
  return { ok: true, status: 200, text: async () => JSON.stringify(json) };
};

let profState = createDefaultState();
let studentState = createDefaultState();

const profClient = new DriveSyncClient({
  getState: () => profState,
  fetchImpl: mockFetch,
  onRemoteData: (remoteData) => { profState = mergeSyncedStates(profState, remoteData); }
});

const studentClient = new DriveSyncClient({
  getState: () => studentState,
  fetchImpl: mockFetch,
  onRemoteData: (remoteData) => { studentState = mergeSyncedStates(studentState, remoteData); }
});

// Profesor hace un ejercicio y crea una nota, luego conecta y sube a Drive
updateExercise(profState, "2018-05-estudios-p2", 1, { score10: 9, note: "Muy bien" }, "profesor");
const noteProf = addOrUpdateNote(profState, { title: "Nota del profesor", body: "Repasar TVM Solver" }, "profesor");

await profClient.connect({ enabled: true, scriptUrl, roomCode: "sala-mai-2027", role: "profesor" }, profState);
assert.ok(sentContentTypes.every((ct) => ct === "text/plain;charset=utf-8"), "Todas las peticiones POST deben usar text/plain para evitar CORS");

// Alumno hace otro ejercicio en paralelo antes de conectarse y luego conecta (fusión concurrente sin pisarse)
updateExercise(studentState, "2021-05-mai-p1", 5, { score10: 7, note: "Duda en cuartiles" }, "alumno");
addOrUpdateNote(studentState, { title: "Duda del alumno", body: "¿Cómo meto frecuencias agrupadas?" }, "alumno");

await studentClient.connect({ enabled: true, scriptUrl, roomCode: "sala-mai-2027", role: "alumno" }, studentState);
assert.equal(studentState.exams["2018-05-estudios-p2"]?.exercises["1"]?.score10, 9, "Alumno debe recibir ejercicio del profesor");
assert.equal(studentState.exams["2021-05-mai-p1"]?.exercises["5"]?.score10, 7, "Alumno debe conservar su propio ejercicio");
assert.equal(studentState.notes.length, 2, "Debe haber 2 notas fusionadas");

// Profesor pulsa "Sincronizar ahora" y recibe inmediatamente el ejercicio y la nota del alumno
const syncRes = await profClient.syncNow(profState);
assert.equal(syncRes.ok, true);
assert.equal(syncRes.changed, true);
assert.equal(profState.exams["2021-05-mai-p1"]?.exercises["5"]?.score10, 7, "Profesor debe recibir ejercicio del alumno tras Sincronizar ahora");
assert.equal(profState.notes.length, 2, "Profesor debe tener ambas notas");

// Verificar caché rápida: un pull con sinceRev actual no debe leer Drive
const beforeReads = gas.stats().driveReadCount;
const fastPull = gas.callPost({ action: "pull", room: "sala-mai-2027", sinceRev: profClient.rev });
assert.equal(fastPull.ok, true);
assert.equal(fastPull.changed, false);
assert.equal(gas.stats().driveReadCount, beforeReads, "CacheService debe responder sin leer Drive cuando rev no ha cambiado");

// Verificar propagación de borrado (tombstone)
deleteNote(profState, noteProf.id);
profClient.tombstones.notes[noteProf.id] = { id: noteProf.id, _deleted: true, updatedAt: new Date(Date.now() + 1000).toISOString() };
await profClient.pushFullState(profState);
await studentClient.syncNow(studentState);
assert.equal(studentState.notes.length, 1, "El borrado de nota debe propagarse al alumno");

// Verificar polling inteligente adaptable
profClient.lastActivityAt = Date.now();
assert.equal(profClient.getNextPollDelayMs(Date.now()), POLL_INTERVALS.activeMs);
assert.equal(profClient.getNextPollDelayMs(Date.now() + 5 * 60 * 1000), POLL_INTERVALS.idleMs);
assert.equal(profClient.getNextPollDelayMs(Date.now() + 15 * 60 * 1000), POLL_INTERVALS.deepIdleMs);
profClient.consecutiveErrors = 2;
assert.equal(profClient.getNextPollDelayMs(Date.now()), 20000);

const gasStats = gas.stats();
assert.deepEqual(gasStats.folderNames, ["Cuaderno_IB_MAI_Sync_Privado"]);
assert.ok(gasStats.lockAcquiredCount >= 2 && gasStats.lockAcquiredCount === gasStats.lockReleasedCount, "LockService debe adquirirse y liberarse equilibradamente");

profClient.disconnect();
studentClient.disconnect();
console.log("   OK backend Code.gs, POST text/plain CORS-free, LockService, CacheService, polling inteligente y Sincronizar ahora");

console.log("6. Verificando respaldo JSON y CSV...");
const exp = buildExportPayload(profState);
const rest = importBackupJSON(createDefaultState(), exp, "replace");
assert.equal(rest.notes.length, 1);
const csv = buildCSVExport(rest);
assert.ok(csv.includes("2018 Mayo") && csv.includes("2021 Mayo"));
console.log("   OK JSON y CSV");

console.log("\nTODAS LAS VERIFICACIONES PASARON CORRECTAMENTE.");

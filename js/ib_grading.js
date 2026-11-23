// Motor de calificación IB MAI NM: conversión nota 1–10 → puntos IB ponderados → Nota IB real (1–7)
// + catálogo de fallos típicos de informes de examinadores IB (2021–2026).

export const IB_CURVE_PRESETS = [
  {
    id: "mai-2026-std",
    label: "IB MAI NM Estándar (Mayo 2026 TZ3)",
    hint: "Curva oficial reciente: 4 desde 37%, 6 desde 63%, 7 desde 76%",
    boundaries: [0, 13, 25, 37, 50, 63, 76]
  },
  {
    id: "mai-strict",
    label: "IB MAI NM Exigente (Convocatoria alta)",
    hint: "Curva más estricta: 4 desde 42%, 6 desde 70%, 7 desde 82%",
    boundaries: [0, 14, 27, 42, 57, 70, 82]
  },
  {
    id: "mai-2025-tz2",
    label: "IB MAI NM Suave (Mayo 2025 TZ2)",
    hint: "Exámenes más duros: 4 desde 33%, 6 desde 56%, 7 desde 68%",
    boundaries: [0, 12, 23, 33, 45, 56, 68]
  }
];

export const DEFAULT_GRADE_BOUNDARIES = [...IB_CURVE_PRESETS[0].boundaries];

// Fallos típicos reales en MAI NM (informes oficiales de examinadores IB)
// penaltyType:
//   "fixed_pt": descuenta puntos fijos IB (p. ej. -1 pt AP por 3 c.s.)
//   "frac": descuenta una fracción de los puntos de la pregunta
//   "ft_info": recordatorio positivo de Follow-Through (FT), ayuda a no sobre-penalizar
export const IB_MISTAKES = [
  {
    id: "sig_figs",
    label: "Redondeo ≠ 3 c.s.",
    short: "3 c.s.",
    penaltyType: "fixed_pt",
    penaltyValue: 1,
    severity: "low",
    ibRule: "En IB solo se descuenta 1 punto de precisión (AP) por redondeo incorrecto (y a menudo una vez por examen), no medio ejercicio."
  },
  {
    id: "follow_through",
    label: "Error de arrastre (FT)",
    short: "Arrastre FT",
    penaltyType: "ft_info",
    penaltyValue: 0,
    severity: "info",
    ibRule: "Regla clave IB: si el apartado (a) falla pero usa su valor con método correcto en (b)/(c), en IB SÍ obtiene los puntos (FT). ¡No bajes demasiado la nota!"
  },
  {
    id: "no_working",
    label: "Sin procedimiento / solo GDC",
    short: "Sin proceso",
    penaltyType: "frac",
    penaltyValue: 0.35,
    severity: "mid",
    ibRule: "Si el resultado final es correcto a veces dan (G2), pero si tiene un pequeño fallo sin escribir el planteamiento pierde todos los puntos de método (M1)."
  },
  {
    id: "gdc_error",
    label: "Error en calculadora GDC",
    short: "Fallo GDC",
    penaltyType: "frac",
    penaltyValue: 0.28,
    severity: "mid",
    ibRule: "Muy común: signos PV/PMT en TVM Solver, calculadora en radianes en vez de grados, matriz χ² mal metida o límites de normalcdf/binomcdf."
  },
  {
    id: "context_units",
    label: "Falta contexto / unidades",
    short: "Contexto/Unid.",
    penaltyType: "fixed_pt",
    penaltyValue: 1,
    severity: "low",
    ibRule: "En MAI NM hay que responder en contexto (ej. «rechazar H₀ porque p < 0,05, luego las variables no son independientes») e indicar unidades (€, cm², m/s)."
  },
  {
    id: "arith_sign",
    label: "Despiste cálculo / signo",
    short: "Cálculo/Signo",
    penaltyType: "fixed_pt",
    penaltyValue: 1,
    severity: "low",
    ibRule: "El método (M1) se conserva en IB; normalmente solo se pierde 1 punto de respuesta (A0)."
  },
  {
    id: "wrong_setup",
    label: "Planteamiento / fórmula errónea",
    short: "Planteamiento",
    penaltyType: "frac",
    penaltyValue: 0.55,
    severity: "high",
    ibRule: "Elegir un modelo o fórmula equivocada hace perder los puntos de método (M0) de ese bloque."
  },
  {
    id: "incomplete_time",
    label: "Incompleto por tiempo",
    short: "Faltó tiempo",
    penaltyType: "frac",
    penaltyValue: 0.35,
    severity: "mid",
    ibRule: "No llegó a terminar los últimos apartados. Conviene practicar con el temporizador de tiempo óptimo."
  }
];

export const IB_MISTAKE_MAP = Object.fromEntries(IB_MISTAKES.map((m) => [m.id, m]));

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

export function score10ToIBPoints(score10, maxPoints) {
  if (score10 === null || score10 === undefined || score10 === "") return null;
  const s = Math.max(0, Math.min(10, Number(score10)));
  const m = Number(maxPoints);
  if (!Number.isFinite(s) || !Number.isFinite(m) || m <= 0) return null;
  // Redondeo a 0.5 puntos IB
  return Math.round(((s / 10) * m) * 2) / 2;
}

export function ibPointsToScore10(points, maxPoints) {
  if (points === null || points === undefined || points === "") return null;
  const p = Math.max(0, Number(points));
  const m = Number(maxPoints);
  if (!Number.isFinite(p) || !Number.isFinite(m) || m <= 0) return null;
  return Math.min(10, Math.round(((p / m) * 10) * 10) / 10);
}

/**
 * Sugiere una puntuación IB (y su nota 0–10 equivalente) a partir de los chips de fallos seleccionados.
 * Ayuda al profesor a traducir su impresión a criterios reales del IB (M1/A1/FT).
 */
export function suggestScoreFromMistakes(mistakeIds = [], maxPoints = 6) {
  const m = Math.max(1, Number(maxPoints) || 6);
  if (!Array.isArray(mistakeIds) || mistakeIds.length === 0) {
    return { suggestedPoints: m, suggestedScore10: 10, deductionPoints: 0, hasFT: false, advice: "Sin fallos marcados: puntuación máxima." };
  }
  const hasFT = mistakeIds.includes("follow_through");
  let deduction = 0;
  for (const id of mistakeIds) {
    const def = IB_MISTAKE_MAP[id];
    if (!def) continue;
    if (def.penaltyType === "fixed_pt") {
      deduction += def.penaltyValue;
    } else if (def.penaltyType === "frac") {
      deduction += m * def.penaltyValue;
    }
  }
  // Si hay Follow-Through (FT), suavizamos el impacto de errores secundarios para reflejar el criterio real del IB
  if (hasFT && deduction > 1) {
    deduction = Math.max(1, deduction * 0.78);
  }
  const pts = Math.max(0, Math.min(m, Math.round((m - deduction) * 2) / 2));
  const score10 = ibPointsToScore10(pts, m);
  const advice = hasFT
    ? `Con error de arrastre (FT), el IB conserva puntos de método en apartados posteriores → aprox. ${pts}/${m} pts (${score10}/10).`
    : `Según criterios IB (M1/A1/AP) para ${m} pts → aprox. ${pts}/${m} pts (${score10}/10).`;
  return {
    suggestedPoints: pts,
    suggestedScore10: score10,
    deductionPoints: Math.round((m - pts) * 2) / 2,
    hasFT,
    advice
  };
}

export function getIBGradeDescription(grade) {
  const map = {
    7: "Excelente (Nivel 7 IB)",
    6: "Muy bueno (Nivel 6 IB)",
    5: "Bueno (Nivel 5 IB)",
    4: "Aprobado satisfactorio (Nivel 4 IB)",
    3: "Por debajo del aprobado (Nivel 3 IB)",
    2: "Insuficiente (Nivel 2 IB)",
    1: "Muy bajo (Nivel 1 IB)"
  };
  return map[grade] || "Sin calificar";
}

export function calcOptimalSeconds(questionMarks, examMaxMarks, examDurationMin = 90) {
  const qm = Number(questionMarks) || 6;
  const em = Number(examMaxMarks) || 90;
  const dur = Number(examDurationMin) || 90;
  const mins = (qm / em) * dur;
  // Redondear a múltiplos de 15 segundos, mínimo 2 min
  const secs = Math.max(120, Math.round((mins * 60) / 15) * 15);
  return secs;
}

export function formatDurationCompact(totalSec) {
  if (!Number.isFinite(totalSec) || totalSec <= 0) return "0:00";
  const s = Math.round(totalSec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

export function computeTopMistakes(examsState) {
  const counts = {};
  for (const m of IB_MISTAKES) counts[m.id] = { ...m, count: 0, examples: [] };
  for (const [examId, rec] of Object.entries(examsState || {})) {
    for (const [qNum, ex] of Object.entries(rec?.exercises || {})) {
      if (!Array.isArray(ex?.mistakes)) continue;
      for (const mid of ex.mistakes) {
        if (counts[mid]) {
          counts[mid].count++;
          if (counts[mid].examples.length < 4) {
            counts[mid].examples.push({ examId, qNum: Number(qNum) });
          }
        }
      }
    }
  }
  return Object.values(counts)
    .filter((x) => x.count > 0)
    .sort((a, b) => b.count - a.count);
}

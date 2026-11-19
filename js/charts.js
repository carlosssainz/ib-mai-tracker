function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderEvolutionChart(points, boundaries) {
  if (!points || points.length === 0) {
    return `
      <div class="chart-empty">
        <p class="chart-empty-title">Aún no hay resultados registrados</p>
        <p class="chart-empty-sub">Cuando registres una puntuación o Nota IB en cualquier examen, aquí verás la evolución temporal de tu alumno.</p>
      </div>
    `;
  }

  const width = 640;
  const height = 228;
  const pad = { top: 22, right: 26, bottom: 44, left: 42 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const yOf = (pct) => pad.top + plotH - (Math.max(0, Math.min(100, pct)) / 100) * plotH;
  const xOf = (idx) => {
    if (points.length === 1) return pad.left + plotW / 2;
    return pad.left + (idx / (points.length - 1)) * plotW;
  };

  const b4 = boundaries[3] ?? 41;
  const b6 = boundaries[5] ?? 66;
  const b7 = boundaries[6] ?? 78;

  const yTicks = [0, 25, 50, 75, 100];
  const gridLines = yTicks.map((v) => {
    const y = yOf(v);
    return `
      <line x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}" class="chart-grid" />
      <text x="${pad.left - 8}" y="${y + 4}" text-anchor="end" class="chart-axis-text">${v}%</text>
    `;
  }).join("");

  const refLines = [
    { val: b4, label: `IB 4 (${b4}%)`, cls: "chart-ref-pass" },
    { val: b7, label: `IB 7 (${b7}%)`, cls: "chart-ref-top" }
  ].map((r) => {
    const y = yOf(r.val);
    return `
      <line x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}" class="chart-ref ${r.cls}" stroke-dasharray="4 4" />
      <text x="${width - pad.right}" y="${y - 4}" text-anchor="end" class="chart-ref-label ${r.cls}">${r.label}</text>
    `;
  }).join("");

  const coords = points.map((pt, i) => ({
    ...pt,
    x: Math.round(xOf(i) * 10) / 10,
    y: Math.round(yOf(pt.percent) * 10) / 10
  }));

  let areaPath = "";
  let linePath = "";
  if (coords.length > 1) {
    linePath = coords.map((c, i) => `${i === 0 ? "M" : "L"} ${c.x} ${c.y}`).join(" ");
    areaPath = `${linePath} L ${coords[coords.length - 1].x} ${pad.top + plotH} L ${coords[0].x} ${pad.top + plotH} Z`;
  }

  // Decide which X labels to show so they never collide
  const maxLabels = 7;
  const step = coords.length > maxLabels ? Math.ceil(coords.length / maxLabels) : 1;

  const dots = coords.map((c, i) => {
    const showLabel = i % step === 0 || i === coords.length - 1;
    const tone = c.ibGrade >= 6 ? "good" : c.ibGrade >= 4 ? "mid" : "low";
    const shortDate = c.date ? c.date.slice(5) : "";
    const tip = `${c.label} (${c.date || "Sin fecha"}): ${c.scoreText} · ${c.percent}% · IB ${c.ibGrade}`;
    return `
      <g class="chart-point chart-point--${tone}" data-open-exam="${escapeHtml(c.examId)}">
        <title>${escapeHtml(tip)}</title>
        <circle cx="${c.x}" cy="${c.y}" r="5.5" class="chart-dot" />
        <text x="${c.x}" y="${c.y - 10}" text-anchor="middle" class="chart-val-label">IB ${c.ibGrade}</text>
        ${showLabel ? `<text x="${c.x}" y="${height - 16}" text-anchor="middle" class="chart-axis-text">${escapeHtml(c.label)}</text>` : ""}
        ${showLabel && shortDate ? `<text x="${c.x}" y="${height - 4}" text-anchor="middle" class="chart-axis-sub">${escapeHtml(shortDate)}</text>` : ""}
      </g>
    `;
  }).join("");

  return `
    <div class="chart-wrap">
      <svg viewBox="0 0 ${width} ${height}" class="evolution-svg" role="img" aria-label="Evolución de resultados IB">
        <defs>
          <linearGradient id="ibAreaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.22" />
            <stop offset="100%" stop-color="var(--accent)" stop-opacity="0.01" />
          </linearGradient>
        </defs>
        <rect x="${pad.left}" y="${yOf(100)}" width="${plotW}" height="${yOf(b6) - yOf(100)}" class="chart-band-high" />
        ${gridLines}
        ${refLines}
        ${areaPath ? `<path d="${areaPath}" fill="url(#ibAreaGrad)" />` : ""}
        ${linePath ? `<path d="${linePath}" fill="none" class="chart-line" />` : ""}
        ${dots}
      </svg>
    </div>
  `;
}

export function renderTopicsMastery(topicStats, untaggedCount = 0) {
  const totalTagged = topicStats.reduce((s, t) => s + t.total, 0);
  if (totalTagged === 0) {
    return `
      <div class="chart-empty">
        <p class="chart-empty-title">Sin ejercicios etiquetados por tema todavía</p>
        <p class="chart-empty-sub">Al marcar ejercicios individuales en un examen y asignarles un tema oficial MAI (T1–T5), verás aquí qué bloques domina tu alumno y cuáles conviene reforzar.</p>
      </div>
    `;
  }

  const rows = topicStats.map((t) => {
    const total = t.total;
    const pBien = total ? (t.bien / total) * 100 : 0;
    const pRep = total ? (t.repasar / total) * 100 : 0;
    const pFail = total ? (t.fallado / total) * 100 : 0;
    const mastery = total ? Math.round((t.bien / total) * 100) : null;

    return `
      <div class="topic-row">
        <div class="topic-row-head">
          <div>
            <span class="topic-title">${escapeHtml(t.short)}</span>
            <span class="topic-hint">${escapeHtml(t.hint)}</span>
          </div>
          <div class="topic-counts tabular">
            ${total > 0
              ? `<strong>${mastery}%</strong> bien <span class="muted">(${t.bien}/${total})</span>`
              : `<span class="muted">Sin datos</span>`}
          </div>
        </div>
        <div class="topic-bar" role="img" aria-label="${escapeHtml(t.short)}: ${t.bien} bien, ${t.repasar} repasar, ${t.fallado} duda">
          ${total > 0 ? `
            <span class="topic-seg topic-seg--bien" style="width:${pBien.toFixed(1)}%" title="${t.bien} bien"></span>
            <span class="topic-seg topic-seg--repasar" style="width:${pRep.toFixed(1)}%" title="${t.repasar} con ayuda / repasar"></span>
            <span class="topic-seg topic-seg--fallado" style="width:${pFail.toFixed(1)}%" title="${t.fallado} fallado / duda"></span>
          ` : `<span class="topic-seg topic-seg--empty" style="width:100%"></span>`}
        </div>
      </div>
    `;
  }).join("");

  return `
    <div class="topics-list">
      ${rows}
      <div class="topics-legend">
        <span><i class="dot dot--bien"></i> Bien</span>
        <span><i class="dot dot--repasar"></i> Con ayuda / Repasar</span>
        <span><i class="dot dot--fallado"></i> Fallado / Duda</span>
        ${untaggedCount > 0 ? `<span class="muted">· ${untaggedCount} ejercicio${untaggedCount === 1 ? "" : "s"} sin tema asignado</span>` : ""}
      </div>
    </div>
  `;
}

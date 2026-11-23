#!/usr/bin/env python3
"""
Clasifica todos los ejercicios individuales de los 59 exámenes IB + guía TI-84 Plus
según el currículo oficial IB MAI NM 2026 (sin límites ni lógica proposicional).
Genera js/exercises_catalog.js.
"""

import json
import os
import re
import unicodedata
from collections import Counter

SEED_PATH = "/tmp/ib_v2/exams_seed.json"
TXT_DIR = "/tmp/ib_v2/txt"
OUT_JS = "/home/antigravity/carlosssainz/ib-mai-tracker/js/exercises_catalog.js"

SUBTOPICS = [
    # T4: Estadística y probabilidad (Todo visto)
    {"id": "estadistica-desc", "topic": "T4", "label": "Estadística descriptiva", "defaultSyllabus": "visto", "mai2026": True},
    {"id": "regresion-correlacion", "topic": "T4", "label": "Regresión y correlación", "defaultSyllabus": "visto", "mai2026": True},
    {"id": "probabilidad-venn", "topic": "T4", "label": "Probabilidad y Venn", "defaultSyllabus": "visto", "mai2026": True},
    {"id": "normal", "topic": "T4", "label": "Distribución normal", "defaultSyllabus": "visto", "mai2026": True},
    {"id": "binomial", "topic": "T4", "label": "Distribución binomial", "defaultSyllabus": "visto", "mai2026": True},
    {"id": "hipotesis-chi-t", "topic": "T4", "label": "Chi-cuadrado y test t", "defaultSyllabus": "visto", "mai2026": True},
    # T5: Análisis / Cálculo (Derivadas visto; Trapecio/Área próximo; SIN límites)
    {"id": "derivadas-optimizacion", "topic": "T5", "label": "Derivadas y optimización", "defaultSyllabus": "visto", "mai2026": True},
    {"id": "integrales-trapecio", "topic": "T5", "label": "Trapecio e integral GDC", "defaultSyllabus": "proximo", "mai2026": True},
    # T2: Funciones (Rectas visto; Funciones parcial)
    {"id": "rectas", "topic": "T2", "label": "Rectas y pendientes", "defaultSyllabus": "visto", "mai2026": True},
    {"id": "funciones-cuadraticas", "topic": "T2", "label": "Funciones cuadráticas", "defaultSyllabus": "parcial", "mai2026": True},
    {"id": "funciones-exp-log-trig", "topic": "T2", "label": "Modelos exp., log. y trig.", "defaultSyllabus": "parcial", "mai2026": True},
    # T1: Número y álgebra (Errores/Progresiones/Sistemas visto; Finanzas próximo)
    {"id": "finanzas", "topic": "T1", "label": "Matemáticas financieras", "defaultSyllabus": "proximo", "mai2026": True},
    {"id": "progresiones", "topic": "T1", "label": "Progresiones aritm./geom.", "defaultSyllabus": "visto", "mai2026": True},
    {"id": "notacion-errores", "topic": "T1", "label": "Notación cient., redondeo y error", "defaultSyllabus": "visto", "mai2026": True},
    {"id": "sistemas-algebra", "topic": "T1", "label": "Sistemas y álgebra aplicada", "defaultSyllabus": "visto", "mai2026": True},
    # T3: Geometría y trigonometría
    {"id": "trigonometria", "topic": "T3", "label": "Trigonometría (seno/coseno)", "defaultSyllabus": "visto", "mai2026": True},
    {"id": "geometria-3d-volumen", "topic": "T3", "label": "Geometría 3D, áreas y volúmenes", "defaultSyllabus": "visto", "mai2026": True},
    {"id": "voronoi", "topic": "T3", "label": "Diagramas de Voronoi", "defaultSyllabus": "proximo", "mai2026": True},
    # Fuera de MAI NM 2026
    {"id": "logica-proposicional", "topic": "OUT", "label": "Lógica proposicional (Fuera MAI)", "defaultSyllabus": "out", "mai2026": False},
    {"id": "limites-calculo-avanzado", "topic": "OUT", "label": "Límites / Cálculo MAA (Fuera MAI)", "defaultSyllabus": "out", "mai2026": False},
    {"id": "algebra-trig-maa", "topic": "OUT", "label": "Álgebra/Trig. analítica MAA (Fuera MAI)", "defaultSyllabus": "out", "mai2026": False},
]

SUBTOPIC_TO_TOPIC = {s["id"]: s["topic"] for s in SUBTOPICS}


def norm(text: str) -> str:
    text = unicodedata.normalize("NFD", text.lower())
    text = "".join(c for c in text if unicodedata.category(c) != "Mn")
    return text


def strip_watermarks(text: str) -> str:
    # Remove teoteves diagonal watermark fragments & headers
    text = re.sub(r"Clases de Matem[aá]ticas y F[ií]sica para Bachillerato Internacional", "", text, flags=re.I)
    text = re.sub(r"WhatsApp\s*\+?\d+\s*www\.teoteves\.com", "", text, flags=re.I)
    text = re.sub(r"\b(?:CO|NA|ISIC|ÍSICA|BA|ASE|CH|ILL|HA|ER|TS|TE|TO|ÁT|EO|RN|VE|AC|IO|NT|IC)\b(?:\s+\d+)?", lambda m: "" if len(m.group(0)) <= 6 and m.group(0).isupper() else m.group(0), text)
    return text


def clean_boilerplate(raw: str) -> str:
    raw = strip_watermarks(raw)
    lines = []
    for line in raw.splitlines():
        s = line.strip()
        if not s:
            continue
        low = norm(s)
        if any(skip in low for skip in [
            "no escriba en esta pagina",
            "las respuestas que se escriban",
            "vease al dorso",
            "turn over",
            "matsd/sp",
            "matme/sp",
            "operaciones:",
            "respuestas:",
            "international baccalaureate",
            "organizacion del bachillerato",
            "esta pregunta continua",
            "puntuacion maxima:",
            "instrucciones para los alumnos",
            "cuadernillo de formulas",
            "no abra esta prueba",
            "se otorgara la maxima puntuacion",
            "aun cuando una respuesta sea incorrecta",
            "comience una pagina nueva",
            "empiece una pagina nueva",
            "conteste todas las preguntas",
            "la figura no esta dibujada a escala",
            "fuentes:",
        ]):
            continue
        if re.match(r"^[.\-–—_=|0-9\s/()~'\"*]+$", s):
            continue
        if re.match(r"^[mn]\d{2}/", low):
            continue
        lines.append(s)
    return "\n".join(lines)


def split_questions(raw_text: str, expected_n: int, exam_id: str, paper: int):
    """Split exam text into dict {q_num: chunk_text} for 1..expected_n, handling both vector and OCR PDFs."""
    text = raw_text.replace("\r\n", "\n").replace("\r", "\n")
    lines = text.splitlines()

    search_start = 0
    for idx, line in enumerate(lines[:55]):
        low = norm(line)
        if "instrucciones para los alumnos" in low or "numero de convocatoria" in low:
            search_start = max(search_start, idx + 6)

    # First try strict + OCR-tolerant line prefix matching in ascending order
    anchor_map = {}
    cur_idx = search_start
    for q in range(1, expected_n + 1):
        # Allow optional OCR margin noise before question number like "- 3. ", "=e 6. ", "| 5. ", "— 1. "
        pat_strict = re.compile(rf"^\s*(?:[\-–—|=~•·*«»]{{1,3}}\s*|[a-zA-Z=]{{1,2}}\s+)?{q}\.\s*(?:\S|$)")
        pat_bracket = re.compile(rf"^\s*(?:[^a-zA-Z0-9\n]{{0,4}})?{q}\s*[\.,:]?\s+\[Puntuaci[oó]n m[aá]xima", re.I)
        pat_ocr_nodot = re.compile(rf"^\s*(?:[\-–—|=~]{{1,3}}\s*)?{q}\s+(?:Considere|La |El |Un |Una |En |Se |Los |Las |Dos |Tres |Cuatro |Sea |Sean |Halle|Calcule|Resuelva|Muestre|A continuaci|Para |Dado|Dada|Complete|Durante|Cada|Al |Supon|Fabian|Minta|Un|Una|El|La)", re.I)
        hit = None
        for idx in range(cur_idx, len(lines)):
            ln = lines[idx]
            low = norm(ln)
            if re.match(r"^\s*[-–—~']\s*\d+\s*[-–—~']", ln):
                continue
            if re.search(r"\b\d{1,2}\s+de\s+(mayo|noviembre)\b", low):
                continue
            if re.search(r"^\s*\d{1,2}\s*paginas", low):
                continue
            if "matsd" in low or "221" in ln[:15] or "881" in ln[:15] or "ep0" in low or "ep1" in low or "ep2" in low:
                continue
            if re.match(rf"^\s*{q}\.\d", ln):
                continue
            if pat_bracket.match(ln) or pat_strict.match(ln) or pat_ocr_nodot.match(ln):
                hit = idx
                break
        if hit is not None:
            anchor_map[q] = hit
            cur_idx = hit + 1

    # Second pass: fill any gaps within bounded windows [prev_anchor, next_anchor]
    for q in range(1, expected_n + 1):
        if q in anchor_map:
            continue
        prev_idx = max([anchor_map[k] for k in anchor_map if k < q], default=search_start)
        next_idx = min([anchor_map[k] for k in anchor_map if k > q], default=len(lines))
        for idx in range(prev_idx + 1, next_idx):
            ln = lines[idx]
            low = norm(ln)
            if "matsd" in low or re.match(rf"^\s*{q}\.\d", ln):
                continue
            # Match q. anywhere within first 14 chars (OCR sometimes shifts line)
            if re.search(rf"^.{0,12}\b{q}\.\s+[A-ZÁÉÍÓÚÑa-z\[(]", ln):
                anchor_map[q] = idx
                break

    # Third pass for IB Paper 1 (1 question per page!): use form-feed page breaks for any still-missing q
    if paper == 1 and len(anchor_map) < expected_n:
        page_starts = [0] + [i + 1 for i, ln in enumerate(lines) if "\f" in ln]
        for q in range(1, expected_n + 1):
            if q in anchor_map:
                continue
            prev_idx = max([anchor_map[k] for k in anchor_map if k < q], default=search_start)
            next_idx = min([anchor_map[k] for k in anchor_map if k > q], default=len(lines))
            # Pick first non-blank page start inside (prev_idx, next_idx) that isn't a continuation page
            for ps in page_starts:
                if prev_idx < ps < next_idx:
                    pg_txt = norm("\n".join(lines[ps:min(ps + 8, next_idx)]))
                    if "continuacion" not in pg_txt and "no escriba en esta pagina" not in pg_txt and len(pg_txt.strip()) > 30:
                        anchor_map[q] = ps
                        break

    ordered = sorted(anchor_map.items(), key=lambda kv: kv[0])
    chunks = {}
    for pos, (q, start_i) in enumerate(ordered):
        end_i = ordered[pos + 1][1] if pos + 1 < len(ordered) else len(lines)
        chunks[q] = "\n".join(lines[start_i:end_i])

    for q in range(1, expected_n + 1):
        chunks.setdefault(q, "")
    return chunks


# Weighted keyword rules carefully tuned with strict word boundaries
RULES = [
    # --- OUT OF MAI 2026 ---
    ("logica-proposicional", [
        (r"tabla(?:s)? de verdad", 14),
        (r"\bproposici[oóe]n(?:es)?\b", 12),
        (r"\bsean\s+p\s+y\s+q\b|\bconsidere las proposiciones\b|\bdos proposiciones\b", 14),
        (r"\bcontrarrec[ií]proc|\brec[ií]proca\b|\btautolog|\bcontradicci[oó]n\b|l[oó]gicamente equivalente", 14),
        (r"\bp\s*⇒\s*q|\bq\s*⇒\s*p|¬\s*p|¬\s*q|\bp\s*∨\s*q|\bp\s*∧\s*q", 14),
    ]),
    ("limites-calculo-avanzado", [
        (r"\bl[ií]mite\b|\blim\s*[_(x]", 10),
        (r"sustituci[oó]n\s+u\s*=|integraci[oó]n por partes|por sustituci[oó]n", 14),
        (r"integral\s+indefinida|\bhalle\s+∫|∫\s*\(?[^,\n]{1,30}(?:sen|cos|ln|e\^|x\s*\+\s*4)[^,\n]{0,20}dx", 12),
        (r"punto(?:s)? de inflexi[oó]n|segunda derivada|f\s*['′″]{2}\s*\(x\)", 10),
        (r"volumen de revoluci[oó]n|gira.*alrededor del eje", 12),
    ]),
    ("algebra-trig-maa", [
        (r"teorema del resto|al dividir el polinomio|expansi[oó]n binomial|desarrollo binomial", 12),
        (r"identidad trigonom[eé]trica|\bcos\s*\(?\s*2x|\bsen\s*\(?\s*2x|2\s*sen\s*x\s*cos\s*x", 12),
        (r"funci[oóe]n compuesta|\(\s*f\s*[o∘]\s*g|\(\s*g\s*[o∘]\s*f|halle\s+(?:f|g)\s*[−-]1", 10),
        (r"\bvectores?\b|vector de posici[oó]n|producto escalar", 12),
        (r"valor exacto de\s+(?:sen|cos|tan)", 10),
    ]),

    # --- T4: ESTADÍSTICA Y PROBABILIDAD ---
    ("hipotesis-chi-t", [
        (r"chi[- ]cuadrado|\bχ\s*2\b|contraste.*independencia|prueba.*independencia", 14),
        (r"hip[oó]tesis nula|\bh\s*0\b|\bh0\b|\bvalor\s+p\b|p-valor|nivel de significaci[oó]n|grados de libertad", 13),
        (r"frecuencia(?:s)? esperada(?:s)?|\bprueba\s+t\b|\btest\s+t\b|bondad de ajuste|valor cr[ií]tico", 12),
        (r"muestras independientes|dos colas|una cola|rechazar.*hip[oó]tesis", 11),
    ]),
    ("normal", [
        (r"distribuci[oóe]n normal|normalmente distribu|sigue una normal|~\s*n\s*\(", 14),
        (r"curva normal|campana de gauss", 12),
    ]),
    ("binomial", [
        (r"distribuci[oóe]n binomial|\bbinomial\b|~\s*b\s*\(", 14),
        (r"valor esperado|esperanza matem[aá]tica|juego justo|\be\s*\(\s*x\s*\)", 10),
    ]),
    ("regresion-correlacion", [
        (r"diagrama de dispersi[oó]n|recta de regresi[oóe]n|coeficiente de correlaci[oóe]n", 14),
        (r"\bpearson\b|\bspearman\b|correlaci[oóe]n lineal|correlaci[oóe]n positiva|correlaci[oóe]n negativa", 13),
        (r"recta de mejor ajuste|rango(?:s)? de spearman", 12),
    ]),
    ("probabilidad-venn", [
        (r"diagrama(?:s)? de venn", 14),
        (r"diagrama(?:s)? de [aá]rbol", 13),
        (r"probabilidad condicionada|\bsabiendo que\b|sucesos independientes|mutuamente excluyentes", 11),
        (r"\bprobabilidad\b|elige al azar|selecciona al azar|escoge.*al azar|lanzar.*dado|extrae.*bola|baraja|urna|moneda.*lanza", 9),
        (r"\bn\s*\(\s*a\s*[∪∩]\s*b|\ba\s*∩\s*b|\ba\s*∪\s*b|sombreado.*diagrama", 9),
    ]),
    ("estadistica-desc", [
        (r"frecuencia acumulada|diagrama de caja|caja y bigotes|rango intercuart[ií]lico|\bcuartil(?:es)?\b", 13),
        (r"\bhistograma\b|tallo y hojas|tabla de frecuencias|intervalo modal|clase modal", 12),
        (r"\bmediana\b|desviaci[oó]n t[ií]pica|\bpercentil\b|valor(?:es)? at[ií]pico|\bvarianza\b", 9),
        (r"muestra aleatoria|muestreo|estratificado|sistem[aá]tico|conveniencia", 9),
    ]),

    # --- T5: ANÁLISIS / CÁLCULO ---
    ("derivadas-optimizacion", [
        (r"\bderivada\b|\bf\s*['′]\s*\(x\)|\bdy\s*/\s*dx\b|\bd[a-z]\s*/\s*d[a-z]\b", 14),
        (r"recta tangente|recta normal|pendiente de la curva|pendiente de la tangente|pendiente del gr[aá]fico", 13),
        (r"m[aá]ximo local|m[ií]nimo local|punto estacionario|\bestacionario\b|optimizaci[oó]n|raz[oóe]n de cambio|tasa de cambio", 12),
        (r"es creciente|es decreciente|velocidad instant[aá]nea", 9),
    ]),
    ("integrales-trapecio", [
        (r"regla del trapecio|trapecios.*subintervalos|aproximaci[oó]n.*integral", 14),
        (r"[aá]rea bajo la curva|[aá]rea.*regi[oó]n.*delimitada.*gr[aá]fico|integral definida", 10),
    ]),

    # --- T1: NÚMERO Y ÁLGEBRA ---
    ("finanzas", [
        (r"inter[eé]s compuesto|inter[eé]s simple|tipo de inter[eé]s|tasa de inter[eé]s|inter[eé]s nominal|capitaliza", 14),
        (r"\bpr[eé]stamo\b|\bhipoteca\b|\banualidad\b|\bamortizaci[oó]n\b|\bdepreciaci[oó]n\b|\binflaci[oó]n\b|cuenta de ahorro|\bdeposita\b|\binvierte\b|\binversi[oó]n\b", 12),
        (r"tipo de cambio|tasa de cambio|\bcomisi[oó]n\b|\bdivisas?\b|\bmoneda\b|\beuros?\b|\bd[oó]lares?\b|\blibras?\b|\byenes?\b|\bfrancos?\b|\brupias?\b|\b(?:usd|eur|gbp|aud|chf|cad|fjd|zar|jpy|sgd)\b", 10),
    ]),
    ("progresiones", [
        (r"\bprogresiones\b|\bsucesiones\b", 11),
        (r"progresi[oóe]n aritm[eé]tica|progresi[oóe]n geom[eé]trica|sucesi[oóe]n aritm[eé]tica|sucesi[oóe]n geom[eé]trica", 14),
        (r"diferencia com[uú]n|raz[oóe]n com[uú]n|t[eé]rmino general|primer t[eé]rmino.*t[eé]rmino|\bu\s*1\s*=|\bs\s*n\s*=", 11),
        (r"primera fila.*fila anterior|cada nueva fila.*asientos", 11),
    ]),
    ("notacion-errores", [
        (r"porcentaje de error|error porcentual", 13),
        (r"notaci[oóe]n cient[ií]fica|forma\s+a\s*[×x]\s*10\s*k|1\s*≤\s*a\s*<\s*10", 13),
        (r"conjuntos?\s+(?:distintos\s+de\s+)?n[uú]meros|n[uú]meros\s+naturales|racionales.*reales", 12),
        (r"redondeando.*cifras significativas|estime el valor|valor aproximado", 6),
    ]),
    ("sistemas-algebra", [
        (r"sistema de ecuaciones|resuelva el siguiente sistema|ecuaciones simult[aá]neas", 12),
        (r"\binecuaci[oóe]n\b|\bdesigualdad\b|\bfactorice\b", 8),
    ]),

    # --- T2: FUNCIONES ---
    ("rectas", [
        (r"ecuaci[oóe]n de la recta|\brecta\s+l\s*1\b|\brectas\s+l\s*1\b|\bmediatriz\b|pendiente.*recta|recta.*pendiente", 13),
        (r"recta paralela|recta perpendicular|perpendicular a.*pasa por|intersecci[oó]n de estas dos rectas|punto medio.*segmento", 12),
        (r"forma\s+ax\s*\+\s*by|forma\s+y\s*=\s*mx\s*\+\s*c", 11),
    ]),
    ("funciones-cuadraticas", [
        (r"funci[oóe]n cuadr[aá]tica|\bpar[aá]bola\b|eje de simetr[ií]a|\bv[eé]rtice\b.*(?:par[aá]bola|gr[aá]fico|curva)", 13),
        (r"y\s*=\s*a\s*x\s*2|f\s*\(x\)\s*=\s*-?\d*x\s*2|\bax\s*2\s*\+\s*bx\s*\+\s*c\b", 11),
    ]),
    ("funciones-exp-log-trig", [
        (r"\bas[ií]ntota\b|funci[oóe]n exponencial|crecimiento.*exponencial|\bdecaimiento\b|poblaci[oó]n de bacterias|\bradiactiv|medicamento.*organismo", 12),
        (r"funci[oóe]n sinusoidal|\bamplitud\b|\bper[ií]odo\b.*(?:sen|cos)|\bmarea\b|\bnoria\b", 12),
        (r"\(\s*0[,\.]\d+\s*\)\s*[tx]|\be\s*[-−]?\s*0?[,\.]?\d*[tx]|\blog\s*\d?\s*\(|\bln\s*\(", 10),
        (r"dominio.*recorrido|recorrido de\s+f|\bmodeliza\b", 8),
    ]),

    # --- T3: GEOMETRÍA Y TRIGONOMETRÍA ---
    ("voronoi", [
        (r"\bvoronoi\b|diagrama de voronoi|vecino m[aá]s pr[oó]ximo|celdas? de voronoi", 16),
    ]),
    ("geometria-3d-volumen", [
        (r"\bvolumen\b|[aá]rea superficial|[aá]rea total de la superficie|[aá]rea de la superficie", 12),
        (r"\bcilindro\b|\bcono\b|\bpir[aá]mide\b|\besfera\b|\bsemiesfera\b|\bprisma\b|\bcubo\b|\bortoedro\b|medio cilindro", 11),
        (r"sector circular|longitud del arco|\barco\s+ab\b|cuerda\s+ab", 11),
        (r"\(\s*-?\d+\s*[,;]\s*-?\d+\s*[,;]\s*-?\d+\s*\)", 11),  # 3D coordinates (x, y, z)
    ]),
    ("trigonometria", [
        (r"[aá]ngulo de elevaci[oó]n|[aá]ngulo de depresi[oó]n|teorema del seno|teorema del coseno|\brumbo\b", 13),
        (r"tri[aá]ngulo\s+abc|tri[aá]ngulo\s+pqr|tri[aá]ngulo\s+rect[aá]ngulo|trigonometr|\bhipotenusa\b", 11),
        (r"\bparalelogramo\b|cuadril[aá]tero|per[ií]metro.*tri[aá]ngulo|helic[oó]ptero|azotea.*edificio", 9),
    ]),
]


def extract_clean_title(chunk: str, subtopics: list, q_num: int) -> str:
    cleaned = clean_boilerplate(chunk)
    cleaned = re.sub(rf"^\s*(?:[\-–—|=~•·*]{{1,3}}\s*|[a-zA-Z=]{{1,2}}\s+)?{q_num}\s*[\.\):]?\s*", "", cleaned).strip()
    one_line = re.sub(r"\s+", " ", cleaned).strip()
    cut = re.split(r"\(\s*a\s*\)|\[\s*\d+\s*(?:puntos?)?\s*\]", one_line, maxsplit=1)[0].strip()
    if len(cut) < 18:
        cut = one_line
    cut = re.sub(r"^(?:En esta pregunta[^.]*\.\s*)", "", cut, flags=re.I).strip()
    cut = re.sub(r"[\s,;:\-–|]+$", "", cut)
    if len(cut) > 96:
        cut = cut[:93].rsplit(" ", 1)[0] + "…"
    if len(cut) < 12:
        labels = [next((s["label"] for s in SUBTOPICS if s["id"] == st), st) for st in subtopics]
        return " · ".join(labels) if labels else f"Ejercicio {q_num}"
    return cut


def classify_question(chunk: str, exam_meta: dict, q_num: int):
    t = norm(strip_watermarks(chunk))
    scores = Counter()
    for st_id, patterns in RULES:
        for pat, weight in patterns:
            if re.search(pat, t):
                scores[st_id] += weight

    subj = exam_meta["subject"]
    is_no_calc = not exam_meta.get("calculator", True)

    # Disambiguations
    if scores["hipotesis-chi-t"] >= 11 and scores["estadistica-desc"] > 0:
        scores["hipotesis-chi-t"] += 4
    if scores["derivadas-optimizacion"] >= 12 and scores["finanzas"] > 0:
        # e.g. profit/cost optimization via derivative -> primary is derivadas!
        scores["derivadas-optimizacion"] += 6
    if scores["progresiones"] >= 11 and scores["finanzas"] > 0 and "interes" not in t and "cambio" not in t:
        scores["progresiones"] += 5
    if scores["probabilidad-venn"] >= 10 and "racionales" not in t:
        scores["notacion-errores"] = max(0, scores["notacion-errores"] - 8)
    if scores["funciones-exp-log-trig"] >= 10 and "interes" not in t and "banco" not in t and "cambio" not in t:
        scores["finanzas"] = max(0, scores["finanzas"] - 6)

    # Logic (OUT of MAI 2026)
    if scores["logica-proposicional"] >= 12:
        return {
            "topic": "OUT",
            "subtopics": ["logica-proposicional"],
            "mai2026": "out",
            "outReason": "Lógica proposicional / tablas de verdad (eliminada del currículo MAI NM 2026)"
        }

    # Limits / Advanced MAA calculus or analytical MAA algebra
    out_best = max(scores["limites-calculo-avanzado"], scores["algebra-trig-maa"])
    in_scores = {k: v for k, v in scores.items() if SUBTOPIC_TO_TOPIC[k] != "OUT" and v > 0}
    in_best = max(in_scores.values(), default=0)

    if out_best >= 10 and out_best >= in_best:
        out_id = "limites-calculo-avanzado" if scores["limites-calculo-avanzado"] >= scores["algebra-trig-maa"] else "algebra-trig-maa"
        reason = (
            "Límites o integración/cálculo analítico propio de MAA (no entra en MAI NM 2026)"
            if out_id == "limites-calculo-avanzado"
            else "Álgebra/trigonometría analítica o vectores propios de MAA (fuera de MAI NM 2026)"
        )
        subs = [out_id]
        if in_best >= 10:
            subs.append(max(in_scores, key=in_scores.get))
        return {"topic": "OUT", "subtopics": subs, "mai2026": "out", "outReason": reason}

    ranked_in = sorted(in_scores.items(), key=lambda kv: -kv[1])
    if ranked_in:
        top1, sc1 = ranked_in[0]
        picked = [top1]
        if len(ranked_in) > 1 and ranked_in[1][1] >= max(10, sc1 * 0.72):
            picked.append(ranked_in[1][0])
        topic = SUBTOPIC_TO_TOPIC[top1]
        if is_no_calc and subj == "Matemáticas NM":
            return {
                "topic": topic,
                "subtopics": picked,
                "mai2026": "out",
                "outReason": "Prueba 1 de Matemáticas NM sin calculadora (temario MAA; útil solo como reto extra)"
            }
        return {"topic": topic, "subtopics": picked, "mai2026": "in", "outReason": None}

    fallback_checks = [
        (r"f\s*\(x\)|y\s*=|grafic|curva", "funciones-cuadraticas"),
        (r"triangul|angul|metros|\bcm\b|\bkm\b|lado", "trigonometria"),
        (r"alum|person|estudiant|encuest|nota|edad|peso|altura", "estadistica-desc"),
        (r"preci|cost|venta|pag|diner", "finanzas"),
        (r"termino|secuenc|serie|fila", "progresiones"),
    ]
    for pat, st_id in fallback_checks:
        if re.search(pat, t):
            return {
                "topic": SUBTOPIC_TO_TOPIC[st_id],
                "subtopics": [st_id],
                "mai2026": "out" if (is_no_calc and subj == "Matemáticas NM") else "in",
                "outReason": "Prueba 1 de Matemáticas NM sin calculadora (temario MAA)" if (is_no_calc and subj == "Matemáticas NM") else None
            }

    return {
        "topic": "T2",
        "subtopics": ["funciones-cuadraticas"],
        "mai2026": "out" if (is_no_calc and subj == "Matemáticas NM") else "in",
        "outReason": "Prueba 1 de Matemáticas NM sin calculadora" if (is_no_calc and subj == "Matemáticas NM") else None
    }


def optimal_min(q_marks: float, exam_max: float, year: int, paper: int, subject: str) -> float:
    if subject == "Estudios NM" and year <= 2004:
        dur = 60 if (paper == 1 and year <= 2002) else (120 if paper == 2 else 90)
    else:
        dur = 90
    mins = (q_marks / exam_max) * dur
    return max(2.0, round(mins * 2) / 2)


def main():
    seed = json.load(open(SEED_PATH))
    exams = seed["EXAMS"]
    catalog = {}
    summary_counts = Counter()
    mai_counts = Counter()
    empty_chunks = 0

    for exam in exams:
        eid = exam["id"]
        txt_path = os.path.join(TXT_DIR, f"{eid}.txt")
        raw = open(txt_path, encoding="utf-8").read()
        n_q = exam["defaultQuestions"]
        chunks = split_questions(raw, n_q, eid, exam["paper"])
        q_marks_arr = exam.get("questionMarks") or [6] * n_q

        ex_list = []
        for q in range(1, n_q + 1):
            ch = chunks.get(q, "")
            if len(ch.strip()) < 25:
                empty_chunks += 1
            cls = classify_question(ch, exam, q)
            qm = q_marks_arr[q - 1] if q - 1 < len(q_marks_arr) else (6 if exam["paper"] == 1 else 15)
            opt_m = optimal_min(qm, exam["maxMarks"], exam["year"], exam["paper"], exam["subject"])
            title = extract_clean_title(ch, cls["subtopics"], q)

            ex_list.append({
                "q": q,
                "marks": qm,
                "optimalMin": opt_m,
                "topic": cls["topic"],
                "subtopics": cls["subtopics"],
                "mai2026": cls["mai2026"],
                "outReason": cls["outReason"],
                "title": title,
            })
            summary_counts[cls["subtopics"][0]] += 1
            mai_counts[cls["mai2026"]] += 1

        catalog[eid] = ex_list

    # Guide TI-84 Plus (16 problems)
    guide_raw = open(os.path.join(TXT_DIR, "guia-funciones-derivadas.txt"), encoding="utf-8").read()
    guide_chunks = split_questions(guide_raw, 16, "guia-funciones-derivadas", 1)
    guide_meta = {"subject": "Guía TI-84", "calculator": True, "year": 2021, "paper": 1, "maxMarks": 96}
    guide_list = []
    for q in range(1, 17):
        ch = guide_chunks.get(q, "")
        cls = classify_question(ch, guide_meta, q)
        if q in (3, 14):
            cls = {"topic": "OUT", "subtopics": ["limites-calculo-avanzado"], "mai2026": "out", "outReason": "Integración analítica / por partes (MAA, no entra en MAI NM 2026)"}
        elif q == 8:
            cls = {"topic": "OUT", "subtopics": ["algebra-trig-maa"], "mai2026": "out", "outReason": "Identidad trigonométrica cos(2x) (MAA, no entra en MAI NM 2026)"}
        elif q == 13:
            cls = {"topic": "OUT", "subtopics": ["algebra-trig-maa"], "mai2026": "out", "outReason": "Teorema del resto polinómico (MAA, no entra en MAI NM 2026)"}
        elif q == 10:
            cls = {"topic": "OUT", "subtopics": ["algebra-trig-maa"], "mai2026": "out", "outReason": "Composición de funciones f∘g⁻¹ (MAA, no entra en MAI NM 2026)"}
        elif q == 16:
            cls = {"topic": "T5", "subtopics": ["integrales-trapecio", "derivadas-optimizacion"], "mai2026": "in", "outReason": None}
        title = extract_clean_title(ch, cls["subtopics"], q)
        guide_list.append({
            "q": q,
            "marks": 6,
            "optimalMin": 6.0,
            "topic": cls["topic"],
            "subtopics": cls["subtopics"],
            "mai2026": cls["mai2026"],
            "outReason": cls["outReason"],
            "title": title,
        })
        summary_counts[cls["subtopics"][0]] += 1
        mai_counts[cls["mai2026"]] += 1

    catalog["guia-funciones-derivadas"] = guide_list

    total_ex = sum(len(v) for v in catalog.values())
    print(f"Classified {total_ex} exercises across {len(catalog)} documents (empty/weak chunks: {empty_chunks})")
    print("MAI 2026 relevance:", dict(mai_counts))
    print("\nBreakdown by primary subtopic:")
    for st in SUBTOPICS:
        print(f"  {st['topic']:3s} | {st['id']:25s} | {summary_counts[st['id']]:3d} | {st['label']}")

    for sample_id in ["2021-05-mai-p1", "2021-05-mai-p2", "2018-05-estudios-p1", "2015-05-estudios-p1"]:
        print(f"\n=== SPOT CHECK: {sample_id} ===")
        for item in catalog[sample_id]:
            flag = "IN " if item["mai2026"] == "in" else "OUT"
            print(f"  Q{item['q']:2d} [{flag}] {item['topic']:3s} {','.join(item['subtopics']):32s} ({item['marks']:2d}p, {item['optimalMin']:4.1f}m) | {item['title'][:65]}")

    js_out = (
        "// Catálogo completo clasificado de los 609 ejercicios IB (59 exámenes) + 16 problemas de la guía TI-84.\n"
        "// Generado por scripts/classify_exercises.py según el currículo oficial IB MAI NM 2026.\n\n"
        f"export const SUBTOPICS = {json.dumps(SUBTOPICS, indent=2, ensure_ascii=False)};\n\n"
        "export const SUBTOPIC_MAP = Object.fromEntries(SUBTOPICS.map((s) => [s.id, s]));\n\n"
        f"export const EXERCISE_CATALOG = {json.dumps(catalog, separators=(',', ':'), ensure_ascii=False)};\n"
    )
    with open(OUT_JS, "w", encoding="utf-8") as f:
        f.write(js_out)
    print(f"\nWrote {OUT_JS} ({len(js_out):,} bytes)")


if __name__ == "__main__":
    main()

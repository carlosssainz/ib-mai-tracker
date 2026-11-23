# Cuaderno IB · MAI NM (Edición 2026)

Plataforma web compartida profesor–alumno para preparar **IB Matemáticas: Aplicaciones e Interpretación — Nivel Medio (MAI NM)** con los exámenes de Google Drive.

🔗 **Web online (GitHub Pages):** https://carlosssainz.github.io/ib-mai-tracker/  
📁 **Carpeta de exámenes en Google Drive:** [EXÁMENES EST MATEMATICOS](https://drive.google.com/drive/folders/1Ht5efqUbbUgAKdLeCtuGRvZSZUtb0M5A)

## Novedades clave (v2)

- **Sincronización en tiempo real (< 1 s) vía Firebase Realtime Database**: lo que escriba tu alumno y lo que registres tú se actualiza al instante en ambos navegadores, con **Modo Profesor / Modo Alumno**, trazabilidad de autoría (`Prof.` / `Alumno`), bloqueo opcional de enlaces a Soluciones durante simulacros y botón **Copiar enlace listo para mi alumno**.
- **625 ejercicios clasificados según MAI NM 2026** (609 de los 59 exámenes + 16 de la guía TI-84 Plus, incluyendo OCR de los 16 exámenes escaneados):
  - Pestaña **Por Temas** para filtrar por bloque (`T1–T5`), subtema concreto (`Derivadas`, `Probabilidad y Venn`, `Normal`, `Chi-cuadrado`, `Rectas`, `Finanzas`…), estado del temario actual del alumno (`Ya visto` / `Parcial` / `Próximo`) y ocultar en 1 clic lo que **no entra en MAI NM 2026** (lógica proposicional, límites, cálculo analítico MAA).
- **Calificación intuitiva 1–10 → Nota IB real (1–7)** + **Selector de fallos típicos IB**:
  - Puntúa cada ejercicio del 0 al 10 y la app lo pondera automáticamente al peso oficial IB de la pregunta y calcula la Nota IB real (con 3 presets de curvas IB 2025–2026 editables).
  - 8 chips de fallos típicos IB (`3 c.s.`, `Arrastre FT`, `Sin proceso`, `Fallo GDC`, `Contexto/Unid.`, etc.) con sugerencia de nota según criterios de examinador IB y panel **Top Fallos IB**.
- **Contadores regresivos editables**: Simulacro del colegio (`21–22 Dic 2026`) y Examen Oficial IB MAI NM (`13–14 May 2027`).
- **Temporizador con tiempo óptimo por ejercicio** (`1,125 min/pt` en MAI 2021 y `1,0 min/pt` en Estudios NM) y modo **Simulacro 90 min** con aviso y registro de tiempo real.
- **Diseño inspirado en los menús de GTA VI**: tema oscuro sobrio **Leonida Night** por defecto + modo claro **Vice Daylight** en 1 clic, más chuleta rápida **GDC (TI-84 / Casio)**.

## Verificación local

```bash
node tests/verify.mjs
```

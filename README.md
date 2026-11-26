# Cuaderno IB · MAI NM (Edición 2026)

Plataforma web compartida profesor–alumno para preparar **IB Matemáticas: Aplicaciones e Interpretación — Nivel Medio (MAI NM)** con los exámenes de Google Drive.

🔗 **Web online (GitHub Pages):** https://carlosssainz.github.io/ib-mai-tracker/  
📁 **Carpeta de exámenes en Google Drive:** [EXÁMENES EST MATEMATICOS](https://drive.google.com/drive/folders/1Ht5efqUbbUgAKdLeCtuGRvZSZUtb0M5A)

## Características principales

- **Sincronización gratuita con tu Google Drive + Google Apps Script (sin cuentas nuevas)**:
  - Backend incluido en [`apps-script/Code.gs`](./apps-script/Code.gs): guarda los datos en una carpeta privada de tu Mi unidad (`Cuaderno_IB_MAI_Sync_Privado`, totalmente fuera de `EXÁMENES EST MATEMATICOS`), usa `LockService` + fusión granular para no pisarse cambios y `CacheService` para respuestas rápidas, con `POST text/plain` para evitar errores CORS.
  - Polling inteligente adaptable (se acelera tras cambios, se relaja en inactividad y se pausa al cambiar de pestaña), botón **Sincronizar ahora**, **asistente de 4 pasos** con copia del script en 1 clic, **Modo Profesor / Modo Alumno** y botón **Copiar enlace listo para mi alumno**.
- **625 ejercicios clasificados según MAI NM 2026** (609 de los 59 exámenes + 16 de la guía TI-84 Plus, incluyendo OCR de los 16 exámenes escaneados):
  - Pestaña **Por Temas** para filtrar por bloque (`T1–T5`), subtema concreto (`Derivadas`, `Probabilidad y Venn`, `Normal`, `Chi-cuadrado`, `Rectas`, `Finanzas`…), estado del temario actual del alumno (`Ya visto` / `Parcial` / `Próximo`) y ocultar en 1 clic lo que **no entra en MAI NM 2026**.
- **Calificación intuitiva 1–10 → Nota IB real (1–7)** + **Selector de fallos típicos IB**:
  - Puntúa cada ejercicio del 0 al 10 y la app lo pondera automáticamente al peso oficial IB de la pregunta y calcula la Nota IB real (con 3 presets de curvas IB 2025–2026 editables).
  - Panel de fallos típicos IB desplegable bajo demanda (`3 c.s.`, `Arrastre FT`, `Sin proceso`, `Fallo GDC`, `Contexto/Unid.`, etc.) con sugerencia de nota según criterios de examinador IB y análisis **Top Fallos IB**.
- **Contadores regresivos editables**: Simulacro del colegio (`21–22 Dic 2026`) y Examen Oficial IB MAI NM (`13–14 May 2027`).
- **Temporizador con tiempo óptimo por ejercicio** y modo **Simulacro 90 min** con aviso y registro de tiempo real.
- **Diseño limpio y espacioso**: tema oscuro sobrio **Leonida Night** por defecto + modo claro **Vice Daylight** en 1 clic, barra superior despejada y chuleta rápida **GDC (TI-84 / Casio)**.

## Verificación local

```bash
node tests/verify.mjs
```

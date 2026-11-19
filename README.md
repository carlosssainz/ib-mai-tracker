# Cuaderno IB · MAI NM

Aplicación web ligera de seguimiento para **IB Matemáticas: Aplicaciones e Interpretación — Nivel Medio (MAI NM)**.

🔗 **Aplicación online (GitHub Pages):** https://carlosssainz.github.io/ib-mai-tracker/  
📁 **Carpeta de exámenes en Google Drive:** [EXÁMENES EST MATEMATICOS](https://drive.google.com/drive/folders/1Ht5efqUbbUgAKdLeCtuGRvZSZUtb0M5A)

## Funcionalidades principales

- **Catálogo de 59 exámenes IB + guía TI-84 Plus**, espejo exacto de las carpetas de Google Drive (`01 - MAI NM 2021`, `02 - Con Soluciones 2015–2018`, `03 - Solo Enunciados 2000–2016`, `04 - Retos y Apuntes`), con acceso en 1 clic a cada **Enunciado** y **Solución**.
- **Registro dual (global + por ejercicio)**:
  - Puntuación global con cálculo automático de `%` y **Nota IB (1–7)** (umbrales editables) o selección directa de Nota IB.
  - Desglose pregunta por pregunta (`Ej. 1..N`) con las puntuaciones máximas oficiales IB pre-cargadas, estado (`Bien`, `Con ayuda / Repasar`, `Fallado / Duda`), tema oficial MAI (`T1–T5`), nota individual y suma automática al total.
  - Historial de múltiples intentos por examen.
- **Historial y progreso**:
  - Gráfico de evolución de resultados (`%` y Nota IB 1–7).
  - Barras de dominio por **Tema MAI NM (T1–T5)**.
  - **Cola de repaso automática** con todos los ejercicios marcados con duda o ayuda.
  - **Línea de tiempo cronológica** de sesiones y ejercicios practicados.
- **Notas y repaso**:
  - Diario de clases, errores frecuentes, trucos de calculadora GDC, fórmulas clave y deberes, con fijado (`📌`), estado *Por repasar / Repasado* y recopilación automática de todas las notas escritas dentro de exámenes y ejercicios.
- **Privacidad y copias de seguridad**:
  - Ningún resultado ni nota del alumno se sube a GitHub: todo se guarda localmente en tu navegador (`localStorage`).
  - Incluye **Exportar / Importar copia `.json`** (fusión o reemplazo), **Exportar `.csv`** e **Informe imprimible / PDF**.

## Verificación local

```bash
node tests/verify.mjs
```

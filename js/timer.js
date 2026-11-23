// Temporizador con tiempo óptimo por ejercicio y modo Simulacro 90 min.
// Soporta pausa, exceso de tiempo (+MM:SS), sonido opcional Web Audio y guardado de tiempo real.

export class PracticeTimer {
  constructor(onTick, onComplete) {
    this.onTick = onTick;
    this.onComplete = onComplete;
    this.active = false;
    this.running = false;
    this.muted = false;
    this.intervalId = null;
    this.meta = null;        // { mode: "exercise"|"exam", examId, qNum, label }
    this.optimalSec = 360;
    this.elapsedSec = 0;
    this.lastStamp = null;
    this.chimePlayed = false;
  }

  start({ mode = "exercise", examId, qNum = null, label = "Ejercicio", optimalSec = 360, initialElapsedSec = 0 }) {
    this.stopInternal();
    this.meta = { mode, examId, qNum, label };
    this.optimalSec = Math.max(60, Math.round(optimalSec));
    this.elapsedSec = Math.max(0, Math.round(initialElapsedSec || 0));
    this.active = true;
    this.running = true;
    this.chimePlayed = this.elapsedSec >= this.optimalSec;
    this.lastStamp = Date.now();
    this.intervalId = setInterval(() => this.tick(), 500);
    this.emit();
  }

  pause() {
    if (!this.active || !this.running) return;
    this.syncElapsed();
    this.running = false;
    this.stopInternal();
    this.emit();
  }

  resume() {
    if (!this.active || this.running) return;
    this.running = true;
    this.lastStamp = Date.now();
    this.intervalId = setInterval(() => this.tick(), 500);
    this.emit();
  }

  toggle() {
    if (this.running) this.pause();
    else this.resume();
  }

  reset() {
    if (!this.active) return;
    this.elapsedSec = 0;
    this.chimePlayed = false;
    this.lastStamp = Date.now();
    this.emit();
  }

  toggleMute() {
    this.muted = !this.muted;
    this.emit();
  }

  finish() {
    if (!this.active) return null;
    this.syncElapsed();
    const result = {
      ...this.meta,
      optimalSec: this.optimalSec,
      elapsedSec: Math.round(this.elapsedSec)
    };
    this.close();
    return result;
  }

  close() {
    this.stopInternal();
    this.active = false;
    this.running = false;
    this.meta = null;
    this.elapsedSec = 0;
    this.chimePlayed = false;
    this.emit();
  }

  syncElapsed() {
    if (!this.running || !this.lastStamp) return;
    const now = Date.now();
    const delta = (now - this.lastStamp) / 1000;
    if (delta > 0) this.elapsedSec += delta;
    this.lastStamp = now;
  }

  tick() {
    this.syncElapsed();
    if (!this.chimePlayed && this.elapsedSec >= this.optimalSec) {
      this.chimePlayed = true;
      if (!this.muted) this.playChime();
      if (this.onComplete) this.onComplete(this.getSnapshot());
    }
    this.emit();
  }

  getSnapshot() {
    const elapsed = Math.round(this.elapsedSec);
    const remaining = this.optimalSec - elapsed;
    const overtime = remaining < 0 ? Math.abs(remaining) : 0;
    const ratio = this.optimalSec > 0 ? Math.min(1, elapsed / this.optimalSec) : 0;
    const phase = overtime > 0 ? "overtime" : ratio >= 0.8 ? "warning" : "ok";
    return {
      active: this.active,
      running: this.running,
      muted: this.muted,
      meta: this.meta,
      optimalSec: this.optimalSec,
      elapsedSec: elapsed,
      remainingSec: Math.max(0, remaining),
      overtimeSec: overtime,
      ratio,
      phase
    };
  }

  emit() {
    if (this.onTick) this.onTick(this.getSnapshot());
  }

  stopInternal() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  playChime() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      [523.25, 659.25, 783.99].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.08, ctx.currentTime + i * 0.14);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.14 + 0.35);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + i * 0.14);
        osc.stop(ctx.currentTime + i * 0.14 + 0.36);
      });
    } catch {
      // Ignorar si el navegador bloquea autoplay de audio
    }
  }
}

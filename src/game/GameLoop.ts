/** requestAnimationFrame loop with clamped delta time. Start/stop are idempotent. */
export class GameLoop {
  private handle = 0;
  private last = 0;
  private running = false;
  time = 0;

  constructor(private tick: (dt: number, time: number) => void) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const frame = (now: number) => {
      if (!this.running) return;
      // Clamp so a long stall (tab switch, GC) never explodes the simulation.
      const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
      this.last = now;
      this.time += dt;
      this.tick(dt, this.time);
      this.handle = requestAnimationFrame(frame);
    };
    this.handle = requestAnimationFrame(frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.handle);
  }

  get isRunning(): boolean {
    return this.running;
  }
}

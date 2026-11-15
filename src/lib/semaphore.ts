/**
 * Minimal FIFO semaphore used to cap concurrent upstream calls.
 *
 * A released slot is transferred directly to the next waiter so the active
 * count never exceeds `max`.
 */
export class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly max: number) {
    if (!Number.isInteger(max) || max < 1) {
      throw new Error("Semaphore max must be a positive integer");
    }
  }

  get pending(): number {
    return this.waiters.length;
  }

  get inFlight(): number {
    return this.active;
  }

  async acquire(): Promise<() => void> {
    if (this.active < this.max) {
      this.active += 1;
      return this.release;
    }

    await new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });

    // The releasing caller already reserved this slot for us.
    return this.release;
  }

  private readonly release = (): void => {
    const next = this.waiters.shift();
    if (next) {
      next();
      return;
    }
    this.active = Math.max(0, this.active - 1);
  };
}

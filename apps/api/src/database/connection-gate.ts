import { AsyncLocalStorage } from 'node:async_hooks';

const BUSY_POLL_MS = 10;

export class ConnectionGateTimeoutError extends Error {
  constructor() {
    super('A transaction held the database connection for too long');
  }
}

/**
 * Lets one transaction at a time use TypeORM's single better-sqlite3 connection, whose driver would otherwise nest
 * another request's transaction inside the open one as a savepoint. A transaction holds the gate from BEGIN to COMMIT
 * or ROLLBACK, and only the async context it runs in may query meanwhile. Any other context waits for the release, so
 * its queries never land inside, or roll back with, another request's transaction.
 */
export class ConnectionGate {
  private readonly owners = new AsyncLocalStorage<symbol>();
  private owner: symbol | null = null;
  private passingQueries = 0;
  private waiters: (() => void)[] = [];

  /** Inside the owner's own transaction, `work` runs at once and TypeORM nests it as a savepoint. */
  async transaction<T>(work: () => Promise<T>): Promise<T> {
    if (this.isOwner()) {
      return work();
    }

    const owner = Symbol('transaction');
    await this.acquire(owner);

    try {
      return await this.owners.run(owner, work);
    } finally {
      this.release(owner);
    }
  }

  /**
   * Takes the gate for a transaction begun on the query runner itself, and returns its release. Makes the calling
   * async context, synchronous callers included, the owner: call it from the context that runs the transaction.
   */
  async hold(): Promise<() => void> {
    const owner = Symbol('runner transaction');
    this.owners.enterWith(owner);

    await this.acquire(owner);

    return () => this.release(owner);
  }

  async query<T>(run: () => Promise<T>): Promise<T> {
    while (this.owner !== null && !this.isOwner()) {
      await this.nextChange();
    }

    if (this.isOwner()) {
      return run();
    }

    this.passingQueries += 1;

    try {
      return await run();
    } finally {
      this.passingQueries -= 1;

      if (this.passingQueries === 0) {
        this.notify();
      }
    }
  }

  /**
   * `work` must be synchronous: it takes no hold, so nothing may run between the check and its end. It also waits
   * while `connectionBusy` reports a transaction that skipped the gate.
   */
  async runSync<T>(work: () => T, timeoutMs: number, connectionBusy: () => boolean = () => false): Promise<T> {
    const deadline = Date.now() + timeoutMs;

    while (!this.isOwner() && (this.owner !== null || connectionBusy())) {
      const remainingMs = deadline - Date.now();

      if (remainingMs <= 0) {
        throw new ConnectionGateTimeoutError();
      }

      // Nothing announces the end of a transaction that skipped the gate, so poll for it.
      await this.nextChange(this.owner === null ? Math.min(remainingMs, BUSY_POLL_MS) : remainingMs);
    }

    return work();
  }

  isOwner(): boolean {
    return this.owner !== null && this.owners.getStore() === this.owner;
  }

  private async acquire(owner: symbol): Promise<void> {
    // A query that passed before the gate closed still has to run, or it would run inside this transaction.
    while (this.owner !== null || this.passingQueries > 0) {
      await this.nextChange();
    }

    this.owner = owner;
  }

  private release(owner: symbol): void {
    if (this.owner === owner) {
      this.owner = null;
      this.notify();
    }
  }

  private nextChange(timeoutMs?: number): Promise<void> {
    return new Promise(resolve => {
      const timer = timeoutMs === undefined ? undefined : setTimeout(resolve, timeoutMs);

      this.waiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  private notify(): void {
    const waiters = this.waiters;
    this.waiters = [];

    for (const wake of waiters) {
      wake();
    }
  }
}

export const connectionGate = new ConnectionGate();

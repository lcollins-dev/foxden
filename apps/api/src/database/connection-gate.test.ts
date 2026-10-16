import { setImmediate as nextMacrotask } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';

import { ConnectionGate, ConnectionGateTimeoutError } from './connection-gate';

describe('ConnectionGate', () => {
  it('runs one transaction at a time', async () => {
    const gate = new ConnectionGate();
    const first = Promise.withResolvers<undefined>();
    const events: string[] = [];

    const firstDone = gate.transaction(async () => {
      events.push('first begins');
      await first.promise;
      events.push('first ends');
    });

    const secondDone = gate.transaction(() => {
      events.push('second begins');

      return Promise.resolve();
    });

    await nextMacrotask();
    expect(events).toEqual(['first begins']);

    first.resolve(undefined);
    await Promise.all([firstDone, secondDone]);

    expect(events).toEqual(['first begins', 'first ends', 'second begins']);
  });

  it("holds another context's query until the transaction ends, and passes the owner's", async () => {
    const gate = new ConnectionGate();
    const release = Promise.withResolvers<undefined>();
    const events: string[] = [];

    const transactionDone = gate.transaction(async () => {
      await gate.query(() => {
        events.push('owner query');

        return Promise.resolve();
      });

      await release.promise;
      events.push('commit');
    });

    await nextMacrotask();

    const otherDone = gate.query(() => {
      events.push('other query');

      return Promise.resolve();
    });

    await nextMacrotask();
    expect(events).toEqual(['owner query']);

    release.resolve(undefined);
    await Promise.all([transactionDone, otherDone]);

    expect(events).toEqual(['owner query', 'commit', 'other query']);
  });

  it('starts a transaction only once the queries already past the gate finish', async () => {
    const gate = new ConnectionGate();
    const query = Promise.withResolvers<undefined>();
    const events: string[] = [];

    const queryDone = gate.query(async () => {
      await query.promise;
      events.push('query');
    });

    const transactionDone = gate.transaction(() => {
      events.push('transaction');

      return Promise.resolve();
    });

    await nextMacrotask();
    expect(events).toEqual([]);

    query.resolve(undefined);
    await Promise.all([queryDone, transactionDone]);

    expect(events).toEqual(['query', 'transaction']);
  });

  it("runs the owner's nested transaction at once", async () => {
    const gate = new ConnectionGate();

    const result = await gate.transaction(() => gate.transaction(() => Promise.resolve('nested')));

    expect(result).toBe('nested');
  });

  it('releases the gate when a transaction fails', async () => {
    const gate = new ConnectionGate();

    await expect(gate.transaction(() => Promise.reject(new Error('rolled back')))).rejects.toThrow('rolled back');

    await expect(gate.query(() => Promise.resolve('after'))).resolves.toBe('after');
  });

  it("treats a context left over from a finished transaction as another context's", async () => {
    const gate = new ConnectionGate();
    const second = Promise.withResolvers<undefined>();
    let leftover: Promise<string> | undefined;
    const events: string[] = [];

    await gate.transaction(() => {
      leftover = (async () => {
        await nextMacrotask();

        return gate.query(() => {
          events.push('leftover query');

          return Promise.resolve('leftover');
        });
      })();

      return Promise.resolve();
    });

    const secondDone = gate.transaction(async () => {
      await second.promise;
      events.push('second commits');
    });

    await nextMacrotask();
    await nextMacrotask();
    second.resolve(undefined);
    await secondDone;

    expect(await leftover).toBe('leftover');
    expect(events).toEqual(['second commits', 'leftover query']);
  });

  describe('hold', () => {
    it('lets the holding context query and holds every other context back until the release', async () => {
      const gate = new ConnectionGate();
      const release = Promise.withResolvers<undefined>();
      const events: string[] = [];

      const holderDone = (async () => {
        await nextMacrotask();
        const releaseHold = await gate.hold();

        await gate.query(() => {
          events.push('holder query');

          return Promise.resolve();
        });

        await release.promise;
        events.push('release');
        releaseHold();
      })();

      await nextMacrotask();
      await nextMacrotask();

      const otherDone = gate.query(() => {
        events.push('other query');

        return Promise.resolve();
      });

      await nextMacrotask();
      expect(events).toEqual(['holder query']);

      release.resolve(undefined);
      await Promise.all([holderDone, otherDone]);

      expect(events).toEqual(['holder query', 'release', 'other query']);
    });

    it("waits for another context's transaction to end", async () => {
      const gate = new ConnectionGate();
      const commit = Promise.withResolvers<undefined>();
      const events: string[] = [];

      const transactionDone = gate.transaction(async () => {
        await commit.promise;
        events.push('commit');
      });

      const holdDone = (async () => {
        await nextMacrotask();
        const releaseHold = await gate.hold();
        events.push('held');
        releaseHold();
      })();

      await nextMacrotask();
      await nextMacrotask();
      expect(events).toEqual([]);

      commit.resolve(undefined);
      await Promise.all([transactionDone, holdDone]);

      expect(events).toEqual(['commit', 'held']);
    });
  });

  describe('runSync', () => {
    it("waits for another context's transaction to end", async () => {
      const gate = new ConnectionGate();
      const release = Promise.withResolvers<undefined>();
      const events: string[] = [];

      const transactionDone = gate.transaction(async () => {
        await release.promise;
        events.push('commit');
      });

      const syncDone = gate.runSync(() => events.push('sync'), 1000);

      await nextMacrotask();
      expect(events).toEqual([]);

      release.resolve(undefined);
      await Promise.all([transactionDone, syncDone]);

      expect(events).toEqual(['commit', 'sync']);
    });

    it("runs at once inside the owner's transaction", async () => {
      const gate = new ConnectionGate();

      const result = await gate.transaction(() => gate.runSync(() => 'inside', 0));

      expect(result).toBe('inside');
    });

    it('waits while the connection is in a transaction that skipped the gate', async () => {
      const gate = new ConnectionGate();
      let connectionBusy = true;

      setTimeout(() => {
        connectionBusy = false;
      }, 30);

      const result = await gate.runSync(
        () => (connectionBusy ? 'inside' : 'after'),
        1000,
        () => connectionBusy
      );

      expect(result).toBe('after');
    });

    it('gives up once a transaction that skipped the gate outlasts the limit', async () => {
      const gate = new ConnectionGate();

      await expect(
        gate.runSync(
          () => 'late',
          30,
          () => true
        )
      ).rejects.toBeInstanceOf(ConnectionGateTimeoutError);
    });

    it('gives up once the transaction outlasts the limit', async () => {
      const gate = new ConnectionGate();
      const release = Promise.withResolvers<undefined>();

      const transactionDone = gate.transaction(() => release.promise);

      await expect(gate.runSync(() => 'late', 10)).rejects.toBeInstanceOf(ConnectionGateTimeoutError);

      release.resolve(undefined);
      await transactionDone;
    });
  });
});

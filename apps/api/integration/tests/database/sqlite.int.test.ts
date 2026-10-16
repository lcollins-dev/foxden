import { NestExpressApplication } from '@nestjs/platform-express';
import { statSync } from 'node:fs';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bootstrapApp } from '../../setup';
import { dbQuery } from '../../utils/db';

type Query = (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

interface ITableSchema {
  autoincrement: boolean;
  columns: Record<string, unknown>[];
  foreignKeys: string[];
  indexes: string[];
}

const queryOf =
  (dataSource: DataSource): Query =>
  (sql, params = []) =>
    dataSource.query(sql, params);

/** Leaves out constraint and index names, which the migrations choose and TypeORM hashes. */
const describeTable = async (query: Query, table: string): Promise<ITableSchema> => {
  const definition = await query("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?", [table]);

  const columns = await query(
    'SELECT cid, name, type, "notnull", dflt_value AS defaultValue, pk FROM pragma_table_xinfo(?) ORDER BY cid',
    [table]
  );

  const foreignKeyRows = await query(
    `SELECT id, "table", "from", "to", on_update AS onUpdate, on_delete AS onDelete, "match"
     FROM pragma_foreign_key_list(?) ORDER BY id, seq`,
    [table]
  );

  const foreignKeys = new Map<unknown, { table: unknown; from: unknown[]; to: unknown[]; actions: unknown[] }>();

  for (const row of foreignKeyRows) {
    const foreignKey = foreignKeys.get(row.id) ?? { table: row.table, from: [], to: [], actions: [] };

    foreignKey.from.push(row.from);
    foreignKey.to.push(row.to);
    foreignKey.actions = [row.onUpdate, row.onDelete, row.match];

    foreignKeys.set(row.id, foreignKey);
  }

  const indexes: string[] = [];

  for (const index of await query('SELECT name, "unique", origin, partial FROM pragma_index_list(?)', [table])) {
    const indexColumns = await query(
      'SELECT name, "desc", coll FROM pragma_index_xinfo(?) WHERE "key" = 1 ORDER BY seqno',
      [index.name]
    );

    indexes.push(JSON.stringify({ unique: index.unique, origin: index.origin, partial: index.partial, indexColumns }));
  }

  return {
    autoincrement: /\bAUTOINCREMENT\b/i.test(String(definition[0]?.sql)),
    columns,
    foreignKeys: [...foreignKeys.values()].map(foreignKey => JSON.stringify(foreignKey)).sort(),
    indexes: indexes.sort(),
  };
};

describe('SQLite connection (integration)', () => {
  let app: NestExpressApplication;
  let entitySchema: DataSource | undefined;

  beforeAll(async () => {
    app = await bootstrapApp();
  });

  afterAll(async () => {
    if (entitySchema?.isInitialized === true) {
      await entitySchema.destroy();
    }
  });

  it('runs in WAL mode', async () => {
    expect(await dbQuery(app, 'SELECT journal_mode AS mode FROM pragma_journal_mode')).toEqual([{ mode: 'wal' }]);
  });

  it('keeps the database and its WAL files readable by the server alone', () => {
    const databasePath = String(process.env.DATABASE_PATH);

    for (const path of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
      expect(statSync(path).mode & 0o777).toBe(0o600);
    }
  });

  it('enforces foreign keys', async () => {
    expect(await dbQuery(app, 'SELECT foreign_keys AS enabled FROM pragma_foreign_keys')).toEqual([{ enabled: 1 }]);

    await expect(
      dbQuery(app, 'INSERT INTO user_user_role ("userId", "userRoleId") VALUES (?, ?)', [2147483647, 1])
    ).rejects.toThrow(/FOREIGN KEY constraint failed/);
  });

  it('waits on a locked database rather than failing at once', async () => {
    expect(await dbQuery(app, 'SELECT timeout FROM pragma_busy_timeout')).toEqual([{ timeout: 5000 }]);
  });

  it('builds the schema the entities describe, apart from constraint and index names', async () => {
    const migrated = app.get(DataSource);

    entitySchema = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: migrated.options.entities,
      entitySkipConstructor: true,
      synchronize: true,
    });
    await entitySchema.initialize();

    const tables = migrated.entityMetadatas.map(metadata => metadata.tableName).sort();

    expect(tables.length).toBeGreaterThan(0);

    for (const table of tables) {
      const expected = await describeTable(queryOf(entitySchema), table);

      expect({ table, ...(await describeTable(queryOf(migrated), table)) }).toEqual({ table, ...expected });
    }
  });
});

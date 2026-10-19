import { Client } from 'pg';
import { DATABASE_URL, assertSafeDbUrl } from './config';

export class Db {
  private c: Client;
  private tables: string[] = [];
  private pks: Record<string, string[]> = {};

  constructor() {
    assertSafeDbUrl(DATABASE_URL);
    this.c = new Client({ connectionString: DATABASE_URL });
  }

  async connect(): Promise<void> {
    await this.c.connect();
    const who = await this.c.query('select current_database() as db, inet_server_port() as port');
    if (who.rows[0].db !== 'baogia_parity') throw new Error('PARITY ABORT: kết nối nhầm database ' + who.rows[0].db);
    const t = await this.c.query(
      "select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 1",
    );
    this.tables = t.rows.map((r) => r.table_name as string);
    const pk = await this.c.query(`
      select t.relname as tbl, array_agg(a.attname::text order by k.ord) as cols
      from pg_index i
      join pg_class t on t.oid = i.indrelid
      join pg_namespace n on n.oid = t.relnamespace
      join lateral unnest(i.indkey) with ordinality k(attnum, ord) on true
      join pg_attribute a on a.attrelid = t.oid and a.attnum = k.attnum
      where i.indisprimary and n.nspname = 'public'
      group by t.relname`);
    for (const r of pk.rows) this.pks[r.tbl as string] = r.cols as string[];
  }

  async end(): Promise<void> {
    await this.c.end();
  }

  query(sql: string, params?: unknown[]) {
    return this.c.query(sql, params);
  }

  tableNames(): string[] {
    return this.tables;
  }

  pkOf(table: string): string[] {
    return this.pks[table] ?? [];
  }

  async reset(): Promise<void> {
    await this.c.query(`TRUNCATE TABLE ${this.tables.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`);
  }

  async insert(table: string, rows: Record<string, unknown>[]): Promise<void> {
    for (const r of rows) {
      const cols = Object.keys(r);
      await this.c.query(
        `INSERT INTO "${table}" (${cols.map((x) => `"${x}"`).join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')})`,
        cols.map((k) => r[k]),
      );
    }
  }

  async fixSequences(): Promise<void> {
    for (const t of this.tables) {
      if (this.pkOf(t).length !== 1 || this.pkOf(t)[0] !== 'id') continue;
      await this.c.query(
        `SELECT setval(pg_get_serial_sequence('"${t}"','id'), COALESCE(MAX(id),1), MAX(id) IS NOT NULL) FROM "${t}"`,
      );
    }
  }

  /** Dump mọi bảng: row_to_json, sắp theo PK. */
  async dumpAll(): Promise<Record<string, Record<string, unknown>[]>> {
    const out: Record<string, Record<string, unknown>[]> = {};
    for (const t of this.tables) {
      const pk = this.pkOf(t);
      const order = pk.length ? ` ORDER BY ${pk.map((p) => `t."${p}"`).join(',')}` : '';
      const r = await this.c.query(`SELECT row_to_json(t) AS r FROM "${t}" t${order}`);
      out[t] = r.rows.map((x) => x.r as Record<string, unknown>);
    }
    return out;
  }
}

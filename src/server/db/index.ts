import { better } from 'better-drizzle';
import { softDelete } from 'better-drizzle/soft-delete';
import { drizzle } from 'drizzle-orm/d1';
import { resolveConfig } from '../config';
import { softDeleteGuards } from './plugins/soft-delete-guards';
import { timestamps } from './plugins/timestamps';
import * as schema from './schema';

export const createDb = (d1: D1Database) => drizzle(d1, { schema });

export type Database = ReturnType<typeof createDb>;

export const createClient = (db: Database) =>
  better(db, {
    schema,
    plugins: [timestamps(), softDelete(), softDeleteGuards()] as const,
  });

export type Client = ReturnType<typeof createClient>;

// Memoization is keyed on the D1 binding identity so vitest-pool-workers'
// per-test binding swaps never leak a client bound to torn-down storage.
let memo: { d1: D1Database; db: Database; client: Client } | undefined;

const resolve = () => {
  const d1 = resolveConfig().bindings.db;
  if (!memo || memo.d1 !== d1) {
    const db = createDb(d1);
    memo = { d1, db, client: createClient(db) };
  }
  return memo;
};

export const getDb = (): Database => resolve().db;

export const getClient = (): Client => resolve().client;

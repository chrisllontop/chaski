import { sql } from 'drizzle-orm';
import { integer } from 'drizzle-orm/sqlite-core';

// Persist every instant as Unix epoch milliseconds. Drizzle maps these INTEGER
// values to Date in application code; public boundaries serialize them as RFC
// 3339 UTC strings. The database default is a fallback for raw inserts, while
// Better Drizzle owns timestamps during normal application writes.
const epochMilliseconds = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

export const timestamp = <const TName extends string>(name: TName) =>
  integer(name, { mode: 'timestamp_ms' });

export const timestampNow = <const TName extends string>(name: TName) =>
  timestamp(name).notNull().default(epochMilliseconds);

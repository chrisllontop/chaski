import { type ChaskiBindings, type ResolvedConfig, resolveConfig } from '../config';
import { type Client, type Database, getClient, getDb } from '../db';
import { getLogger, type Logger } from '../lib/log';

// Follows the BaseService pattern in .agents/services.md:
// static methods only, the config via `Service.config` and its bindings via
// `Service.bindings`, persistence via `Service.client`.
// `db` (raw Drizzle) is the escape hatch for D1 `batch()` atomicity and
// conditional UPDATEs that must read `meta.changes` — better-drizzle does not
// cover those on D1.
// biome-ignore lint/complexity/noStaticOnlyClass: services inherit these statics by extending it
export abstract class BaseService {
  // Subclasses override to name their log lines, e.g. `[delivery]`. Overrides the
  // built-in Function.name so it stays stable under production minification.
  protected static name = 'service';

  protected static get config(): ResolvedConfig {
    return resolveConfig();
  }

  protected static get bindings(): ChaskiBindings {
    return resolveConfig().bindings;
  }

  protected static get log(): Logger {
    // `this` resolves to the calling subclass, so its overridden name wins.
    // biome-ignore lint/complexity/noThisInStatic: polymorphic name lookup
    return getLogger(this.name);
  }

  protected static get client(): Client {
    return getClient();
  }

  protected static get db(): Database {
    return getDb();
  }
}

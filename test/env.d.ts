declare namespace Cloudflare {
  interface GlobalProps {
    mainModule: typeof import('./fixture/worker');
  }
  interface Env {
    CHASKI_DB: D1Database;
    TEST_MIGRATIONS: import('cloudflare:test').D1Migration[];
  }
}

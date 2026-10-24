type FixtureEnvShape = import('./fixture/worker').FixtureEnv;

declare namespace Cloudflare {
  interface GlobalProps {
    mainModule: typeof import('./fixture/worker');
  }
  interface Env extends FixtureEnvShape {
    TEST_MIGRATIONS: import('cloudflare:test').D1Migration[];
  }
}

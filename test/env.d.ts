declare namespace Cloudflare {
  interface GlobalProps {
    mainModule: typeof import('./fixture/worker');
  }
}

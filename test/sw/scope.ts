import { handlePushEvents } from '../../src/sw';

// The browser tests run under the DOM lib with a fake scope; this file checks,
// at compile time only, that a real service worker's scope satisfies
// handlePushEvents, as it does in a host's own sw.ts.
declare const self: ServiceWorkerGlobalScope;

handlePushEvents(self);

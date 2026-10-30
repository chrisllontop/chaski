## Error handling

- **Caller errors:** services throw `ChaskiError(code, message)` (`src/contract/errors.ts`). The message says what failed in terms the caller can fix ("unknown notification type 'x': register a template for it before sending"). `isChaskiError` matches on shape, so it also works across bundle duplicates.
- **Delivery errors:** channel adapters throw `DeliveryError(errorCode, message, { permanent })`. A permanent error marks the delivery `failed`; anything else is retried with exponential backoff until the queue's last attempt, which marks it `dead`. Classify provider errors once, at the adapter, with a stable snake_case `errorCode`.
- **HTTP:** the app's `onError` turns a `ChaskiError` into `{ error, message }` with its status (see `api.md`). Anything else becomes a 500 `{ error: 'internal', message: 'internal error' }`; the details go to the console, which Workers Logs keeps, never to the response.
- **Config errors** (`config`) name the setting and the fix, and surface on the first request instead of deep inside a service.
- **Background work** (queue batches, Workflow steps, the open-tracking pixel, realtime pokes) never throws out of its handler: catch and log with the ids that locate the failure.
- **Best-effort side effects:** once the data is persisted, a failed realtime poke (dashboard events, feed hub) must never fail or retry the operation that produced it.

import { type ErrorContext, resolveConfig } from '../config';
import { logger } from './log';

// The host's hook must never turn a reported failure into a second one.
export const reportError = (error: unknown, context: ErrorContext): void => {
  let onError: ReturnType<typeof resolveConfig>['onError'];
  try {
    onError = resolveConfig().onError;
  } catch {
    return;
  }
  if (!onError) return;
  try {
    onError(error, context);
  } catch (hookError) {
    logger('chaski').error('onError hook threw', hookError, { source: context.source });
  }
};

type LogValue = string | number | boolean | null | undefined;
type LogContext = Record<string, LogValue>;
type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const emit = (level: LogLevel, prefix: string, message: string, context?: LogContext): void => {
  const attributes: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(context ?? {})) {
    if (value !== undefined && value !== null) attributes[key] = value;
  }
  console[level](`[chaski:${prefix}]`, message, attributes);
};

export const logger = (prefix: string) => ({
  debug: (message: string, context?: LogContext) => emit('debug', prefix, message, context),
  info: (message: string, context?: LogContext) => emit('info', prefix, message, context),
  warn: (message: string, context?: LogContext) => emit('warn', prefix, message, context),
  error: (message: string, error?: unknown, context?: LogContext) =>
    emit('error', prefix, message, {
      ...context,
      err: error instanceof Error ? error.message : error === undefined ? undefined : String(error),
    }),
});

export type Logger = ReturnType<typeof logger>;

const loggers = new Map<string, Logger>();
export const getLogger = (prefix: string): Logger => {
  const existing = loggers.get(prefix);
  if (existing) return existing;
  const created = logger(prefix);
  loggers.set(prefix, created);
  return created;
};

import type { z } from 'zod';
import { ChaskiError } from '../../contract/errors';

export const parseInput = <S extends z.ZodType>(schema: S, input: unknown): z.output<S> => {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const messages = parsed.error.issues.map((issue) =>
      issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message,
    );
    throw new ChaskiError('validation', messages.join('; '));
  }
  return parsed.data;
};

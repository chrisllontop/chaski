import type { z } from 'zod';
import { ChaskiError } from '../../contract/errors';

export const parseInput = <S extends z.ZodType>(schema: S, input: unknown): z.output<S> => {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new ChaskiError('validation', parsed.error.issues.map((i) => i.message).join('; '));
  }
  return parsed.data;
};

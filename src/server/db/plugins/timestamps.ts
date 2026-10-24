import { definePlugin } from 'better-drizzle';

const DEFAULT_CREATED_AT = 'createdAt';
const DEFAULT_UPDATED_AT = 'updatedAt';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const stamp = (
  data: Record<string, unknown>,
  column: string,
  value: Date,
  enabled: boolean,
): Record<string, unknown> => {
  if (!enabled) return data;
  data[column] = value;
  return data;
};

export const timestamps = (options: { createdAt?: string; updatedAt?: string } = {}) => {
  const createdAt = options.createdAt ?? DEFAULT_CREATED_AT;
  const updatedAt = options.updatedAt ?? DEFAULT_UPDATED_AT;

  return definePlugin({
    description: 'Manages createdAt/updatedAt as Date values backed by Unix epoch milliseconds.',
    id: 'chaski:timestamps',
    name: 'Timestamps',
    options,
    hooks: {
      beforeCreate(operation) {
        const hasCreatedAt = operation.model.hasColumn(createdAt);
        const hasUpdatedAt = operation.model.hasColumn(updatedAt);
        if (!hasCreatedAt && !hasUpdatedAt) return operation.data;

        const now = new Date();

        if (operation.kind === 'create') {
          if (!isRecord(operation.data)) return operation.data;
          return stamp(
            stamp({ ...operation.data }, createdAt, now, hasCreatedAt),
            updatedAt,
            now,
            hasUpdatedAt,
          );
        }

        if (operation.kind === 'createMany') {
          if (!Array.isArray(operation.data)) return operation.data;
          return operation.data.map((row) => {
            if (!isRecord(row)) return row;
            return stamp(
              stamp({ ...row }, createdAt, now, hasCreatedAt),
              updatedAt,
              now,
              hasUpdatedAt,
            );
          });
        }

        return operation.data;
      },
      beforeUpdate(operation) {
        if (!operation.model.hasColumn(updatedAt)) return operation.data;
        const now = new Date();

        if (operation.kind === 'updateEach') {
          if (!Array.isArray(operation.data)) return operation.data;
          return operation.data.map((row) => {
            if (!isRecord(row)) return row;
            return stamp({ ...row }, updatedAt, now, true);
          });
        }

        if (!isRecord(operation.data)) return operation.data;
        return stamp({ ...operation.data }, updatedAt, now, true);
      },
    },
  });
};

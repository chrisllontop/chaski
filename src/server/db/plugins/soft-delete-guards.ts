import { definePlugin } from 'better-drizzle';

const COLUMN = 'deletedAt';

const activeWhere = (where: unknown): unknown => {
  const visibilityWhere = { [COLUMN]: null };
  return where ? { AND: [where, visibilityWhere] } : visibilityWhere;
};

// better-drizzle/soft-delete covers findFirst/findMany/count/exists and
// single-row delete. Better Drizzle exposes additional delegates;
// this companion closes its default-read and bulk-delete gaps. Explicit
// visibility is provided by the official plugin on findFirst/findMany; the
// delegates below intentionally remain active-only.
export const softDeleteGuards = () =>
  definePlugin({
    description: 'Completes soft-delete coverage for every Better Drizzle delegate.',
    id: 'chaski:soft-delete-guards',
    name: 'Soft Delete Guards',
    hooks: {
      beforeDelete(operation) {
        if (operation.kind !== 'deleteMany' || !operation.model.hasColumn(COLUMN)) return;
        const now = new Date();
        return operation.client.$withoutPlugins().updateMany({
          data: {
            [COLUMN]: now,
            ...(operation.model.hasColumn('updatedAt') ? { updatedAt: now } : {}),
          },
          where: operation.where,
        });
      },
    },
    transform(operation) {
      if (!operation.model.hasColumn(COLUMN)) return operation;
      if (
        operation.kind !== 'findOne' &&
        operation.kind !== 'findUnique' &&
        operation.kind !== 'paginate'
      ) {
        return operation;
      }
      operation.where = activeWhere(operation.where) as typeof operation.where;
      return operation;
    },
  });

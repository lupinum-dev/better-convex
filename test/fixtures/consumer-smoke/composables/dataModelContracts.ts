import type { Id } from '#convex/dataModel'

/**
 * `#convex/dataModel` resolves to the app's generated `convex/_generated/dataModel`
 * in app code. A missing or untyped alias makes `check:consumer-smoke` fail on the
 * import or on the `@ts-expect-error` lines. Never invoked.
 */
function _dataModelContracts(taskId: Id<'tasks'>) {
  const sameTable: Id<'tasks'> = taskId
  // @ts-expect-error an id of one table is not an id of another
  const otherTable: Id<'files'> = taskId
  // @ts-expect-error a plain string is not a document id
  const plainString: Id<'tasks'> = 'task_1'
  return [sameTable, otherTable, plainString]
}

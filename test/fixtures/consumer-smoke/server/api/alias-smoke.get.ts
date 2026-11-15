import { defineEventHandler } from 'nuxt/server'

import { api } from '#convex/api'
import type { Id } from '#convex/dataModel'

export default defineEventHandler(() => {
  return {
    hasApi: Boolean(api.tasks.list),
  }
})

/**
 * `#convex/dataModel` also resolves in Nitro server code. Never invoked.
 */
function _serverDataModelContracts(taskId: Id<'tasks'>) {
  // @ts-expect-error an id of one table is not an id of another
  const otherTable: Id<'files'> = taskId
  return otherTable
}

import type { GenericDataModel, GenericQueryCtx } from 'convex/server'

import { assertPending, liveContinuation } from './factor-transitions'
import type { WorkforceOperation } from './operations'

/** Internal provider view only; canonical active credentials remain unchanged. */
export async function readWorkforcePendingFactor(
  ctx: GenericQueryCtx<GenericDataModel>,
  row: Record<string, unknown> | null,
  operation: WorkforceOperation | undefined,
): Promise<Record<string, unknown> | null> {
  if (operation?.operation !== 'confirm-enrollment') return row
  const live = await liveContinuation(ctx, operation)
  assertPending(row, live.session, live.operation)
  return {
    ...row,
    secret: row!.bcnPendingSecret,
    backupCodes: row!.bcnPendingBackupCodes,
    verified: false,
  }
}

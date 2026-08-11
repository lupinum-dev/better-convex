import type { ClientIdentitySnapshot } from './identity-port'

export type QueryExecutionOutcome = 'execute' | 'idle' | 'wait' | 'error'

export function decideQueryExecution(input: {
  auth: 'required' | 'optional' | 'none'
  skipped: boolean
  identity: ClientIdentitySnapshot
}): QueryExecutionOutcome {
  if (input.skipped) return 'idle'
  if (input.auth === 'none') return 'execute'
  if (!input.identity.authEnabled) return input.auth === 'required' ? 'idle' : 'execute'
  if (!input.identity.settled) return 'wait'
  if (input.identity.error) return 'error'
  if (input.identity.identityKey === 'anonymous')
    return input.auth === 'required' ? 'idle' : 'execute'
  return 'execute'
}

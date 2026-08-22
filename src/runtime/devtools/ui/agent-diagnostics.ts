import type { AuthProxyRequest } from '../types'

export interface AgentDiagnosticOutcome {
  badge: 'error' | 'pending' | 'success'
  label: 'allowed' | 'denied or failed' | 'redirected'
}

/** Classify observable proxy decisions without treating OAuth redirects as failures. */
export function agentDiagnosticOutcome(request: AuthProxyRequest): AgentDiagnosticOutcome {
  if (request.status !== undefined && request.status >= 300 && request.status < 400) {
    return { badge: 'pending', label: 'redirected' }
  }
  if (
    request.success &&
    request.status !== undefined &&
    request.status >= 200 &&
    request.status < 300
  ) {
    return { badge: 'success', label: 'allowed' }
  }
  return { badge: 'error', label: 'denied or failed' }
}

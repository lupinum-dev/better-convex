import { agentDiagnosticOutcome } from './auth-proxy-outcome'
import type { AuthProxyRequest, AuthProxyStats } from './types'

const MAX_REQUESTS = 20
// Development diagnostics only: kept in module memory, newest first. It resets
// on a dev-server reload, which is fine for a list of the last few requests.
const requests: AuthProxyRequest[] = []

export async function recordAuthProxyRequest(request: AuthProxyRequest): Promise<void> {
  // Persist only the reviewed fixed-shape fields. Development diagnostics are
  // not an escape hatch for raw Error objects or caller-added properties.
  requests.unshift({
    id: request.id,
    path: request.path,
    method: request.method,
    timestamp: request.timestamp,
    ...(request.status === undefined ? {} : { status: request.status }),
    ...(request.duration === undefined ? {} : { duration: request.duration }),
    ...(request.success === undefined ? {} : { success: request.success }),
  })
  if (requests.length > MAX_REQUESTS) {
    requests.length = MAX_REQUESTS
  }
}

export async function getAuthProxyStats(): Promise<AuthProxyStats> {
  const successful = requests.filter((r) => agentDiagnosticOutcome(r).badge === 'success')
  const durations = successful.filter((r) => r.duration !== undefined).map((r) => r.duration!)

  return {
    totalRequests: requests.length,
    successCount: successful.length,
    errorCount: requests.filter((r) => agentDiagnosticOutcome(r).badge === 'error').length,
    avgDuration:
      durations.length > 0
        ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
        : 0,
    recentRequests: [...requests],
  }
}

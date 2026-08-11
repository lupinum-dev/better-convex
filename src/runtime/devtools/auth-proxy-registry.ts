import type { AuthProxyRequest, AuthProxyStats } from './types'

const MAX_REQUESTS = 20
const STORAGE_NAMESPACE = 'devtools:convex:auth-proxy'
const STORAGE_KEY = 'requests'

async function getStorage() {
  const { useStorage } = await import('nitropack/runtime')
  return useStorage(STORAGE_NAMESPACE)
}

async function getRequests(): Promise<AuthProxyRequest[]> {
  const storage = await getStorage()
  const requests = await storage.getItem<AuthProxyRequest[]>(STORAGE_KEY)
  return Array.isArray(requests) ? requests : []
}

async function setRequests(requests: AuthProxyRequest[]): Promise<void> {
  const storage = await getStorage()
  await storage.setItem(STORAGE_KEY, requests)
}

export async function recordAuthProxyRequest(request: AuthProxyRequest): Promise<void> {
  const requests = await getRequests()
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
  await setRequests(requests)
}

export async function getAuthProxyStats(): Promise<AuthProxyStats> {
  const requests = await getRequests()
  const successful = requests.filter((r) => r.success)
  const durations = successful.filter((r) => r.duration !== undefined).map((r) => r.duration!)

  return {
    totalRequests: requests.length,
    successCount: successful.length,
    errorCount: requests.filter((r) => !r.success).length,
    avgDuration:
      durations.length > 0
        ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
        : 0,
    recentRequests: [...requests],
  }
}

export async function clearAuthProxyStats(): Promise<void> {
  await setRequests([])
}

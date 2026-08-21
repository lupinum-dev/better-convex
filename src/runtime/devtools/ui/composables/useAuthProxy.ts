import { ref, onMounted } from 'vue'

import type { AuthProxyStats } from '../../types'

/**
 * Composable for fetching auth proxy stats from the DevTools server endpoint.
 * The auth proxy runs on the Nitro server, so diagnostics refresh only on
 * panel activation or an explicit user request.
 */
export function useAuthProxy() {
  const proxyStats = ref<AuthProxyStats | null>(null)
  const pending = ref(false)
  const error = ref<string | null>(null)

  async function fetchProxyStats() {
    try {
      pending.value = true
      error.value = null

      const response = await fetch('/__convex_devtools__/proxy-stats')
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const stats = (await response.json()) as AuthProxyStats
      proxyStats.value = stats
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to fetch proxy stats'
    } finally {
      pending.value = false
    }
  }

  onMounted(async () => {
    await fetchProxyStats()
  })

  return {
    proxyStats,
    pending,
    error,
    refresh: fetchProxyStats,
  }
}

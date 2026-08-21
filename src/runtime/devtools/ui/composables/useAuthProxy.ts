import { ref, onMounted, onUnmounted } from 'vue'

import type { AuthProxyStats } from '../../types'

/**
 * Composable for fetching auth proxy stats from the DevTools server endpoint.
 * The auth proxy runs on the Nitro server, so we poll the endpoint directly.
 */
export function useAuthProxy() {
  const proxyStats = ref<AuthProxyStats | null>(null)
  const pending = ref(false)
  const error = ref<string | null>(null)
  let intervalId: ReturnType<typeof setInterval> | null = null

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

  async function clearProxyStats() {
    try {
      await fetch('/__convex_devtools__/proxy-stats/clear', { method: 'POST' })
      await fetchProxyStats()
    } catch {
      // Ignore errors
    }
  }

  onMounted(async () => {
    // Initial fetch
    await fetchProxyStats()

    // Poll for updates every 3 seconds
    intervalId = setInterval(fetchProxyStats, 3000)
  })

  onUnmounted(() => {
    if (intervalId) {
      clearInterval(intervalId)
      intervalId = null
    }
  })

  return {
    proxyStats,
    pending,
    error,
    refresh: fetchProxyStats,
    clear: clearProxyStats,
  }
}

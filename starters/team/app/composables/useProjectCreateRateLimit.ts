import {
  computed,
  getCurrentScope,
  onScopeDispose,
  shallowRef,
  toValue,
  watch,
  type MaybeRefOrGetter,
} from 'vue'

import { api } from '#convex/api'

/**
 * The project-create rate limit for the signed-in user in a team.
 *
 * Convex re-runs the query when the rate limiter's data changes (each created
 * project), but not when time passes. So the browser starts its own timer from
 * `retryAfterMs` and allows the next attempt when it ends. The `create`
 * mutation still enforces the limit on the server.
 */
export async function useProjectCreateRateLimit(teamId: MaybeRefOrGetter<string>) {
  // Captured before the await below: after it, Vue no longer knows the caller's scope.
  const scope = getCurrentScope()
  const resolvedTeamId = computed(() => toValue(teamId).trim())
  const { data } = await useConvexQuery(api.projects.getCreateRateLimit, () =>
    resolvedTeamId.value ? { teamId: resolvedTeamId.value } : 'skip',
  )

  const waitEnded = shallowRef(false)
  let timer: ReturnType<typeof setTimeout> | undefined
  const clearTimer = () => {
    clearTimeout(timer)
    timer = undefined
  }

  const startTimerWatch = () => {
    watch(
      () => data.value,
      (limit) => {
        clearTimer()
        waitEnded.value = false
        if (!limit || limit.allowed || !limit.retryAfterMs) return
        timer = setTimeout(() => {
          waitEnded.value = true
        }, limit.retryAfterMs)
      },
      { immediate: true },
    )
    onScopeDispose(clearTimer)
  }
  if (scope) scope.run(startTimerWatch)
  else startTimerWatch()

  const canSubmit = computed(() => data.value?.allowed !== false || waitEnded.value)

  return {
    rateLimit: data,
    canSubmit,
    message: computed(() => (canSubmit.value ? null : (data.value?.message ?? null))),
  }
}

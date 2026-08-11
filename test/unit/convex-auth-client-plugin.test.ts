import { describe, expect, it, vi } from 'vitest'

import { convexClientPlugin } from '../../src/runtime/auth-client/convex-client-plugin'

describe('internal Convex auth client plugin', () => {
  it('exposes only the fixed GET token action and cannot be method-overridden', async () => {
    const fetch = vi.fn(async () => ({ data: { token: 'jwt' }, error: null }))
    const plugin = convexClientPlugin()
    const actions = plugin.getActions?.(fetch as never)

    expect(plugin.id).toBe('convex')
    expect(plugin.pathMethods).toEqual({ '/convex/token': 'GET' })
    await expect(
      actions?.convex.token({
        fetchOptions: { method: 'POST', throw: false },
      }),
    ).resolves.toEqual({ data: { token: 'jwt' }, error: null })
    expect(fetch).toHaveBeenCalledWith('/convex/token', {
      method: 'GET',
      throw: false,
    })
  })

  it('preserves a nullable anonymous token response', async () => {
    const fetch = vi.fn(async () => ({ data: { token: null }, error: null }))
    const actions = convexClientPlugin().getActions?.(fetch as never)

    await expect(actions?.convex.token()).resolves.toEqual({
      data: { token: null },
      error: null,
    })
  })
})

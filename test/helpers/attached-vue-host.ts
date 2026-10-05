import { vi } from 'vitest'
import { createApp, effectScope } from 'vue'

import { createBetterConvex } from '../../packages/vue/src'
import { createBetterConvexAttachment } from '../../packages/vue/src/embedded'
import type { ClientIdentitySnapshot } from '../../packages/vue/src/internal/identity-port'

type AttachmentClient = Parameters<typeof createBetterConvexAttachment>[0]['client']

/**
 * One Vue app attached to a stub client, with a settled signed-in identity that
 * a test advances by hand. Unanswered client methods are inert spies.
 */
export function attachedVueHost(
  client: Partial<Record<keyof AttachmentClient, unknown>>,
  options: { settlement?: () => Promise<void> } = {},
) {
  let snapshot: ClientIdentitySnapshot = {
    authEnabled: true,
    settled: true,
    identityKey: 'user:alice',
    identityGeneration: 1,
    error: null,
  }
  const listeners = new Set<() => void>()
  const transport = {
    query: vi.fn(),
    mutation: vi.fn(),
    action: vi.fn(),
    onUpdate: vi.fn(() => () => {}),
    ...client,
  } as unknown as AttachmentClient
  const attachment = createBetterConvexAttachment({
    client: transport,
    anonymousClient: transport,
    identity: {
      snapshot: () => snapshot,
      waitForInitialSettlement: options.settlement ?? (async () => {}),
      subscribe(listener) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    },
  })
  const app = createApp({})
  app.use(createBetterConvex({ attachment }))
  const scope = effectScope()
  return {
    listeners,
    run<T>(factory: () => T): T {
      return app.runWithContext(() => scope.run(factory))!
    },
    advanceIdentity() {
      snapshot = { ...snapshot, identityGeneration: snapshot.identityGeneration + 1 }
      for (const listener of [...listeners]) listener()
    },
    stop: () => scope.stop(),
  }
}

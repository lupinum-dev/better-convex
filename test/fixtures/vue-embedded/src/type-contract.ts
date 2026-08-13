import {
  createBetterConvex,
  type BetterConvexPlugin,
  type CreateBetterConvexOptions,
  // @ts-expect-error auth snapshots are implementation-port vocabulary
  type BetterConvexAuthSnapshot as _RemovedAuthSnapshot,
  // @ts-expect-error identity snapshots are implementation-port vocabulary
  type BetterConvexIdentitySnapshot as _RemovedIdentitySnapshot,
  // @ts-expect-error the call-error taxonomy lives only on /errors
  type ConvexCallErrorKind as _RemovedRootErrorKind,
} from '@lupinum/better-convex-vue'
import {
  createBetterConvexAttachment,
  type BetterConvexAttachment,
  // @ts-expect-error identity observers are not an embedded consumer contract
  type BetterConvexIdentityObserver as _RemovedEmbeddedObserver,
  // @ts-expect-error identity snapshots are not an embedded consumer contract
  type BetterConvexIdentitySnapshot as _RemovedEmbeddedSnapshot,
  // @ts-expect-error the root-only client handle is not duplicated by /embedded
  type ConvexClientHandle as _RemovedEmbeddedClient,
} from '@lupinum/better-convex-vue/embedded'

declare const attachment: BetterConvexAttachment
declare const attachmentInput: Parameters<typeof createBetterConvexAttachment>[0]

const options: CreateBetterConvexOptions = { attachment }
const plugin: BetterConvexPlugin = createBetterConvex(options)
const roundTrip: BetterConvexAttachment = plugin.attachment()

// @ts-expect-error every producer must deliberately supply the anonymous transport
createBetterConvexAttachment({
  client: attachmentInput.client,
  identity: attachmentInput.identity,
})

// @ts-expect-error the former consumer option was removed without an alias
createBetterConvex({ runtime: attachment })
// @ts-expect-error an attached child cannot create a competing client owner
createBetterConvex({ attachment, convexUrl: 'https://duplicate-owner.invalid' })
// @ts-expect-error an attached child cannot install an authentication authority
createBetterConvex({ attachment, auth: {} })
// @ts-expect-error the attachment cannot dispose its host
attachment.dispose()
// @ts-expect-error the attachment cannot close its host client
attachment.client.close()
// @ts-expect-error the attachment cannot change host authentication
attachment.client.setAuth(
  async () => null,
  () => {},
)
// @ts-expect-error the attachment does not expose a raw client
const rawClient: never = attachment.client.rawClient
// @ts-expect-error the attachment does not expose credentials
const token: never = attachment.token
// @ts-expect-error readiness is internal runtime coordination, not a plugin control
plugin.ready()
// @ts-expect-error authentication refresh belongs to the provider/runtime
plugin.refreshAuth()

void roundTrip
void rawClient
void token

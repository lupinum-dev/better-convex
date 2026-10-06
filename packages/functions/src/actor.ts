import { ConvexError, v, type Infer } from 'convex/values'

/**
 * Who acts. A person acts for themselves; an agent acts for a person through
 * one door with one grant; a visitor is signed out; the system runs jobs.
 * Every function gets one.
 */
export type Actor<User> =
  | { kind: 'person'; door: 'web'; user: User; authId: string }
  | {
      kind: 'agent'
      door: 'mcp'
      user: User
      clientId: string
      scopes: readonly string[]
      caller: AgentCaller
      approvalId?: string
    }
  | {
      kind: 'agent'
      door: 'app'
      user: User
      agent: string
      runId: string
      scopes: readonly string[]
      caller: AgentCaller
      approvalId?: string
    }

export type Visitor = { kind: 'visitor' }

export type SystemActor = { kind: 'system'; job: string }

/** How a door hands an agent's identity to a tool function. Internal functions only. */
export const agentCallerValidator = v.union(
  v.object({
    door: v.literal('mcp'),
    principal: v.object({
      kind: v.literal('oauth'),
      userId: v.string(),
      clientId: v.string(),
      scopes: v.array(v.string()),
      sessionId: v.string(),
      grantId: v.string(),
      issuer: v.string(),
      resource: v.string(),
      expiresAt: v.number(),
    }),
  }),
  // `turn`: the step that calls; a call from a step that is no longer current is refused.
  v.object({ door: v.literal('app'), runId: v.string(), turn: v.optional(v.number()) }),
)
export type AgentCaller = Infer<typeof agentCallerValidator>

/**
 * Who an internal operation acts for, as its caller passes it. The internal
 * operation checks it again (session, grant, suspension), so a scheduled
 * follow-up stops when the person or agent may no longer act.
 */
export const actingAsValidator = v.union(
  v.object({ kind: v.literal('person'), authId: v.string() }),
  // `approvalId`: the person's approval this work runs under, so its internal operations may run too.
  v.object({
    kind: v.literal('agent'),
    caller: agentCallerValidator,
    approvalId: v.optional(v.string()),
  }),
  v.object({ kind: v.literal('visitor') }),
  v.object({ kind: v.literal('system'), job: v.string() }),
)
export type ActingAs = Infer<typeof actingAsValidator>

/** The stored form of an actor, for activity and approval rows. */
export const actorRecordValidator = v.object({
  key: v.string(),
  kind: v.union(v.literal('person'), v.literal('agent'), v.literal('system')),
  door: v.union(v.literal('web'), v.literal('mcp'), v.literal('app'), v.literal('job')),
  userId: v.optional(v.string()),
  clientId: v.optional(v.string()),
  agent: v.optional(v.string()),
  job: v.optional(v.string()),
})
type ActorRecord = Infer<typeof actorRecordValidator>

export function actorRecord(actor: Actor<{ _id: string }> | SystemActor): ActorRecord {
  if (actor.kind === 'system') {
    return { key: `system:${actor.job}`, kind: 'system', door: 'job', job: actor.job }
  }
  const userId = actor.user._id
  if (actor.kind === 'person')
    return { key: `person:${userId}`, kind: 'person', door: 'web', userId }
  if (actor.door === 'mcp') {
    const { clientId } = actor
    return { key: `mcp:${userId}:${clientId}`, kind: 'agent', door: 'mcp', userId, clientId }
  }
  const { agent } = actor
  return { key: `app:${userId}:${agent}`, kind: 'agent', door: 'app', userId, agent }
}

/**
 * Every code a caller can receive, from the library or from the app's own
 * `fail`. The web client, MCP hosts and in-app agents receive
 * `{ code, message }`; switch on `code`.
 */
export type ErrorCode =
  /** No session: sign in. */
  | 'NOT_SIGNED_IN'
  /** Signed in, but this account may not use the app (suspended, no profile). */
  | 'ACCOUNT_DISABLED'
  /** The actor exists but may not do this. */
  | 'FORBIDDEN'
  /** The row does not exist, or the actor may not know it does. */
  | 'NOT_FOUND'
  /** The input is wrong, or names a row whose state does not allow this (a cancelled order); the message names the field. */
  | 'INVALID_INPUT'
  /** The agent's grant ended: turned off, revoked or expired. */
  | 'AGENT_DISABLED'
  | 'APPROVAL_NOT_FOUND'
  | 'APPROVAL_EXPIRED'
  | 'APPROVAL_DECLINED'
  /** The rows a request was about changed after the person saw it. */
  | 'STALE'
  | 'REQUEST_ID_REUSED'
  /** A limit was reached; the message says which and when to retry. */
  | 'RATE_LIMITED'
  /** Too much at once: too many IDs, too large a request. */
  | 'TOO_LARGE'
  /** Another write to the same rows won; try again. */
  | 'CONFLICT'
  /** An unexpected error; the detail is in the log, not in the message. */
  | 'FAILED'
  /** An in-app agent run stopped answering. */
  | 'STALLED'
  /** The model service: busy or out of quota, refused the request or key, did not answer, took too long. */
  | 'MODEL_BUSY'
  | 'MODEL_REFUSED'
  | 'MODEL_FAILED'
  | 'MODEL_TIMEOUT'

/**
 * A failure the caller may see. Anything else stays internal: callers see a
 * generic message and the log keeps the detail. Only `ErrorCode`s, so a
 * misspelled code is a type error and every code a client meets is listed.
 */
export function fail(code: ErrorCode, message: string): never {
  throw new ConvexError({ code, message })
}

/** The coded failure inside an error, or `null` for an internal one. */
export function failureOf(error: unknown): { code: string; message: string } | null {
  const data = (error as { data?: unknown } | null)?.data
  if (data && typeof data === 'object' && typeof (data as { code?: unknown }).code === 'string') {
    const { code, message } = data as { code: string; message?: unknown }
    return { code, message: typeof message === 'string' ? message : code }
  }
  return null
}

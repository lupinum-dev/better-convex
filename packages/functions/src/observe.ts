import { actorRecord, type ActingAs, type Actor, type SystemActor, type Visitor } from './actor'

/** A value `ctx.log.set` takes: what JSON can hold. */
export type LogValue =
  | string
  | number
  | boolean
  | null
  | readonly LogValue[]
  | { readonly [key: string]: LogValue }

/**
 * Fields for the event of this call, with `defineFunctions({ observe: true })`. Later calls to
 * `set` replace a field of the same name. Without `observe`, `set` does nothing. Write IDs and
 * codes, never values a person typed (names, amounts, email addresses): log streams copy every
 * line to another service.
 */
export interface CallLog {
  set(fields: Record<string, LogValue>): void
}

/** The actor as the event shows it: the stored actor record, or the kind alone where only that is known. */
type ActorField = ReturnType<typeof actorRecord> | { kind: 'person' | 'agent' | 'visitor' }

/** What the event of one call knows so far. The wrapper fills it in as the call learns it. */
export interface Seen {
  actor?: ActorField
  tenant?: string
  approval?: string
  written?: ReadonlySet<string>
  /** Rows the calls it ran in its own transaction wrote: they write no event, so this one counts them. */
  innerWritten?: Set<string>
  /** The trace this call belongs to: handed over by its caller, or made when it first starts other work. */
  trace?: string
  readonly fields: Record<string, LogValue>
}

export const newSeen = (trace?: string): Seen => ({
  ...(trace !== undefined && { trace }),
  fields: {},
})

/**
 * The trace ID of this call, made when it first hands work on. Convex gives scheduled work a new
 * request ID and no link to the call that scheduled it, so the work carries this ID instead, and
 * every event of the chain shows it. 16 hex digits, like a Convex request ID.
 */
export function traceOf(seen: Seen): string {
  seen.trace ??= Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join(
    '',
  )
  return seen.trace
}

export const logOf = (seen: Seen): CallLog => ({
  set: (fields) => {
    Object.assign(seen.fields, fields)
  },
})

/** Records the actor a check found. */
export function sawActor(seen: Seen, actor: Actor<{ _id: string }> | Visitor | SystemActor): void {
  seen.actor = actor.kind === 'visitor' ? { kind: 'visitor' } : actorRecord(actor)
  if (actor.kind === 'agent' && actor.approvalId !== undefined) seen.approval = actor.approvalId
}

/**
 * Records who an internal action acts for, as its caller handed it over. The action checks no
 * actor itself, so the event names the kind only; each `ctx.run` it makes checks and records the
 * full actor in its own event.
 */
export function sawActing(seen: Seen, who: ActingAs): void {
  if (who.kind === 'system') {
    seen.actor = actorRecord(who)
    return
  }
  seen.actor = { kind: who.kind }
  if (who.kind === 'agent' && who.approvalId !== undefined) seen.approval = who.approvalId
}

export type CallKind = 'query' | 'mutation' | 'action'

/**
 * The code of a failure: any `ConvexError` `data.code` string, the library's codes and the app's
 * own. A crash has none; Convex's own event for the same request ID has its text.
 */
function codeOf(error: unknown): string | undefined {
  const data = (error as { data?: unknown } | null)?.data
  const code = data && typeof data === 'object' ? (data as { code?: unknown }).code : undefined
  return typeof code === 'string' ? code : undefined
}

/**
 * The event of one call. IDs and codes only: no arguments, no results, no messages. Duration,
 * function path, usage and the request ID are in Convex's own event for the same request.
 */
export function callEvent(
  kind: CallKind,
  action: string | undefined,
  seen: Seen,
  failure?: { error: unknown },
) {
  const code = failure && codeOf(failure.error)
  const rows =
    seen.written || seen.innerWritten
      ? new Set([...(seen.written ?? []), ...(seen.innerWritten ?? [])]).size
      : undefined
  return {
    type: 'better-convex.call',
    ...(action !== undefined && { action }),
    kind,
    ...(seen.actor && { actor: seen.actor }),
    ...(seen.tenant !== undefined && { tenant: seen.tenant }),
    outcome: failure ? 'error' : 'ok',
    ...(code !== undefined && { code }),
    // A failed call keeps none of its writes, so only a call that succeeded counts them.
    ...(!failure && kind !== 'query' && rows !== undefined && { written: rows }),
    ...(seen.approval !== undefined && { approval: seen.approval }),
    ...(seen.trace !== undefined && { trace: seen.trace }),
    ...fieldsOf(seen),
  }
}

/** The fields the handler added, if any: for this call's event, or handed back to the caller's. */
export const fieldsOf = (seen: Seen): { fields?: Record<string, LogValue> } =>
  Object.keys(seen.fields).length > 0 ? { fields: seen.fields } : {}

/** Writes the event of a call that failed. A console line survives the rollback of a failed mutation. */
export function logFailure(kind: CallKind, action: string | undefined, seen: Seen, error: unknown) {
  console.log(JSON.stringify(callEvent(kind, action, seen, { error })))
}

/**
 * Runs one call and writes its event as one JSON line on the console. A console line survives
 * the rollback of a failed mutation, and a Convex log stream sends it on. A query writes one only
 * when it fails: reactive queries run again on every change of the rows they read.
 */
export async function observed<T>(
  on: boolean,
  kind: CallKind,
  action: string | undefined,
  seen: Seen,
  run: () => Promise<T>,
): Promise<T> {
  if (!on) return run()
  let result: T
  try {
    result = await run()
  } catch (error) {
    logFailure(kind, action, seen, error)
    throw error
  }
  if (kind !== 'query') console.log(JSON.stringify(callEvent(kind, action, seen)))
  return result
}

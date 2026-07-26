import { internal } from './_generated/api'
import { httpAction } from './_generated/server'
import {
  INTERACTION_LAB_SESSIONS,
  INTERACTION_ORIGIN,
  INTERACTION_SESSION_COOKIE,
} from './interaction_page_contract'
import { LAB_OAUTH_ISSUER } from './oauth_fixture'

const MAX_CONFIRMATION_BODY_BYTES = 128
const LOCATOR_PATH = /^\/interactions\/([\w-]{32,128})$/u

type BrowserActor = {
  issuer: string
  subject: string
}

type InteractionResult =
  | {
      code: string
      ok: false
    }
  | {
      ok: true
      value: {
        expiresAt?: number
        receipt?: {
          deletedAt: number
          deletedNoteCount: number
          revision: number
          workspaceId: string
        }
        review?: {
          effects: Array<{
            noteCount: number
            type: 'workspace_deleted'
            workspaceId: string
          }>
          summary: string
          warnings: Array<{
            code: 'NOTES_WILL_BE_DELETED'
            count: number
          }>
        }
        status: 'pending' | 'applied' | 'stale' | 'expired'
      }
    }

const actorsBySession = new Map<string, BrowserActor>([
  [INTERACTION_LAB_SESSIONS.alice, { issuer: LAB_OAUTH_ISSUER, subject: 'alice' }],
  [INTERACTION_LAB_SESSIONS.bob, { issuer: LAB_OAUTH_ISSUER, subject: 'bob' }],
  [
    INTERACTION_LAB_SESSIONS.sameSubjectOtherIssuer,
    { issuer: 'https://other-issuer.example.invalid', subject: 'alice' },
  ],
])

function responseHeaders(contentType = 'text/html; charset=utf-8'): Headers {
  return new Headers({
    'cache-control': 'private, no-store',
    'content-security-policy':
      "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'",
    'content-type': contentType,
    'cross-origin-opener-policy': 'same-origin',
    'permissions-policy':
      'camera=(), display-capture=(), geolocation=(), microphone=(), payment=(), usb=()',
    'referrer-policy': 'strict-origin',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
  })
}

function textResponse(status: number, message: string): Response {
  return new Response(message, {
    headers: responseHeaders('text/plain; charset=utf-8'),
    status,
  })
}

function parseCookies(header: string | null): Map<string, string> {
  const cookies = new Map<string, string>()
  for (const segment of header?.split(';') ?? []) {
    const separator = segment.indexOf('=')
    if (separator < 1) continue
    const name = segment.slice(0, separator).trim()
    const value = segment.slice(separator + 1).trim()
    if (name && value && !cookies.has(name)) cookies.set(name, value)
  }
  return cookies
}

function requestActor(request: Request): BrowserActor | null {
  const session = parseCookies(request.headers.get('cookie')).get(INTERACTION_SESSION_COOKIE)
  return session ? (actorsBySession.get(session) ?? null) : null
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function resultStatus(result: InteractionResult): number {
  if (result.ok) return 200
  if (result.code === 'INTERACTION_NOT_FOUND') return 404
  if (result.code === 'ACCESS_DENIED') return 403
  if (result.code === 'INPUT_INVALID') return 400
  return 409
}

function renderInteraction(result: Extract<InteractionResult, { ok: true }>): string {
  const { receipt, review, status } = result.value
  if (!review) throw new Error('LAB_INTERACTION_REVIEW_INVALID')
  const effects = review.effects
    .map(
      (effect) =>
        `<li data-testid="effect">${escapeHtml(effect.type)}: ${effect.noteCount.toString()} note(s)</li>`,
    )
    .join('')
  const warnings = review.warnings
    .map(
      (warning) =>
        `<li data-testid="warning">${escapeHtml(warning.code)}: ${warning.count.toString()}</li>`,
    )
    .join('')
  const confirmation =
    status === 'pending'
      ? '<form method="post" action=""><button data-testid="confirm" type="submit">Confirm deletion</button></form>'
      : ''
  const receiptHtml = receipt
    ? `<dl data-testid="receipt"><dt>Deleted notes</dt><dd>${receipt.deletedNoteCount.toString()}</dd><dt>Revision</dt><dd>${receipt.revision.toString()}</dd></dl>`
    : ''
  return [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>Review workspace deletion</title></head><body>',
    '<main data-testid="interaction">',
    `<h1>${escapeHtml(review.summary)}</h1>`,
    `<p data-testid="status">${escapeHtml(status)}</p>`,
    `<ul aria-label="Effects">${effects}</ul>`,
    warnings ? `<ul aria-label="Warnings">${warnings}</ul>` : '',
    receiptHtml,
    confirmation,
    '</main></body></html>',
  ].join('')
}

async function readBoundedEmptyBody(request: Request): Promise<boolean> {
  const declaredLength = request.headers.get('content-length')
  if (
    declaredLength !== null &&
    (!/^\d{1,3}$/u.test(declaredLength) || Number(declaredLength) > MAX_CONFIRMATION_BODY_BYTES)
  ) {
    return false
  }
  if (request.body === null) return true
  const reader = request.body.getReader()
  let total = 0
  while (true) {
    const next = await reader.read()
    if (next.done) return total === 0
    total += next.value.byteLength
    if (total > MAX_CONFIRMATION_BODY_BYTES) {
      await reader.cancel()
      return false
    }
  }
}

function interactionLocator(request: Request): string | null {
  const url = new URL(request.url)
  const match = LOCATOR_PATH.exec(url.pathname)
  return match?.[1] ?? null
}

export const getInteractionPage = httpAction(async (ctx, request) => {
  const locator = interactionLocator(request)
  if (!locator) return textResponse(404, 'Not found')
  const actor = requestActor(request)
  if (!actor) return textResponse(401, 'Sign in required')
  const result = (await ctx.runQuery(internal.operations.getWorkspaceDeletionReview, {
    actor,
    locator,
  })) as InteractionResult
  if (!result.ok) return textResponse(resultStatus(result), 'Interaction unavailable')
  return new Response(renderInteraction(result), {
    headers: responseHeaders(),
    status: 200,
  })
})

export const postInteractionConfirmation = httpAction(async (ctx, request) => {
  const locator = interactionLocator(request)
  if (!locator) return textResponse(404, 'Not found')
  if (request.headers.get('origin') !== INTERACTION_ORIGIN) {
    return textResponse(403, 'Confirmation rejected')
  }
  const actor = requestActor(request)
  if (!actor) return textResponse(401, 'Sign in required')
  if (!(await readBoundedEmptyBody(request))) {
    return textResponse(400, 'Confirmation rejected')
  }
  const result = (await ctx.runMutation(internal.operations.confirmWorkspaceDeletion, {
    actor,
    locator,
  })) as InteractionResult
  if (!result.ok) return textResponse(resultStatus(result), 'Confirmation rejected')
  const headers = responseHeaders()
  headers.set('location', `${INTERACTION_ORIGIN}/interactions/${locator}`)
  return new Response(null, { headers, status: 303 })
})

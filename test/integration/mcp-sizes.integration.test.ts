// Size limits of the MCP door and of approvals, on a real local Convex backend: a response that
// fits is returned whole, one just over becomes the documented marker (never an HTTP 502 after the
// write committed), the JSON-RPC id and escaped characters count, an approval document may weigh
// 256 KiB, a stored result 64 KiB, and a person may have 20 requests open. The numbers come from
// the product source; the starter copy gets three test-only tools (see `sizeTools` below).
import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { ConvexHttpClient } from 'convex/browser'
import { makeFunctionReference } from 'convex/server'
import { getConvexSize } from 'convex/values'
import { chromium, type Browser, type BrowserContext } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  authorizeInBrowser,
  isRecord,
  postMcp,
  provisionClients,
  redeemCode,
  root,
  sleep,
  SCOPE,
  INSPECTOR_CALLBACK,
  startMcpFixture,
  toolCall,
  type JsonRecord,
  type McpFixture,
  type McpResponse,
} from './harness'

// Better Auth allows three sign-ins per ten-second window; each connection signs in once.
const SIGN_IN_WINDOW_MS = 10_100

/** A number the product defines as `const name = 256 * 1024` in `file`. */
function constant(file: string, name: string): number {
  const text = readFileSync(join(root, file), 'utf8')
  const match = new RegExp(`(?:const|let) ${name} = ([\\d_]+(?: \\* [\\d_]+)*)`).exec(text)
  if (!match) throw new Error(`${name} is not defined as a number product in ${file}`)
  return match[1]!
    .split('*')
    .reduce((total, part) => total * Number(part.trim().replaceAll('_', '')), 1)
}
const responseLimit = constant('packages/agents/src/transport.ts', 'maximumMcpResponseBytes')
const approvalLimit = constant('packages/agents/src/tools.ts', 'maxApprovalBytes')
const openLimit = constant('packages/agents/src/tools.ts', 'openApprovals')
// `storable(ran.output.result, Math.min(64 * 1024, room))` in the approve mutation.
const storedResultLimit =
  Number(
    /Math\.min\((\d+) \* 1024, room\)/u.exec(
      readFileSync(join(root, 'packages/agents/src/tools.ts'), 'utf8'),
    )?.[1],
  ) * 1024

// The tools the test adds to the starter copy. They reuse the starter's actions, so no policy
// changes: `echo_text` returns `unit` repeated `count` times (a read); `create_project_big`
// writes a project and returns `count` characters (a write); `archive_project_big` asks a person,
// with a plan of `planChars` characters, and returns `resultChars` characters once approved.
const sizeTools = `import { fail } from '@lupinum/better-convex-functions'
import { v } from 'convex/values'

import { mutation, query } from './functions'

export const echo = query({
  action: 'projects.search',
  args: { organizationId: v.id('organizations'), unit: v.string(), count: v.number() },
  returns: v.object({ text: v.string() }),
  tool: { name: 'echo_text', description: 'Test: unit repeated count times.' },
  handler: async (_ctx, { unit, count }) => ({ text: unit.repeat(count) }),
})

export const bigCreate = mutation({
  action: 'projects.create',
  args: { organizationId: v.id('organizations'), name: v.string(), count: v.number() },
  returns: v.object({ id: v.id('projects'), text: v.string() }),
  tool: { name: 'create_project_big', description: 'Test: create a project, return count characters.' },
  handler: async (ctx, { organizationId, name, count }) => {
    const id = await ctx.db.insert('projects', {
      organizationId,
      name,
      status: 'active',
      createdBy: ctx.actor.user._id,
    })
    return { id, text: 'r'.repeat(count) }
  },
})

export const bigArchive = mutation({
  action: 'projects.archive',
  args: { projectId: v.id('projects'), planChars: v.number(), resultChars: v.number() },
  returns: v.object({ id: v.id('projects'), text: v.string() }),
  tool: { name: 'archive_project_big', description: 'Test: archive after approval.' },
  plan: async (_ctx, { planChars }) => ({ summary: 'p'.repeat(planChars) }),
  handler: async (ctx, { projectId, resultChars }) => {
    const found = await ctx.db.get(projectId)
    if (found?.status !== 'active') fail('NOT_FOUND', 'This project is not active.')
    await ctx.db.patch(projectId, { status: 'archived', archivedAt: Date.now() })
    return { id: projectId, text: 'r'.repeat(resultChars) }
  },
})
`
const sizeAgents = `import { defineTools } from '@lupinum/better-convex-agents'

import { internal } from './_generated/api'
import { fns } from './functions'
import * as projects from './projects'
import * as sizes from './sizes'

export const tools = defineTools(fns, { projects, sizes }, { functions: internal.agents })

export const {
  list_organizations,
  search_projects,
  create_project,
  rename_project,
  archive_project,
  echo_text,
  create_project_big,
  archive_project_big,
  check_approval,
  housekeeping,
} = tools.functions

export const { pending, get, approve, decline } = tools.approvals
export const { activity } = tools
`
// Operator-only reads (`convex run`): the document sizes as the product counts them, and counts.
const sizeState = `import { getConvexSize, v } from 'convex/values'

import { internalQuery } from './_generated/server'

export const approvalBytes = internalQuery({
  args: { approvalId: v.string() },
  handler: async (ctx, { approvalId }) => {
    const id = ctx.db.normalizeId('approvals', approvalId)
    const row = id && (await ctx.db.get(id))
    if (!row) return null
    const { _id, _creationTime, ...fields } = row
    return { stored: getConvexSize(row as never), checked: getConvexSize(fields as never) }
  },
})

export const state = internalQuery({
  args: {},
  handler: async (ctx) => {
    const approvals: Record<string, number> = {}
    for (const row of await ctx.db.query('approvals').collect())
      approvals[row.status] = (approvals[row.status] ?? 0) + 1
    const projects: Record<string, number> = {}
    for (const row of await ctx.db.query('projects').collect())
      if (row.name.startsWith('size-')) projects[row.name] = (projects[row.name] ?? 0) + 1
    const archived = (await ctx.db.query('projects').collect()).filter(
      (row) => row.name.startsWith('size-') && row.status === 'archived',
    ).length
    return { approvals, projects, archived }
  },
})
`

/** The result of a tool call: its structured content, or the error. */
function outcome(response: McpResponse) {
  expect(response.status, 'a tool result is HTTP 200, never a 502').toBe(200)
  const result = isRecord(response.body.result) ? response.body.result : {}
  const content = isRecord(result.structuredContent) ? result.structuredContent : {}
  if (result.isError === true) {
    const error = isRecord(content.error) ? content.error : {}
    return { kind: 'error' as const, code: String(error.code), content }
  }
  return { kind: 'ok' as const, content }
}

const sizeOf = (value: unknown) => getConvexSize(value as never)

describe('MCP door and approval size limits', () => {
  let fixture: McpFixture
  let browser: Browser
  let resource: string
  let organizationId: string
  let clients: Awaited<ReturnType<typeof provisionClients>>
  let terminal: Record<string, string>
  let convex: ConvexHttpClient
  const contexts: BrowserContext[] = []

  /** A fresh sign-in and OAuth grant for one client; a connection of its own, with its own limits. */
  async function connect(clientId: string) {
    await sleep(SIGN_IN_WINDOW_MS)
    const context = await browser.newContext()
    contexts.push(context)
    const page = await context.newPage()
    const grant = await authorizeInBrowser(page, fixture, {
      clientId,
      redirectUri: INSPECTOR_CALLBACK,
      resource,
      scope: SCOPE,
    })
    const token = await redeemCode(fixture.origin, {
      client_id: clientId,
      code: grant.code,
      code_verifier: grant.verifier,
      grant_type: 'authorization_code',
      redirect_uri: INSPECTOR_CALLBACK,
      resource,
    })
    expect(token.status).toBe(200)
    await page.close()
    const accessToken = (token.body as JsonRecord).access_token as string
    return { accessToken, context }
  }

  const call = (token: string, id: string, name: string, args: JsonRecord) =>
    postMcp(resource, token, toolCall(id, name, args))

  beforeAll(async () => {
    fixture = await startMcpFixture({
      prepare: async (cwd) => {
        await writeFile(join(cwd, 'convex/sizes.ts'), sizeTools)
        await writeFile(join(cwd, 'convex/sizeState.ts'), sizeState)
        await writeFile(join(cwd, 'convex/agents.ts'), sizeAgents)
      },
    })
    resource = `${fixture.convexSiteUrl}/mcp`
    clients = await provisionClients(fixture)
    organizationId = clients.organizationId
    const provisioned = (await fixture.runConvex('evidence:provisionTerminalClients')) as {
      clients: Record<string, string>
    }
    terminal = provisioned.clients
    browser = await chromium.launch({ headless: true })
  })

  afterAll(async () => {
    for (const context of contexts) await context.close().catch(() => {})
    await browser?.close().catch(() => {})
    await fixture?.release()
  })

  describe('door responses', () => {
    let token: string

    beforeAll(async () => {
      token = (await connect(clients.inspector)).accessToken
    })

    const echo = (id: string, unit: string, count: number) =>
      call(token, id, 'echo_text', { organizationId, unit, count })

    /** The text of a result that came back whole, or undefined for the marker. */
    function whole(response: McpResponse) {
      const { kind, content } = outcome(response)
      expect(kind).toBe('ok')
      expect(content.status).toBe('done')
      const result = content.result as JsonRecord
      return typeof result.text === 'string' ? result.text : undefined
    }

    // Catches (rf:4, r2r:1, r3:4): a size estimate that misses escaping (quotes, newlines, control
    // characters count twice: in `structuredContent` and again, escaped, in the text) or the
    // JSON-RPC id answers HTTP 502 after the tool ran; a reserve in the estimate refuses results
    // that fit. For each kind of character and a short and a very long id: the largest result that
    // is returned whole has a response of at most the limit, and not one unit less than the limit
    // allows; one more unit is the marker with its size, still HTTP 200.
    it.each([
      ['ascii', 'a'],
      ['quote', '"'],
      ['newline', '\n'],
      ['backslash', '\\'],
      ['control character', '\u0001'],
      ['two-byte character', 'é'],
      ['four-byte character', '😀'],
    ])(
      'returns the largest result that fits whole, and the marker above it: %s',
      async (_, unit) => {
        for (const id of ['x', `long-${'i'.repeat(20_000)}`]) {
          const perUnit = (await echo(id, unit, 2_000)).bytes - (await echo(id, unit, 1_000)).bytes
          // Units of 1,000 cost 1,000 times the cost of one unit in the response.
          const cost = perUnit / 1_000
          expect(Number.isInteger(cost) && cost > 0, 'cost of one unit in the response').toBe(true)
          let [fits, over] = [0, Math.ceil(responseLimit / cost) + 1]
          let fitsBytes = 0
          while (over - fits > 1) {
            const count = Math.floor((fits + over) / 2)
            const response = await echo(id, unit, count)
            if (whole(response) === undefined) over = count
            else {
              fits = count
              fitsBytes = response.bytes
            }
          }
          const label = `${JSON.stringify(unit)} with an id of ${id.length} characters`
          expect(fitsBytes, `${label}: fits`).toBeLessThanOrEqual(responseLimit)
          expect(
            responseLimit - fitsBytes,
            `${label}: no unused room for one more unit`,
          ).toBeLessThan(cost)
          const returned = await echo(id, unit, fits)
          expect(whole(returned), label).toBe(unit.repeat(fits))
          const refused = outcome(await echo(id, unit, over))
          expect(refused.content, label).toEqual({
            status: 'done',
            // The marker names the result's own size.
            result: { truncated: true, bytes: sizeOf({ text: unit.repeat(over) }) },
          })
        }
      },
    )

    // Catches (rf:4): a write whose result is too big for the response answering 502 after it
    // committed (the host then retries and writes twice), or a retry that writes again.
    it.each([
      // Fits the response, too big to keep for a replay (64 KiB).
      ['a result that fits the response', 'size-fits', 200_000, true],
      // Two copies of 600,000 characters are more than the response limit allows.
      ['a result over the response limit', 'size-over', 600_000, false],
    ])('writes once for %s, also when the host retries', async (_, name, count, fits) => {
      const args = { organizationId, name, count, request_id: `retry-${name}` }
      const first = outcome(await call(token, `${name}-1`, 'create_project_big', args))
      const retry = outcome(await call(token, `${name}-2`, 'create_project_big', args))
      expect([first.kind, retry.kind]).toEqual(['ok', 'ok'])
      // The first answer is whole when it fits the response, else the marker.
      const firstResult = first.content.result as JsonRecord
      if (fits) expect(firstResult.text).toBe('r'.repeat(count))
      else expect(firstResult).toMatchObject({ truncated: true, bytes: expect.any(Number) })
      // A replay keeps at most 64 KiB.
      expect(retry.content.result).toMatchObject({ truncated: true, bytes: expect.any(Number) })
      const state = (await fixture.runConvex('sizeState:state')) as { projects: JsonRecord }
      expect(state.projects[name], 'the project was created once').toBe(1)
    })

    // The control for the two tests above: a result of a few bytes comes back untouched.
    it('returns a small result whole', async () => {
      expect(whole(await echo('small', 'a', 10))).toBe('a'.repeat(10))
    })
  })

  describe('approvals', () => {
    let token: string
    const decide = (name: 'approve' | 'decline', approvalId: string) =>
      convex.mutation(makeFunctionReference<'mutation'>(`agents:${name}`), { approvalId })

    /** Asks a person to archive; the plan has `planChars` characters. */
    const ask = (
      id: string,
      projectId: string,
      planChars: number,
      resultChars = 0,
      requestId?: string,
    ) =>
      call(token, id, 'archive_project_big', {
        projectId,
        planChars,
        resultChars,
        ...(requestId === undefined ? {} : { request_id: requestId }),
      })

    async function newProject(name: string) {
      const created = outcome(await call(token, name, 'create_project', { organizationId, name }))
      expect(created.kind).toBe('ok')
      return String(((created.content.result as JsonRecord) ?? {}).id)
    }

    const states = async () =>
      (await fixture.runConvex('sizeState:state')) as {
        approvals: Record<string, number>
        archived: number
      }

    beforeAll(async () => {
      const connection = await connect(terminal.conformance!)
      token = connection.accessToken
      const session = await connection.context.request.get(
        `${fixture.origin}/api/auth/convex/token`,
        { headers: { origin: fixture.origin } },
      )
      expect(session.ok()).toBe(true)
      convex = new ConvexHttpClient(fixture.convexUrl)
      convex.setAuth(((await session.json()) as JsonRecord).token as string)
    })

    /**
     * The longest plan (characters) whose approval document, with this retry key, weighs exactly
     * the limit. A probe tells the document's own size; each plan character adds one byte.
     */
    async function longestPlan(projectId: string, name: string, requestId?: string) {
      // A different call from an earlier probe on this project: a declined call waits out its time.
      const probeChars = requestId === undefined ? 1_000 : 1_001
      const probe = outcome(await ask(`${name}-probe`, projectId, probeChars, 0, requestId))
      expect(probe.content.status, JSON.stringify(probe.content).slice(0, 300)).toBe(
        'needs_approval',
      )
      const approvalId = String(probe.content.approvalId)
      const bytes = (await fixture.runConvex('sizeState:approvalBytes', { approvalId })) as {
        checked: number
      }
      await decide('decline', approvalId)
      return probeChars + (approvalLimit - bytes.checked)
    }

    // Catches (r3:3, rf:2, r2r:4): the plan limit counting rows instead of bytes, or the check
    // leaving no room. The whole approval document, retry key included, may weigh the limit:
    // exactly that fits and waits for a person; one byte more is TOO_LARGE, and asking again
    // stores nothing.
    it('stores an approval of exactly the limit and refuses one byte more, twice, without a trace', async () => {
      const projectId = await newProject('size-plan')
      const largest = await longestPlan(projectId, 'plan')

      const fits = outcome(await ask('plan-fits', projectId, largest))
      expect(fits.content.status, 'a document of exactly the limit').toBe('needs_approval')
      expect(
        await fixture.runConvex('sizeState:approvalBytes', {
          approvalId: String(fits.content.approvalId),
        }),
      ).toMatchObject({ checked: approvalLimit })
      // The same call again is the same request.
      const again = outcome(await ask('plan-fits-again', projectId, largest))
      expect(again.content.approvalId).toBe(fits.content.approvalId)
      await decide('decline', String(fits.content.approvalId))

      const before = await states()
      for (const id of ['plan-over-1', 'plan-over-2']) {
        const over = outcome(await ask(id, projectId, largest + 1))
        expect(over).toMatchObject({ kind: 'error', code: 'TOO_LARGE' })
      }
      expect(await states(), 'refused twice, nothing stored').toEqual(before)

      // A long retry key is part of the document: it takes at least its length from the plan.
      // A key names one call, so each request gets its own key of the same length.
      const key = (n: number) => `${'k'.repeat(4_999)}${n}`
      const withKey = await longestPlan(projectId, 'key', key(1))
      expect(largest - withKey).toBeGreaterThanOrEqual(5_000)
      expect(largest - withKey).toBeLessThan(5_100)
      const keyFits = outcome(await ask('key-fits', projectId, withKey, 0, key(2)))
      expect(keyFits.content.status, 'plan and long key at the limit').toBe('needs_approval')
      await decide('decline', String(keyFits.content.approvalId))
      const keyOver = outcome(await ask('key-over', projectId, withKey + 1, 0, key(3)))
      expect(keyOver).toMatchObject({ kind: 'error', code: 'TOO_LARGE' })
    })

    // Catches (rf:2, r2r:4): an approved plan that fits, plus the result added after, pushing the
    // document over 1 MiB and failing the approval after the write committed; a result kept whole
    // when it does not fit its room. The result gets 64 KiB, or what the decided document leaves.
    it.each([
      ['a result of exactly the stored limit', 10, 0, true],
      ['a result one byte over the stored limit', 10, 1, false],
      ['a plan at the document limit and a small result', 'largest', 2_000, false],
    ])('approves with %s and keeps what fits', async (_, plan, extra, kept) => {
      const name = `size-result-${String(plan)}-${extra}`
      const projectId = await newProject(name)
      let planChars = Number(plan)
      let resultChars = 2_000
      if (plan === 'largest') {
        planChars = await longestPlan(projectId, name)
      } else {
        // `{ id, text }` weighs exactly the limit with this many characters.
        resultChars = storedResultLimit - sizeOf({ id: projectId, text: '' }) + extra
      }
      const asked = outcome(await ask(name, projectId, planChars, resultChars))
      expect(asked.content.status).toBe('needs_approval')
      const approvalId = String(asked.content.approvalId)
      const before = await states()
      expect(await decide('approve', approvalId), 'approved, not failed').toEqual({
        status: 'approved',
      })
      const checked = outcome(await call(token, `${name}-check`, 'check_approval', { approvalId }))
      const stored = (checked.content.result as JsonRecord).result as JsonRecord
      if (kept) expect(stored).toEqual({ id: projectId, text: 'r'.repeat(resultChars) })
      else
        expect(stored).toEqual({
          truncated: true,
          bytes: sizeOf({ id: projectId, text: 'r'.repeat(resultChars) }),
        })
      const after = await states()
      expect(after.archived, 'the write ran once').toBe(before.archived + 1)
    })

    // Catches (r3:5, cx2-c): the count of open requests taken from a prefix, or the 21st request
    // stored anyway. Twenty fit; the 21st is refused every time and stores nothing; deciding one
    // makes room.
    it('lets a connection have 20 requests open, no more', async () => {
      const projectId = await newProject('size-open')
      expect((await states()).approvals.pending ?? 0, 'earlier tests decided their requests').toBe(
        0,
      )
      const ids: string[] = []
      for (let n = 1; n <= openLimit; n++) {
        const asked = outcome(await ask(`open-${n}`, projectId, n))
        expect(asked.content.status, `request ${n}`).toBe('needs_approval')
        ids.push(String(asked.content.approvalId))
      }
      for (const id of ['open-21', 'open-21-again']) {
        const refused = outcome(await ask(id, projectId, openLimit + 1))
        expect(refused).toMatchObject({ kind: 'error', code: 'RATE_LIMITED' })
      }
      expect((await states()).approvals.pending, 'refused twice, still 20').toBe(openLimit)
      await decide('decline', ids[0]!)
      const room = outcome(await ask('open-21-room', projectId, openLimit + 1))
      expect(room.content.status).toBe('needs_approval')
    })
  })
})

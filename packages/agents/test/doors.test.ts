import { toolFailure } from '@lupinum/better-convex-agents/internal'
import { handleMcpRequest, type HandleMcpRequestOptions } from '@lupinum/better-convex-agents/mcp'
import { grantMcp } from '@lupinum/better-convex-nuxt/better-auth/test'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { z } from 'zod'

import { runToolSafely } from '../src/errors'
import { api, setup } from './approvals/harness'
import { mcpClient, tokenFor } from './support'

// One table per guarantee, one row per way an agent reaches an operation: the MCP door over HTTP,
// a derived tool called with an MCP caller (what the door dispatches to), an in-app agent step,
// a hand-written server's `runTool`, and an approved run (after `approve`). Contract: docs
// 3.build/7.agents/1.tools-and-approvals.md and 3.limits.md, and 3.build/8.functions/
// 8.limits-and-audit.md. A guarantee built on one door and forgotten on another turns a cell red.

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

type S = Awaited<ReturnType<typeof setup>>

/** An in-app agent run in turn 2 for `authId`, on a grant with `projects:write`. */
async function inAppRun(s: S, authId = 'ann') {
  return await s.t.run(async (ctx) => {
    const user = await ctx.db
      .query('users')
      .withIndex('by_auth_id', (q) => q.eq('authId', authId))
      .unique()
    const grantId = await ctx.db.insert('agentGrants', {
      authId,
      userId: user!._id,
      agent: 'helper',
      scopes: ['projects:write'],
      expiresAt: Date.now() + 86_400_000,
    })
    return await ctx.db.insert('agentRuns', {
      grantId,
      userId: user!._id,
      agent: 'helper',
      step: 'agent:step',
      task: 'task',
      status: 'running',
      turn: 2,
      steps: 1,
      stepAt: Date.now(),
    })
  })
}

/** What each way in answers for one tool call: the error code, or 'ok'. */
async function viaDoors(s: S, who: 'ann' | 'vic') {
  const principal =
    who === 'ann'
      ? s.principal
      : {
          ...(await grantMcp(s.t, 'vic', ['projects:read', 'projects:write'])),
          expiresAt: s.principal.expiresAt,
        }
  const runId = await inAppRun(s, who)
  const http = mcpClient(s.t)
  const code = (error: unknown) => toolFailure(error).code
  return {
    door: async (name: string, input: Record<string, unknown>) => {
      const result = await http.call(tokenFor(principal), name, input)
      return result?.error?.code ?? 'ok'
    },
    derived: async (name: string, input: Record<string, unknown>) =>
      s.tool(name, input, principal).then(() => 'ok', code),
    inApp: async (name: string, input: Record<string, unknown>) =>
      s.t
        .mutation(api.tools[name], {
          caller: { door: 'app', runId, turn: 2 },
          input,
        })
        .then(() => 'ok', code),
    principal,
    runId,
  }
}
const paths = ['door', 'derived', 'inApp'] as const

/** Org B with a project of its own: nothing Ann's or Vic's agents may see. */
const foreignProject = (s: S) =>
  s.t.run(async (ctx) => {
    const b = await ctx.db.insert('orgs', { name: 'B' })
    return await ctx.db.insert('projects', { orgId: b, name: 'B one', status: 'active' })
  })
const nameOf = (s: S, id: S['p'][number]) => s.t.run(async (ctx) => (await ctx.db.get(id))!.name)
const audit = (s: S) => s.t.run((ctx) => ctx.db.query('auditLog').collect())
const buckets = (s: S) => s.t.run((ctx) => ctx.db.query('rateLimits').collect())

// Catches: a policy deny that holds on one agent door only. Vic is a viewer; his agent may not write.
// The call writes nothing, so no row rule stands behind the policy: only the deny can refuse it.
test.each(paths)('deny on the %s path: FORBIDDEN, nothing written', async (path) => {
  const s = await setup()
  const doors = await viaDoors(s, 'vic')
  expect(
    await doors[path]('touch_project', { projectId: s.p[0], name: 'by vic', quiet: true }),
  ).toBe('FORBIDDEN')
  expect(await nameOf(s, s.p[0]!)).toBe('alpha')
  expect(await audit(s)).toEqual([])
  expect(await buckets(s)).toEqual([])
  // Control: the same tool for Ann's agent.
  const ann = await viaDoors(s, 'ann')
  expect(await ann[path]('touch_project', { projectId: s.p[0], name: 'by ann' })).toBe('ok')
  expect(await nameOf(s, s.p[0]!)).toBe('by ann')
})

// Catches: the same deny on the approval door: a viewer's agent asks, and no request is stored.
test('deny on the approved path: a viewer cannot ask for an approval', async () => {
  const s = await setup()
  const doors = await viaDoors(s, 'vic')
  expect(await doors.derived('archive_project', { projectId: s.p[0] })).toBe('FORBIDDEN')
  expect(await s.approvalRows()).toEqual([])
  const asked = await s.ask('archive_project', { projectId: s.p[0] })
  expect(await s.approvalRows()).toHaveLength(1)
  // Control: Ann's request is stored; a viewer cannot decide it (no such request for him).
  await expect(s.vic.mutation(api.tools.approve, { approvalId: asked.approvalId })).rejects.toThrow(
    /APPROVAL_NOT_FOUND|NOT_FOUND/,
  )
  expect(await nameOf(s, s.p[0]!)).toBe('alpha')
})

// Catches: row rules checked on one agent door only: a project of another org is not there.
test.each(paths)('row rules on the %s path: a foreign project is NOT_FOUND', async (path) => {
  const s = await setup()
  const foreign = await foreignProject(s)
  const doors = await viaDoors(s, 'ann')
  expect(await doors[path]('touch_project', { projectId: foreign, name: 'x' })).toBe('NOT_FOUND')
  // A foreign row the input does not name: the row rules refuse the handler's write, and the
  // project it did write first rolls back.
  expect(
    await doors[path]('touch_project', { projectId: s.p[0], name: 'x', elsewhere: foreign }),
  ).toBe('NOT_FOUND')
  expect(await nameOf(s, foreign)).toBe('B one')
  expect(await nameOf(s, s.p[0]!)).toBe('alpha')
  expect(await audit(s)).toEqual([])
  expect(await buckets(s)).toEqual([])
  expect(await doors[path]('touch_project', { projectId: s.p[0], name: 'mine' })).toBe('ok')
})

test('row rules on the approved path: a foreign project stores no request', async () => {
  const s = await setup()
  const foreign = await foreignProject(s)
  const doors = await viaDoors(s, 'ann')
  expect(await doors.derived('archive_project', { projectId: foreign })).toBe('NOT_FOUND')
  expect(await s.approvalRows()).toEqual([])
})

// Catches (r1:1, r3:2): an upstream failure with a secret in it reaching the host on one door
// while another door is safe. A dependency's ConvexError (own code, or plain text) and a plain
// Error all become the same static failure; the write before the failure rolls back.
const canary = 'canary-secret-from-upstream'
const failed = { code: 'FAILED', message: 'The tool failed. Try again later.' }
const kinds = ['code', 'text', 'plain'] as const
const errorPaths = ['door', 'doorModern', 'derived', 'inApp', 'runTool', 'approved'] as const
test.each(errorPaths.flatMap((path) => kinds.map((kind) => [path, kind] as const)))(
  'upstream error on the %s path (%s): the host sees only the static failure',
  async (path, kind) => {
    const s = await setup()
    const input = { projectId: s.p[0], kind }
    if (path === 'door') {
      const http = mcpClient(s.t)
      const { raw, body } = await http.mcp(tokenFor(s.principal), 'tools/call', {
        name: 'leak_project',
        arguments: input,
      })
      expect(body.result.structuredContent).toEqual({ error: failed })
      expect(body.result.isError).toBe(true)
      expect(raw).not.toContain(canary)
    }
    if (path === 'doorModern') {
      // The 2026-07-28 transport, with the real SDK client, through convex-test's HTTP router.
      const client = new Client(
        { name: 'doors-client', version: '1.0.0' },
        { versionNegotiation: { mode: { pin: '2026-07-28' } } },
      )
      let raw = ''
      const transport = new StreamableHTTPClientTransport(
        new URL('https://door.example.test/mcp'),
        {
          requestInit: { headers: { authorization: `Bearer ${tokenFor(s.principal)}` } },
          fetch: async (url, init) => {
            const request = new Request(url, init)
            const response = await s.t.fetch(new URL(request.url).pathname, {
              method: request.method,
              headers: request.headers,
              body: request.method === 'POST' ? await request.text() : undefined,
            })
            if (request.headers.get('mcp-method') === 'tools/call')
              raw = await response.clone().text()
            return response
          },
        },
      )
      await client.connect(transport)
      const result = await client.callTool({ name: 'leak_project', arguments: input })
      await client.close()
      expect(result).toMatchObject({ isError: true, structuredContent: { error: failed } })
      expect(raw).not.toContain(canary)
    }
    if (path === 'derived') {
      const error = await s.tool('leak_project', input).then(
        () => null,
        (e: unknown) => e,
      )
      expect(toolFailure(error)).toEqual(failed)
    }
    if (path === 'inApp') {
      const runId = await inAppRun(s)
      const error = await s.t
        .mutation(api.tools.leak_project, { caller: { door: 'app', runId, turn: 2 }, input })
        .then(
          () => null,
          (e: unknown) => e,
        )
      expect(toolFailure(error)).toEqual(failed)
    }
    if (path === 'runTool') {
      const result = await runToolSafely(() => s.tool('leak_project', input) as never, {
        name: 'leak_project',
      })
      expect(result).toEqual({
        content: [{ type: 'text', text: 'Tool execution failed' }],
        isError: true,
      })
    }
    if (path === 'approved') {
      const asked = await s.ask('leak_approved', input)
      const outcome = await s.ann.mutation(api.tools.approve, { approvalId: asked.approvalId })
      expect(outcome).toEqual({ status: 'failed', error: failed })
      const [row] = await s.approvalRows()
      expect(row).toMatchObject({ status: 'failed', error: failed })
      const activity = await s.t.run((ctx) => ctx.db.query('activity').collect())
      expect(JSON.stringify([row, activity])).not.toContain(canary)
    }
    expect(await nameOf(s, s.p[0]!)).toBe('alpha')
  },
)

// Control for the table above: the same doors succeed for a tool that does not fail.
test('control: the tool that does not fail succeeds on the door, the derived tool and in-app', async () => {
  const s = await setup()
  const doors = await viaDoors(s, 'ann')
  for (const path of paths)
    expect(await doors[path]('touch_project', { projectId: s.p[0], name: path })).toBe('ok')
})

// Catches: a limited action that is limited on one agent door only. `projects.touch` is 2 a
// minute per connection. 8.limits-and-audit.md: "An agent's call is limited like a person's".
test.each(paths)('limit on the %s path: 2 calls pass, the 3rd is RATE_LIMITED', async (path) => {
  const s = await setup()
  const doors = await viaDoors(s, 'ann')
  const touch = (name: string) => doors[path]('touch_project', { projectId: s.p[0], name })
  const tokens = async () =>
    (await buckets(s))
      .filter((row) => row.key.endsWith('limit:projects.touch'))
      .map((r) => r.tokens)
  expect(await touch('n1')).toBe('ok')
  expect(await tokens()).toEqual([1])
  expect(await touch('n2')).toBe('ok')
  expect(await tokens()).toEqual([0])
  expect(await touch('n3')).toBe('RATE_LIMITED')
  expect(await tokens()).toEqual([0])
  expect(await nameOf(s, s.p[0]!)).toBe('n2')
})

// Catches: the agent write budget (60 a minute per connection) missing on one door.
// 3.limits.md: "Writes per agent connection: 60 a minute".
test.each(paths)(
  'write budget on the %s path: 60 writes pass, the 61st is RATE_LIMITED',
  async (path) => {
    const s = await setup()
    const doors = await viaDoors(s, 'ann')
    const rename = (name: string) => doors[path]('rename_project', { projectId: s.p[0], name })
    for (let i = 0; i < 60; i++) expect(await rename(`n${i}`)).toBe('ok')
    expect(await rename('one more')).toBe('RATE_LIMITED')
    expect(await nameOf(s, s.p[0]!)).toBe('n59')
    expect(
      (await buckets(s)).filter((row) => row.key.endsWith('|writes')).map((r) => r.tokens),
    ).toEqual([0])
  },
)

// Contract difference. 8.limits-and-audit.md: "a request that waits for approval takes no token, and
// neither does the run after the person approves it ... The request still counts against the
// agent's 60 writes a minute." So: each request takes a write, the approved run takes none, and
// neither takes a token of the policy's limits (`projects.archive` and `projects.export`: 1 a
// minute for everyone; the approved archive reaches a small export that an agent runs alone).
test('the approved path takes no limit token and no write: only the request counts a write', async () => {
  const s = await setup()
  const writes = async () =>
    (await buckets(s)).filter((row) => row.key.endsWith('|writes')).map((r) => r.tokens)
  const archive = await s.ask('archive_project', { projectId: s.p[0] })
  const exporting = await s.ask('archive_exporting', { projectId: s.p[2] })
  expect(await writes()).toEqual([58])
  // Use up the rest of the budget: the approved runs must still go through.
  for (let i = 0; i < 58; i++) await s.tool('rename_project', { projectId: s.p[1], name: `n${i}` })
  await expect(s.tool('rename_project', { projectId: s.p[1], name: 'x' })).rejects.toThrow(
    /RATE_LIMITED/,
  )
  for (const asked of [archive, exporting])
    expect(await s.ann.mutation(api.tools.approve, { approvalId: asked.approvalId })).toEqual({
      status: 'approved',
    })
  expect(await nameOf(s, s.p[1]!)).toBe('n57')
  expect(await nameOf(s, s.p[2]!)).toBe('exported')
  expect(await writes()).toEqual([0])
  expect(
    (await buckets(s)).filter((row) => /limit:projects\.(?:archive|export)$/.test(row.key)),
  ).toEqual([])
})

// Catches: an audited action leaving no row, or a wrong actor, on one agent door. The agent is the
// actor, also when a person approved the run. 8.limits-and-audit.md: "an agent's tool call (also
// when a person approved it)".
const actors = { door: 'mcp', derived: 'mcp', inApp: 'app' } as const
test.each(paths)('audit on the %s path: one row with the agent as actor', async (path) => {
  const s = await setup()
  const doors = await viaDoors(s, 'ann')
  expect(await doors[path]('touch_project', { projectId: s.p[0], name: 'once' })).toBe('ok')
  expect(await audit(s)).toMatchObject([
    {
      action: 'projects.touch',
      actor: { kind: 'agent', door: actors[path] },
      tenantId: s.a,
      rows: [s.p[0]],
      more: 0,
    },
  ])
})

test('audit on the approved path: the request writes no row, the approved run writes one', async () => {
  const s = await setup()
  const asked = await s.ask('archive_project', { projectId: s.p[0] })
  expect(await audit(s)).toEqual([])
  await s.ann.mutation(api.tools.approve, { approvalId: asked.approvalId })
  expect(await audit(s)).toMatchObject([
    {
      action: 'projects.archive',
      actor: { kind: 'agent', door: 'mcp' },
      tenantId: s.a,
      rows: [s.p[0]],
      more: 0,
    },
  ])
})

// A hand-written server (`handleMcpRequest`), on both transports. 4.mcp.md: "These helpers cover
// only the callbacks that use them. They do not change the SDK's own input and output validation
// errors, resources, or callbacks that do not use them." So: a tool that goes through
// `tools.runTool` is safe; a tool that does not, and a resource callback, show their message (the
// documented limit, catalogue r1:x). The cells pin both sides, so a change to either is seen.
const endpoint = new URL('https://notes.example.test/mcp')
const handWritten: HandleMcpRequestOptions = {
  resource: endpoint,
  serverInfo: { name: 'hand-written', version: '1' },
  authorization: {
    mode: 'preconfigured-bearer',
    issuer: 'https://issuer.example.test/',
    verifier: {
      async verifyAccessToken() {
        return {
          access: {
            issuer: 'https://issuer.example.test/',
            resource: endpoint.href,
            subject: 'someone',
            clientId: 'client',
            scopes: ['notes:read'],
          },
          expiresAt: Math.floor(Date.now() / 1000) + 300,
        }
      },
    },
  },
  configureServer({ server, tools }) {
    server.registerTool('guarded', { inputSchema: z.object({}) }, () =>
      tools.runTool('guarded', () => {
        throw new Error(canary)
      }),
    )
    server.registerTool('unguarded', { inputSchema: z.object({}) }, () => {
      throw new Error(canary)
    })
    server.registerResource('note', 'note://example', {}, () => {
      throw new Error(canary)
    })
  },
}
test.each(['2026-07-28', '2025-06-18'] as const)(
  'a hand-written server on transport %s: runTool hides the message, the rest does not',
  async (version) => {
    const client = new Client(
      { name: 'doors-client', version: '1.0.0' },
      version === '2026-07-28' ? { versionNegotiation: { mode: { pin: version } } } : undefined,
    )
    await client.connect(
      new StreamableHTTPClientTransport(endpoint, {
        requestInit: { headers: { authorization: 'Bearer token' } },
        fetch: async (url, init) => handleMcpRequest(new Request(url, init), handWritten),
      }),
    )
    const text = (result: { content: unknown }) =>
      (result.content as { text: string }[]).map((part) => part.text)
    const guarded = await client.callTool({ name: 'guarded', arguments: {} })
    expect(guarded).toMatchObject({ isError: true })
    expect(text(guarded as never)).toEqual(['Tool execution failed'])
    const unguarded = await client.callTool({ name: 'unguarded', arguments: {} })
    expect(text(unguarded as never)).toEqual([canary])
    await expect(client.readResource({ uri: 'note://example' })).rejects.toThrow(canary)
    await client.close()
  },
)

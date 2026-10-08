import { defineTools } from '@lupinum/better-convex-agents'
import { toolFailure } from '@lupinum/better-convex-agents/internal'
import { createMcpServer } from '@lupinum/better-convex-agents/mcp'
import { grantMcp } from '@lupinum/better-convex-nuxt/better-auth/test'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import type { FunctionReference } from 'convex/server'
import { ConvexError, v } from 'convex/values'
import { expect, test, vi } from 'vitest'

import { maximumMcpResponseBytes } from '../../src/transport'
import { doorAuth, refs, tokenFor } from '../support'
import { tools } from './agents'
import { fns, query } from './fns'
import * as projects from './projects'
import { fn, setup } from './setup'
import * as shapes from './shapes'

// The MCP door, end to end through convex-test's HTTP router with the real
// MCP SDK; only token verification is faked. Each test names the STRESS.md
// row whose break it keeps fixed.

const op = (name: string, args: Record<string, any> = {}) =>
  query({
    action: 'projects.search',
    args,
    returns: v.null(),
    tool: { name, description: 'x' },
    handler: async () => null,
  })

test('the door lists the tools of a read and write grant', async () => {
  const { mcp } = await setup()
  const listed = await mcp('ann:read,write', 'tools/list')
  expect(listed.status, listed.raw).toBe(200)
  expect(listed.body.result.tools.map((t: { name: string }) => t.name).sort()).toEqual([
    'archive_project',
    'attach_file',
    'check_approval',
    'create_project',
    'echo_shapes',
    'large_report',
    'list_broken',
    'list_projects',
    'quoted_report',
    'rows_report',
  ])
  // Round 1 review: a write without an approve rule was published as non-destructive.
  const annotations = Object.fromEntries(
    listed.body.result.tools.map((t: { name: string; annotations: unknown }) => [
      t.name,
      t.annotations,
    ]),
  )
  expect(annotations.create_project).toEqual({
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  })
  expect(annotations.list_projects).toEqual({ readOnlyHint: true, openWorldHint: false })
})

// G1: a read-only grant saw every tool, including writes it can never call.
test('a read-only grant lists only read tools', async () => {
  const { mcp } = await setup()
  const listed = await mcp('ann:read', 'tools/list')
  expect(listed.body.result.tools.map((t: { name: string }) => t.name).sort()).toEqual([
    'check_approval',
    'echo_shapes',
    'list_broken',
    'list_projects',
  ])
})

// C5: a numeric request_id was dropped, so a retry created a second project.
test('a numeric request_id still deduplicates', async () => {
  const { t, call, a } = await setup()
  await call('ann:write', 'create_project', { orgId: a, name: 'Once', request_id: 7 })
  const again = await call('ann:write', 'create_project', { orgId: a, name: 'Once', request_id: 7 })
  expect(again.body.result.structuredContent.status).toBe('done')
  const names = (await t.run((ctx) => ctx.db.query('projects').collect())).map((p) => p.name)
  expect(names.filter((name) => name === 'Once')).toHaveLength(1)
})

// D1: a request_id that was neither string nor number was dropped, so a retry ran again.
test.each([[{ a: 1 }], [true], [['x']], [null]])(
  'request_id %j is refused, not dropped',
  async (request_id) => {
    const { t, call, a } = await setup()
    const { body } = await call('ann:write', 'create_project', {
      orgId: a,
      name: 'Once',
      request_id,
    })
    expect(body.result).toMatchObject({
      isError: true,
      structuredContent: {
        error: {
          code: 'INVALID_INPUT',
          message: 'request_id must be a string or number. Fix it, or leave it out.',
        },
      },
    })
    expect(await t.run((ctx) => ctx.db.query('projects').collect())).toHaveLength(1)
  },
)

// D2: an app tool in no scope was listed for every grant (its calls were refused).
test('a tool whose action is in no scope fails at definition', () => {
  const unscoped = query({
    action: 'projects.unscoped',
    args: {},
    returns: v.null(),
    tool: { name: 'orphan', description: 'x' },
    handler: async () => null,
  })
  expect(() => defineTools(fns, { m: { x: unscoped } }, { functions: refs('agents') })).toThrow(
    'Tool orphan: its action projects.unscoped is in no scope.',
  )
})

// Keep: next to the refused request_id values, a string one runs and deduplicates.
test('a string request_id runs once and its retry replays', async () => {
  const { t, call, a } = await setup()
  const args = { orgId: a, name: 'Once', request_id: 'abc' }
  await call('ann:write', 'create_project', args)
  const again = await call('ann:write', 'create_project', args)
  expect(again.body.result.structuredContent.status).toBe('done')
  const names = (await t.run((ctx) => ctx.db.query('projects').collect())).map((p) => p.name)
  expect(names.filter((name) => name === 'Once')).toHaveLength(1)
})

// Catches: a tool whose action is missing, misspelled or in no scope reaching a host. The first row
// is the control: a scoped action defines fine and is listed.
test.each([
  ['control: a scoped action', 'projects.search', null],
  ['a missing action', undefined, /Operation action undefined is not in the policy's actions/],
  [
    'a misspelled action',
    'projects.serach',
    /Operation action "projects\.serach" is not in the policy's actions/,
  ],
  [
    'an action in no scope',
    'projects.unscoped',
    'Tool probe: its action projects.unscoped is in no scope.',
  ],
])('a tool with %s fails closed at definition', (_name, action, message) => {
  const define = () => {
    const probe = query({
      action: action as never,
      args: {},
      returns: v.null(),
      tool: { name: 'probe', description: 'x' },
      handler: async () => null,
    })
    return defineTools(fns, { m: { probe } }, { functions: refs('agents') })
  }
  if (message === null) expect(define().catalog.map((entry) => entry.name)).toContain('probe')
  else expect(define).toThrow(message)
})

// C4: a committed write with a large result got HTTP 502; only the replay was cut short.
test('a large first result is cut short like a replay, not refused', async () => {
  const { t, call, a } = await setup()
  const args = { orgId: a, size: 600_000, request_id: 'big' }
  const first = await call('ann:write', 'large_report', args)
  expect(first.status).toBe(200)
  expect(first.body.result.structuredContent).toEqual({
    status: 'done',
    result: { truncated: true, bytes: expect.any(Number) },
  })
  const replay = await call('ann:write', 'large_report', args)
  expect(replay.body.result.structuredContent).toEqual(first.body.result.structuredContent)
  expect(await t.run((ctx) => ctx.db.query('projects').collect())).toHaveLength(2)
})

// Review: the size check missed that the text is escaped a second time in the JSON-RPC response (HTTP 502 after commit),
// and its reserve cut results that fit before.
test.each([
  ['quote-heavy text', 'quoted_report', { size: 200_000 }, 'cut'],
  ['5,700 ordinary rows', 'rows_report', { count: 5_700 }, 'cut'],
  ['5,000 ordinary rows', 'rows_report', { count: 5_000 }, 'whole'],
  ['520,000 characters of text', 'large_report', { size: 520_000 }, 'whole'],
])(
  'a result of %s gets a marker or arrives whole, never HTTP 502',
  async (_name, tool, args, outcome) => {
    const { t, call, a } = await setup()
    const first = await call('ann:write', tool, { orgId: a, ...args, request_id: 'size' })
    expect(first.status).toBe(200)
    const { result } = first.body.result.structuredContent
    if (outcome === 'cut') expect(result).toEqual({ truncated: true, bytes: expect.any(Number) })
    else expect(result).not.toHaveProperty('truncated')
    expect(await t.run((ctx) => ctx.db.query('projects').collect())).toHaveLength(2)
  },
)

// Review: the size check reserved a fixed 256 bytes for the JSON-RPC envelope, so a long string id got
// HTTP 502 after commit and a short id cut a result that fit. The check counts the response as sent,
// in both protocol eras; the largest result that fits is sent whole, one character more gets the marker.
test.each([
  ['2025, numeric id', '2025', 1],
  ['2025, string id of 1,000 characters', '2025', 'i'.repeat(1_000)],
  ['2026', '2026', 1],
])('the largest result that fits is sent whole (%s)', async (_name, era, id) => {
  const { t, a } = await setup()
  const token = tokenFor(await grantMcp(t, 'ann', ['write']))
  let n = 0
  const send = async (size: number) => {
    const args = { orgId: a, size, request_id: `r${n++}` }
    let raw = ''
    let status = 0
    if (era === '2025') {
      const response = await t.fetch('/mcp', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-protocol-version': '2025-06-18',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id,
          method: 'tools/call',
          params: { name: 'large_report', arguments: args },
        }),
      })
      raw = await response.text()
      status = response.status
    } else {
      const client = new Client(
        { name: 'size-client', version: '1.0.0' },
        { versionNegotiation: { mode: { pin: '2026-07-28' } } },
      )
      const transport = new StreamableHTTPClientTransport(
        new URL('https://door.example.test/mcp'),
        {
          requestInit: { headers: { authorization: `Bearer ${token}` } },
          fetch: async (input, init) => {
            const request = new Request(input, init)
            const response = await t.fetch(new URL(request.url).pathname, {
              method: request.method,
              headers: request.headers,
              body: request.method === 'POST' ? await request.text() : undefined,
            })
            if (request.headers.get('mcp-method') === 'tools/call') {
              raw = await response.clone().text()
              status = response.status
            }
            return response
          },
        },
      )
      await client.connect(transport)
      await client.callTool({ name: 'large_report', arguments: args })
      await client.close()
    }
    return { status, raw, whole: !raw.includes('"truncated":true') }
  }
  // The text and `structuredContent` both carry the result, so each 'y' costs two bytes.
  const probe = await send(400_000)
  expect(probe).toMatchObject({ status: 200, whole: true })
  const edge =
    400_000 +
    Math.floor((maximumMcpResponseBytes - new TextEncoder().encode(probe.raw).byteLength) / 2)
  const fits = await send(edge)
  expect(fits.whole).toBe(true)
  expect(maximumMcpResponseBytes - new TextEncoder().encode(fits.raw).byteLength).toBeLessThan(2)
  const over = await send(edge + 1)
  expect(over).toMatchObject({ status: 200, whole: false })
})

// Review: an argument like `v.union(v.id('_storage'), v.null())` failed on every call (`normalizeId` throws for system tables).
test('a tool with a nullable storage ID argument accepts an ID and null', async () => {
  const { t, call, a } = await setup()
  const file = await t.run((ctx) => ctx.storage.store(new Blob(['x'])))
  for (const [input, result] of [
    [{ file: null }, 'none'],
    [{ file }, 'file'],
  ] as const) {
    const { body } = await call('ann:write', 'attach_file', { orgId: a, ...input })
    expect(body.result.structuredContent).toEqual({ status: 'done', result })
  }
})

// Review: Convex reports an invalid cursor as a `ConvexError` system error, which the hint no longer named.
test('an invalid cursor reported as a ConvexError system error is named', async () => {
  const { call, a } = await setup()
  const { body } = await call('ann:read', 'list_broken', { orgId: a, cursor: 'page-2' })
  expect(body.result.structuredContent.error).toMatchObject({
    code: 'INVALID_INPUT',
    message: expect.stringMatching(/^cursor:/),
  })
})

// G2, H9: wrong input answered "Value does not match validator." with no field, or a generic failure.
test.each([
  [{ name: 5 }, 'name: expected a string.'],
  [{}, 'name: required.'],
  [{ name: 'x', colour: 'red' }, 'colour: unknown field. Leave it out.'],
  [{ name: 'x', $schema: 'tool' }, '$schema: unknown field. Leave it out.'],
])('wrong input %j is named in the error', async (input, message) => {
  const { call, a } = await setup()
  const { body } = await call('ann:write', 'create_project', { orgId: a, ...input })
  expect(body.result).toMatchObject({
    isError: true,
    structuredContent: { error: { code: 'INVALID_INPUT', message } },
  })
})

// E8: null for an optional field failed; every JSON shape must reach the handler.
test('every JSON shape reaches the handler, and null means "left out"', async () => {
  const { call, pa } = await setup()
  for (const args of [
    { text: 'hi' },
    { text: null },
    { kind: 'a' },
    { either: 3 },
    { tags: { a: 1 } },
    { nested: { inner: { flag: true, note: null } } },
    { list: [pa] },
    { nothing: null },
    { anything: { x: [1] } },
  ]) {
    const { body } = await call('ann:read', 'echo_shapes', args)
    expect(body.result.structuredContent?.status, JSON.stringify(args)).toBe('done')
  }
  const { body } = await call('ann:read', 'echo_shapes', { kind: 'c' })
  expect(body.result.structuredContent.error.message).toBe('kind: expected one of "a", "b".')
})

// E8: int64, bytes and bigint literals published schemas no JSON value can satisfy.
test.each([
  ['count', v.int64(), /v.int64/],
  ['blob', v.bytes(), /v.bytes/],
  ['big', v.literal(5n), /bigint literal/],
])('a tool argument %s that JSON cannot carry fails at definition', (name, validator, message) => {
  expect(() =>
    defineTools(fns, { m: { x: op('bad', { [name]: validator }) } }, { functions: refs('agents') }),
  ).toThrow(message)
})

// Release review: a query tool could declare request_id, which the dispatch takes out of each
// call, so every call failed with INVALID_INPUT.
test('a tool argument named request_id fails at definition, for queries too', () => {
  expect(() =>
    defineTools(
      fns,
      { m: { x: op('lookup', { request_id: v.string() }) } },
      { functions: refs('agents') },
    ),
  ).toThrow('lookup: the argument name request_id is reserved for retry keys. Rename the argument.')
})

// E5: names hosts reject passed defineTools.
test.each(['create project', `t${'x'.repeat(64)}`, 'créer_projet', 'projects.create'])(
  'the tool name %j fails at definition',
  (name) => {
    expect(() => defineTools(fns, { m: { x: op(name) } }, { functions: refs('agents') })).toThrow(
      /Tool name/,
    )
  },
)

// E9: the paginated tool exposed Convex's internal pagination fields and required a cursor.
test('a paginated operation pages on the web with paginationOpts and for agents with cursor and next', async () => {
  const { t, ann, call, a } = await setup()
  await t.run(async (ctx) => {
    for (const name of ['A two', 'A three'])
      await ctx.db.insert('projects', { orgId: a, name, status: 'active' })
  })
  const web = await ann.query(fn('projects:page'), {
    orgId: a,
    paginationOpts: { numItems: 2, cursor: null },
  })
  expect(web.page).toHaveLength(2)

  const schema = tools.catalog.find((entry) => entry.name === 'list_projects')!.inputSchema as {
    properties: object
    required: string[]
  }
  expect(Object.keys(schema.properties)).toEqual(['orgId', 'cursor', 'limit'])
  expect(schema.required).toEqual(['orgId'])
  const first = (await call('ann:read', 'list_projects', { orgId: a, limit: 2 })).body.result
    .structuredContent.result
  expect(first.items).toHaveLength(2)
  const second = (
    await call('ann:read', 'list_projects', { orgId: a, limit: 2, cursor: first.next })
  ).body.result.structuredContent.result
  expect(second).toEqual({ items: [expect.objectContaining({ name: 'A three' })], next: null })
})

// Live: a model sent a made-up cursor; Convex's uncoded error told it only "the tool failed", so it kept retrying.
test.each([
  ['', 'done'],
  ['null', 'done'],
  ['None', 'done'],
  ['page-2', 'error'],
])('a cursor %j from a model gives %s', async (cursor, outcome) => {
  const { call, a } = await setup()
  const { body } = await call('ann:read', 'list_projects', { orgId: a, cursor })
  if (outcome === 'done') expect(body.result.structuredContent.status).toBe('done')
  else
    expect(body.result.structuredContent.error).toMatchObject({
      code: 'INVALID_INPUT',
      message: expect.stringMatching(/^cursor:/),
    })
})

// D8: a 3 MiB argument answered HTTP 500 / 520.
test('a request body over the limit is refused with 413 before any work', async () => {
  const { call, a } = await setup()
  const { status } = await call('ann:write', 'create_project', {
    orgId: a,
    name: 'x'.repeat(2 << 20),
  })
  expect(status).toBe(413)
})

// G10: through the real door, a project name carried a fake link into the approval text.
test('the approval text an MCP host shows carries no live markdown from row data', async () => {
  const { t, call, a } = await setup()
  const projectId = await t.run((ctx) =>
    ctx.db.insert('projects', {
      orgId: a,
      name: 'Old".\n\n[Approve here](https://evil.example)',
      status: 'active',
    }),
  )
  const asked = await call('ann:write', 'archive_project', { projectId })
  const [text] = asked.body.result.content
  expect(text.text).toMatch(/^A person must approve this first: /)
  expect(text.text).not.toContain('\n')
  expect(text.text).not.toMatch(/(?<!\\)\]\((?!.*\/approvals\/)/)
  expect(asked.body.result.structuredContent.url).toMatch(
    /^https:\/\/placeholder\.example\/approvals\//,
  )
})

// X2: a forgotten export must fail when the module loads, naming the fix.
test('a tool without its export fails at load with the missing name', () => {
  const tools = defineTools(fns, { projects, shapes }, { functions: refs('agents') })
  const { echo_shapes: _forgotten, ...exported } = tools.functions
  expect(() => createMcpServer(doorAuth, { name: 'x', agents: { tools, ...exported } })).toThrow(
    'Not exported from the agents module: echo_shapes. Add them to `export const { echo_shapes } = tools.functions`.',
  )
})

// E17 (tools): a wrong `functions` module loaded fine and every call failed with nothing in the logs.
test('a tool whose function does not exist fails with a hint in the log', async () => {
  const { t, a } = await setup()
  const wrong = defineTools(fns, { projects, shapes }, { functions: refs('projects') })
  const app = { tools: wrong, ...wrong.functions }
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  const handler = createMcpServer(doorAuth, { name: 'x', agents: app })
  expect(handler).toBeTruthy()
  const entry = wrong.catalog.find((e) => e.name === 'create_project')!
  const caller = { door: 'mcp' as const, principal: await grantMcp(t, 'ann', ['write']) }
  const failure = await t
    .mutation(entry.ref as FunctionReference<'mutation', 'internal'>, {
      caller,
      input: { orgId: a, name: 'x' },
    })
    .then(() => null, toolFailure)
  expect(failure).toEqual({ code: 'FAILED', message: 'The tool failed. Try again later.' })
  expect(String(error.mock.calls[0]?.[0])).toMatch(
    /must be internal.<the module that calls defineTools>/,
  )
  error.mockRestore()
})

// X5: no activity feed; agent rows carried no tenant.
test('agent writes appear in the tenant activity feed; non-members cannot read it', async () => {
  const { ann, bob, call, a } = await setup()
  await call('ann:write', 'create_project', { orgId: a, name: 'By agent' })
  const feed = await ann.query(fn('agents:activity'), { tenantId: a })
  expect(feed).toEqual([
    expect.objectContaining({ action: 'projects.create', tool: 'create_project', status: 'done' }),
  ])
  await expect(bob.query(fn('agents:activity'), { tenantId: a })).rejects.toThrow(/NOT_FOUND/)
})

// G1 for MCP calls by name: a tool outside the grant is refused, even when its name is guessed.
test('a read-only grant cannot call a write tool by name', async () => {
  const { call, a } = await setup()
  const { body } = await call('ann:read', 'create_project', { orgId: a, name: 'x' })
  expect(JSON.stringify(body)).toMatch(/not found|FORBIDDEN|Tool create_project/i)
})

// S14: revoking a connection was only checked live. Its open requests must not stay approvable, and
// its access token, still valid for minutes, must not reach a tool.
test('revoking a connection cancels its open requests, and its tools then fail', async () => {
  const { t, ann, call, a, pa } = await setup()
  const asked = await call('ann:write', 'archive_project', { projectId: pa })
  const { approvalId } = asked.body.result.structuredContent
  await ann.mutation(fn('connections:revoke'), { clientId: 'test-host' })

  expect(await t.run((ctx) => ctx.db.get(approvalId))).toMatchObject({ status: 'cancelled' })
  expect(await ann.query(fn('agents:pending'), {})).toEqual([])
  // E15: a coded failure the web client can switch on.
  await expect(ann.mutation(fn('agents:approve'), { approvalId })).rejects.toMatchObject({
    data: { code: 'APPROVAL_NOT_FOUND' },
  })
  const { body } = await call('ann:write', 'create_project', { orgId: a, name: 'After revoke' })
  expect(body.result).toMatchObject({
    isError: true,
    structuredContent: { error: { code: 'AGENT_DISABLED' } },
  })
  expect(await t.run((ctx) => ctx.db.get(pa))).toMatchObject({ status: 'active' })
})

// F2: without SITE_URL an approval link was relative, which no MCP host can open. An in-app agent
// asks: an MCP call would fail earlier, since Better Auth needs SITE_URL for its issuer.
test('asking for approval without SITE_URL fails and names the variable', async () => {
  const { t, pa } = await setup()
  const runId = await t.run(async (ctx) => {
    const userId = (await ctx.db.query('users').first())!._id
    const grantId = await ctx.db.insert('agentGrants', {
      authId: 'ann',
      userId,
      agent: 'helper',
      scopes: ['write'],
      expiresAt: Date.now() + 86_400_000,
    })
    return await ctx.db.insert('agentRuns', {
      grantId,
      userId,
      agent: 'helper',
      step: 'agent:step',
      task: 'archive',
      status: 'running',
      turn: 1,
      steps: 1,
      stepAt: Date.now(),
    })
  })
  const caller = { door: 'app', runId, turn: 1 }
  vi.stubEnv('SITE_URL', '')
  await expect(
    t.mutation(fn('agents:archive_project'), { caller, input: { projectId: pa } }),
  ).rejects.toThrow(/Set the SITE_URL environment variable/)
  vi.unstubAllEnvs()
})

// Catches: a dependency's ConvexError with its own code and private text reaching the model.
test.each([
  [
    { code: 'FORBIDDEN', message: 'You may not.' },
    { code: 'FORBIDDEN', message: 'You may not.' },
  ],
  [
    { code: 'UPSTREAM_INTERNAL', message: 'private-api-key' },
    { code: 'FAILED', message: 'The tool failed. Try again later.' },
  ],
  [
    { code: 'toString', message: 'x' },
    { code: 'FAILED', message: 'The tool failed. Try again later.' },
  ],
])('a tool error with data %j reaches the agent as %j', (data, expected) => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  expect(toolFailure(new ConvexError(data))).toEqual(expected)
  error.mockRestore()
})

// E6: a wrapper that dropped `action` (or cast a typo past the types) failed only at the first call;
// an `approve` rule on a query was silently ignored (API review).
test.each([
  ['projects.serch', /not in the policy's actions/],
  ['projects.archive', /cannot wait for approval/],
])('a query with the action %j fails at definition', (action, message) => {
  expect(() =>
    query({ action: action as never, args: {}, returns: v.null(), handler: async () => null }),
  ).toThrow(message)
})

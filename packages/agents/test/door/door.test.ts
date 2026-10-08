import { defineTools } from '@lupinum/better-convex-agents'
import { toolFailure } from '@lupinum/better-convex-agents/internal'
import { createMcpServer } from '@lupinum/better-convex-agents/mcp'
import { grantMcp } from '@lupinum/better-convex-nuxt/better-auth/test'
import type { FunctionReference } from 'convex/server'
import { ConvexError, v } from 'convex/values'
import { expect, test, vi } from 'vitest'

import { doorAuth, refs } from '../support'
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
    'check_approval',
    'create_project',
    'echo_shapes',
    'list_projects',
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

import { grantMcp } from '@lupinum/better-convex-nuxt/better-auth/test'
import { expect, test } from 'vitest'

import { checkUploads } from '../../src/uploads'
import { fn, setup } from './setup'

// Upload links for agents, end to end: `request_upload` through the MCP door, the bytes through
// `uploadRoute` on convex-test's HTTP router, and `claimUpload` inside an operation (`take_upload`).
// The fixture's links take a PDF or CSV of up to 1 KiB to connections with the `write` scope.

const pdf = '%PDF-1.7\n1 0 obj\n<<>>\nendobj\n'
const csv = 'date;amount\n2026-07-01;-12,50\n'

type Setup = Awaited<ReturnType<typeof setup>>

async function links(call: Setup['call'], who: string, count?: number) {
  const { body } = await call(who, 'request_upload', count === undefined ? {} : { count })
  return body.result.structuredContent as
    | { status: 'done'; result: { url: string; tokens: string[]; maxBytes: number } }
    | { error: { code: string; message: string } }
}

async function send(t: Setup['t'], url: string, token: string, body: BodyInit) {
  const response = await t.fetch(new URL(url).pathname, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body,
  })
  return { status: response.status, body: await response.json() }
}

const stored = (t: Setup['t']) => t.run((ctx) => ctx.db.system.query('_storage').collect())

async function upload(s: Setup, who: string, body: BodyInit) {
  const issued = await links(s.call, who)
  if (!('result' in issued)) throw new Error(JSON.stringify(issued))
  const sent = await send(s.t, issued.result.url, issued.result.tokens[0]!, body)
  expect(sent.status, JSON.stringify(sent.body)).toBe(201)
  return sent.body as { uploadId: string; type: string; size: number; sha256: string }
}

const take = async (s: Setup, who: string, uploadId: string, extra = {}) =>
  (await s.call(who, 'take_upload', { orgId: s.a, uploadId, ...extra })).body.result
    .structuredContent

test('an agent sends a file through a link and a write takes it once', async () => {
  const s = await setup()
  const sent = await upload(s, 'ann:write', pdf)
  expect(sent).toMatchObject({ type: 'application/pdf', size: pdf.length })
  expect(sent.sha256).toMatch(/^[0-9a-f]{64}$/)
  expect(await take(s, 'ann:write', sent.uploadId)).toEqual({
    status: 'done',
    result: { type: 'application/pdf', size: pdf.length, sha256: sent.sha256 },
  })
  // A second claim of the same upload finds nothing.
  expect((await take(s, 'ann:write', sent.uploadId)).error.code).toBe('NOT_FOUND')
  expect(await stored(s.t)).toHaveLength(1)
})

test('only a connection with an upload scope gets the tool', async () => {
  const s = await setup()
  const listed = async (who: string) =>
    (await s.mcp(who, 'tools/list')).body.result.tools.map((tool: { name: string }) => tool.name)
  expect(await listed('ann:write')).toContain('request_upload')
  expect(await listed('ann:read')).not.toContain('request_upload')
  // The function checks the scope too, for a caller that skips the catalog.
  const principal = await grantMcp(s.t, 'ann', ['read'])
  await expect(
    s.t.mutation(fn('agents:request_upload'), { caller: { door: 'mcp', principal }, input: {} }),
  ).rejects.toThrow(
    expect.objectContaining({ data: expect.objectContaining({ code: 'FORBIDDEN' }) }),
  )
  const write = await grantMcp(s.t, 'ann', ['write'])
  const done = await s.t.mutation(fn('agents:request_upload'), {
    caller: { door: 'mcp', principal: write },
    input: {},
  })
  expect(done.result.tokens).toHaveLength(1)
})

test('a token takes one file', async () => {
  const s = await setup()
  const issued = await links(s.call, 'ann:write')
  if (!('result' in issued)) throw new Error('no links')
  const { url, tokens } = issued.result
  expect((await send(s.t, url, tokens[0]!, pdf)).status).toBe(201)
  const again = await send(s.t, url, tokens[0]!, pdf)
  expect(again.status).toBe(401)
  expect(again.body.error.message).toMatch(/request_upload/)
  expect(await stored(s.t)).toHaveLength(1)
})

// Two files sent with one token at the same moment both pass the route's first check; the
// "stored" step must keep only the first. convex-test runs HTTP actions one at a time, so the step
// is called directly here.
test('a link turns into a stored file once, even when two files race', async () => {
  const s = await setup()
  const sent = await upload(s, 'ann:write', pdf)
  const row = await s.t.run(async (ctx) =>
    ctx.db.get(ctx.db.normalizeId('uploads', sent.uploadId)!),
  )
  const other = await s.t.run((ctx) => ctx.storage.store(new Blob([csv])))
  const second = await s.t.mutation(fn('agents:upload_stored'), {
    tokenHash: row!.tokenHash,
    storageId: other,
    type: 'text/csv',
    size: csv.length,
    sha256: 'x',
  })
  expect(second).toBeNull()
  const after = await s.t.run(async (ctx) => ctx.db.get(row!._id))
  expect(after).toMatchObject({ status: 'stored', type: 'application/pdf' })
})

test('the route keeps no file when its link was used while the bytes arrived', async () => {
  const s = await setup()
  const issued = await links(s.call, 'ann:write')
  if (!('result' in issued)) throw new Error('no links')
  let reading!: () => void
  const read = new Promise<void>((resolve) => (reading = resolve))
  let release!: () => void
  const held = new Promise<void>((resolve) => (release = resolve))
  const body = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        reading()
        await held
        controller.enqueue(new TextEncoder().encode(pdf))
        controller.close()
      },
    },
    { highWaterMark: 0 },
  )
  const sending = s.t.fetch('/mcp/upload', {
    method: 'POST',
    headers: { authorization: `Bearer ${issued.result.tokens[0]}` },
    body,
    duplex: 'half',
  } as RequestInit)
  // The route checked the token and reads the body; meanwhile another file takes the link.
  await read
  await s.t.run(async (ctx) => {
    for (const row of await ctx.db.query('uploads').collect())
      await ctx.db.patch(row._id, { status: 'stored' })
  })
  release()
  expect((await sending).status).toBe(401)
  expect(await stored(s.t)).toHaveLength(0)
})

test('one upload is claimed once, even by two claims in one transaction', async () => {
  const s = await setup()
  const sent = await upload(s, 'ann:write', pdf)
  const { body } = await s.call('ann:write', 'take_upload_twice', {
    orgId: s.a,
    uploadId: sent.uploadId,
  })
  expect(body.result.structuredContent).toEqual({ status: 'done', result: 1 })
})

test.each([
  '//other.example/upload',
  '/mcp/../upload',
  '/mcp upload',
  'mcp/upload',
  '/mcp/upload#x',
])('the uploads option refuses the path %s', (path) => {
  expect(() =>
    checkUploads({ scopes: ['write'], types: ['text/csv'], maxBytes: 1024, path }, ['write']),
  ).toThrow(/uploads\.path/)
})

test.each([
  ['bytes of no allowed type', new Uint8Array([0, 1, 2, 3, 4, 5]), 415],
  ['a PNG named like a PDF', new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), 415],
  ['a file over the limit', `%PDF-${'x'.repeat(1100)}`, 413],
  ['an empty body', '', 400],
])('the route refuses %s and stores nothing', async (_name, body, status) => {
  const s = await setup()
  const issued = await links(s.call, 'ann:write')
  if (!('result' in issued)) throw new Error('no links')
  const sent = await send(s.t, issued.result.url, issued.result.tokens[0]!, body as BodyInit)
  expect(sent.status).toBe(status)
  expect(await stored(s.t)).toHaveLength(0)
})

test.each([
  ['no token', ''],
  ['a made-up token', `Bearer bcu_${'0'.repeat(64)}`],
  ['an OAuth token', 'Bearer eyJhbGciOi'],
])('the route refuses %s', async (_name, authorization) => {
  const s = await setup()
  const response = await s.t.fetch('/mcp/upload', {
    method: 'POST',
    headers: authorization ? { authorization } : {},
    body: pdf,
  })
  expect(response.status).toBe(401)
  expect(await stored(s.t)).toHaveLength(0)
})

test('an expired link takes no file', async () => {
  const s = await setup()
  const issued = await links(s.call, 'ann:write')
  if (!('result' in issued)) throw new Error('no links')
  await s.t.run(async (ctx) => {
    for (const row of await ctx.db.query('uploads').collect())
      await ctx.db.patch(row._id, { expiresAt: Date.now() - 1 })
  })
  expect((await send(s.t, issued.result.url, issued.result.tokens[0]!, pdf)).status).toBe(401)
  expect(await stored(s.t)).toHaveLength(0)
})

test('a file waits for an allowed type and its claim window', async () => {
  const s = await setup()
  const mine = await upload(s, 'ann:write', csv)
  // A type the write does not take fails, and the file stays claimable.
  expect((await take(s, 'ann:write', mine.uploadId, { pdfOnly: true })).error.code).toBe(
    'INVALID_INPUT',
  )
  expect((await take(s, 'ann:write', mine.uploadId)).status).toBe('done')
  // A stored file past its claim window cannot be claimed.
  const late = await upload(s, 'ann:write', pdf)
  await s.t.run(async (ctx) => {
    const row = await ctx.db.get(ctx.db.normalizeId('uploads', late.uploadId)!)
    await ctx.db.patch(row!._id, { expiresAt: Date.now() - 1 })
  })
  expect((await take(s, 'ann:write', late.uploadId)).error.code).toBe('NOT_FOUND')
})

test('a handler cannot claim for another actor by changing ctx.actor', async () => {
  const s = await setup()
  const bobs = await upload(s, 'bob:write', pdf)
  const ownerKey = await s.t.run(
    async (ctx) => (await ctx.db.get(ctx.db.normalizeId('uploads', bobs.uploadId)!))!.owner.key,
  )
  const { body } = await s.call('ann:write', 'take_upload_as', {
    orgId: s.a,
    uploadId: bobs.uploadId,
    ownerKey,
  })
  expect(body.result.structuredContent.error.code).toBe('NOT_FOUND')
})

test('a connection may leave at most 100 links and files unclaimed', async () => {
  const s = await setup()
  for (let round = 0; round < 5; round++)
    expect('result' in (await links(s.call, 'ann:write', 20))).toBe(true)
  const over = await links(s.call, 'ann:write', 1)
  expect('error' in over && over.error.code).toBe('RATE_LIMITED')
  // Expired links no longer count, even before housekeeping deletes them.
  await s.t.run(async (ctx) => {
    for (const row of await ctx.db.query('uploads').collect())
      await ctx.db.patch(row._id, { expiresAt: Date.now() - 1 })
  })
  expect('result' in (await links(s.call, 'ann:write', 1))).toBe(true)
})

test('housekeeping deletes expired links and unclaimed files, and keeps claimed files', async () => {
  const s = await setup()
  await links(s.call, 'ann:write')
  const unclaimed = await upload(s, 'ann:write', pdf)
  const claimed = await upload(s, 'ann:write', csv)
  expect((await take(s, 'ann:write', claimed.uploadId)).status).toBe('done')
  const kept = await s.t.run(async (ctx) => {
    const row = await ctx.db.get(ctx.db.normalizeId('uploads', claimed.uploadId)!)
    return row!.storageId!
  })
  await s.t.run(async (ctx) => {
    for (const row of await ctx.db.query('uploads').collect())
      await ctx.db.patch(row._id, { expiresAt: Date.now() - 1 })
  })
  await s.t.mutation(fn('agents:housekeeping'), { cleanup: true })
  await s.t.finishAllScheduledFunctions(() => {})
  expect(await s.t.run((ctx) => ctx.db.query('uploads').collect())).toEqual([])
  expect((await stored(s.t)).map((file) => file._id)).toEqual([kept])
  expect(unclaimed.uploadId).not.toBe(claimed.uploadId)
})

test("a person cannot claim an agent's file; work a person approved can", async () => {
  const s = await setup()
  const sent = await upload(s, 'ann:write', pdf)
  // Ann signed in on the web is another actor than Ann's agent connection.
  await expect(
    s.ann.mutation(fn('projects:takeUpload'), { orgId: s.a, uploadId: sent.uploadId }),
  ).rejects.toMatchObject({ data: { code: 'NOT_FOUND' } })
  // The same connection asks; Ann approves; the approved work claims the file.
  const asked = (
    await s.call('ann:write', 'take_upload_approved', { projectId: s.pa, uploadId: sent.uploadId })
  ).body.result.structuredContent
  expect(asked.status).toBe('needs_approval')
  await s.ann.mutation(fn('agents:approve'), { approvalId: asked.approvalId })
  const checked = (await s.call('ann:write', 'check_approval', { approvalId: asked.approvalId }))
    .body.result.structuredContent
  expect(checked.result).toMatchObject({ status: 'approved', result: 'application/pdf' })
  expect((await take(s, 'ann:write', sent.uploadId)).error.code).toBe('NOT_FOUND')
})

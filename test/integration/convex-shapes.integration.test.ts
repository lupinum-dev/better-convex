// What only the real backend answers: the shapes of Convex's own errors and limits, which
// convex-test words differently, and what the library makes of them. Round 1 of the review
// recognised an invalid cursor by the shape convex-test throws, not the one Convex does, and
// called `normalizeId` on a system table that convex-test let through.
//
// The functions are in test/fixtures/mcp-oauth-agent/shapes.ts, copied into the starter copy
// that `startMcpFixture` deploys. They run as the deployment operator against an in-app agent
// run (`door: 'app'`), so no sign-in is needed.
import { copyFile } from 'node:fs/promises'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { isRecord, root, startMcpFixture, type McpFixture } from './harness'

describe('the library against the real Convex backend', () => {
  let fixture: McpFixture
  let world: {
    organizationId: string
    projectId: string
    runId: string
    otherRunId: string
    userId: string
  }

  beforeAll(async () => {
    fixture = await startMcpFixture({
      prepare: (cwd) =>
        copyFile(
          join(root, 'test/fixtures/mcp-oauth-agent/shapes.ts'),
          join(cwd, 'convex/shapes.ts'),
        ),
    })
    world = (await fixture.runConvex('shapes:setup', { email: fixture.email })) as typeof world
  })

  afterAll(async () => {
    await fixture?.release()
  })

  const caller = (runId = world.runId) => ({ door: 'app', runId, turn: 1 })
  /** A tool call as the MCP door makes it; resolves to `{ output }` or `{ failure }`. */
  async function tool(
    kind: 'query' | 'mutation',
    path: string,
    input: Record<string, unknown>,
    runId = world.runId,
  ) {
    const result = await fixture.runConvex('shapes:callTool', {
      kind,
      path,
      call: { caller: caller(runId), input },
    })
    // `convex run` prints the function's logs before its result, and a log line makes the whole
    // output a string: the result is the JSON object after the last log line.
    const parsed =
      typeof result === 'string'
        ? JSON.parse(result.slice(result.lastIndexOf('\n{\n') + 1))
        : result
    if (!isRecord(parsed)) throw new Error(`No tool result: ${JSON.stringify(result)}`)
    return parsed
  }

  it('names the cursor field when a model passes a cursor Convex refuses', async () => {
    const first = await tool('query', 'agents:search_projects', {
      organizationId: world.organizationId,
      limit: 1,
    })
    const next = (first.output as { result?: { next?: string } } | undefined)?.result?.next
    expect(next, JSON.stringify(first)).toEqual(expect.any(String))
    // A cursor that parses but belongs to another query: Convex throws a system `ConvexError`.
    // The first review round recognised only the plain error convex-test throws.
    expect(await fixture.runConvex('shapes:cursorShapes')).toEqual({
      name: 'ConvexError',
      data: { isConvexSystemError: true, paginationError: 'InvalidCursor' },
    })
    const hint = {
      failure: {
        code: 'INVALID_INPUT',
        message: expect.stringMatching(/^cursor: pass the `next` value/),
      },
    }
    expect(await tool('query', 'agents:list_organizations', { cursor: next })).toEqual(hint)
    // A cursor a model made up fails differently in Convex; the hint is the same.
    expect(
      await tool('query', 'agents:search_projects', {
        organizationId: world.organizationId,
        cursor: 'a made-up cursor',
      }),
    ).toEqual(hint)
  })

  it('runs an operation whose union argument holds a storage ID, with an ID and with null', async () => {
    const file = (await fixture.runConvex('shapes:storeFile')) as string
    for (const input of [{ file }, { file: null }]) {
      expect(
        await fixture.runConvex('shapes:withFile', {
          actingAs: { kind: 'agent', caller: caller() },
          input,
        }),
      ).toEqual({ operation: expect.any(String), result: 'ok' })
    }
  })

  it('refuses a request too large to store with TOO_LARGE, not with the backend error', async () => {
    // The backend's own refusal, recorded: the library cannot catch it (the insert fails the
    // whole transaction), so it measures the request first.
    const refused = await fixture.runConvex('shapes:insertTooLarge', {
      organizationId: world.organizationId,
      createdBy: world.userId,
    })
    expect(refused).toMatchObject({
      message: expect.stringMatching(/too large|1 ?MiB|1048576|exceed/i),
    })

    const tooLarge = await tool('mutation', 'shapes:archive_sized', {
      projectId: world.projectId,
      size: 1_060_000,
    })
    expect(tooLarge).toMatchObject({ failure: { code: 'TOO_LARGE' } })
    // The library's limit is 1 MiB less 8 KiB, and a plan well under it is stored by the real backend.
    const stored = await tool('mutation', 'shapes:archive_sized', {
      projectId: world.projectId,
      size: 1_030_000,
    })
    expect(stored).toMatchObject({ output: { status: 'needs_approval' } })
  })

  it('cancels the open request of a finished run through the by_run_status index', async () => {
    // A run of its own: the one above holds a request of 1 MB, which the backend warns about.
    const asked = await tool(
      'mutation',
      'agents:archive_project',
      { projectId: world.projectId },
      world.otherRunId,
    )
    const approvalId = (asked.output as { approvalId?: string } | undefined)?.approvalId
    expect(approvalId, JSON.stringify(asked)).toEqual(expect.any(String))
    expect(
      await fixture.runConvex('shapes:endRun', { runId: world.otherRunId, approvalId }),
    ).toEqual({
      before: 'pending',
      after: 'cancelled',
    })
  })
})

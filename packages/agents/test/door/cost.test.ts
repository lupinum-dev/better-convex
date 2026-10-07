import { countDocuments } from '@lupinum/better-convex-functions/test'
import { grantMcp } from '@lupinum/better-convex-nuxt/better-auth/test'
import { expect, test } from 'vitest'

import { fn, setup } from './setup'

// D6: what one tool call and one approval cost, in documents read and written, with everything
// the library does around the handler (user, role, tenant rows, approval and activity rows). Each
// number is the budget: a change that reads or writes more fails here and has to say why. The
// budgets of plain operations are in the functions package.

/** Ann's MCP connection with both scopes, as the door hands it to a tool function. */
async function connected() {
  const s = await setup()
  return { ...s, caller: { door: 'mcp', principal: await grantMcp(s.t, 'ann', ['read', 'write']) } }
}

test('a tool call with a request_id, and its retry', async () => {
  const { t, a, caller } = await connected()
  const call = () =>
    t.mutation(fn('agents:create_project'), {
      caller,
      input: { orgId: a, name: 'Once' },
      requestId: 'r1',
    })
  // The live grant (6: session, user, client, resource, their link, consent), then the app's user,
  // organization, membership; writes: rate-limit window, project, activity row.
  expect(await countDocuments(call)).toEqual({ reads: 9, writes: 3 })
  // The retry checks the actor again, counts against the rate limit and replays the stored result.
  expect(await countDocuments(call)).toEqual({ reads: 12, writes: 1 })
})

test('a tool call that asks a person', async () => {
  const { t, pa, caller } = await connected()
  const ask = () => t.mutation(fn('agents:archive_project'), { caller, input: { projectId: pa } })
  // The live grant (6), user, project (for its tenant) and membership; the plan reads the project
  // from the cache, its fingerprint reads it once more from the database. Writes: rate-limit
  // window, request.
  expect(await countDocuments(ask)).toEqual({ reads: 10, writes: 2 })
})

test('approving a request', async () => {
  const { t, ann, pa, caller } = await connected()
  const asked = await t.mutation(fn('agents:archive_project'), { caller, input: { projectId: pa } })
  // The approver's session (2) and user, and the request; the stale check; the agent's live grant (6),
  // user, the request again for the plan's rows, project and membership; the patches' own reads.
  // Writes: request executing, project, activity row, request approved.
  expect(
    await countDocuments(() =>
      ann.mutation(fn('agents:approve'), { approvalId: asked.approvalId }),
    ),
  ).toEqual({ reads: 19, writes: 4 })
})

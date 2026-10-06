import { countDocuments } from '@lupinum/better-convex-functions/test'
import { expect, test } from 'vitest'

import { fn, setup } from './setup'

// D6: what one tool call and one approval cost, in documents read and written, with everything
// the library does around the handler (user, role, tenant rows, approval and activity rows). Each
// number is the budget: a change that reads or writes more fails here and has to say why. The
// budgets of plain operations are in the functions package.

const caller = {
  door: 'mcp',
  principal: {
    kind: 'oauth',
    userId: 'ann',
    clientId: 'host',
    scopes: ['read', 'write'],
    sessionId: 's',
    grantId: 'g',
    issuer: 'i',
    resource: 'r',
    expiresAt: 0,
  },
}

test('a tool call with a request_id, and its retry', async () => {
  const { t, a } = await setup()
  const call = () =>
    t.mutation(fn('agents:create_project'), {
      caller,
      input: { orgId: a, name: 'Once' },
      requestId: 'r1',
    })
  // User, organization, membership; writes: rate-limit window, project, activity row.
  expect(await countDocuments(call)).toEqual({ reads: 3, writes: 3 })
  // The retry checks the actor again, counts against the rate limit and replays the stored result.
  expect(await countDocuments(call)).toEqual({ reads: 6, writes: 1 })
})

test('approving a request', async () => {
  const { t, ann, pa } = await setup()
  const asked = await t.mutation(fn('agents:archive_project'), { caller, input: { projectId: pa } })
  // The approver and the request; the stale check; the agent's user, project and membership; the patches'
  // own reads. Writes: request executing, project, activity row, request approved.
  expect(
    await countDocuments(() =>
      ann.mutation(fn('agents:approve'), { approvalId: asked.approvalId }),
    ),
  ).toEqual({ reads: 10, writes: 4 })
})

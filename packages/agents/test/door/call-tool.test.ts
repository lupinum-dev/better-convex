import { callTool } from '@lupinum/better-convex-agents/test'
import { grantMcp } from '@lupinum/better-convex-nuxt/better-auth/test'
import { expect, test } from 'vitest'

import { tools } from './agents'
import { setup } from './setup'

// callTool runs the door's dispatch without HTTP. These tests pin what an app test relies on:
// the grant filters tools as the door does, and a failure stays the failure it was.

// G1 for app tests: a test that calls a tool the person's consent does not unlock must fail.
test('callTool refuses a tool the grant does not unlock, and names the tools it unlocks', async () => {
  const { t, pa } = await setup()
  await expect(
    callTool(t, tools, await grantMcp(t, 'ann', ['read']), 'archive_project', { projectId: pa }),
  ).rejects.toThrow(
    new Error(
      'callTool: no tool "archive_project" for this principal. Its scopes unlock: echo_shapes, list_projects.',
    ),
  )
  await expect(
    callTool(t, tools, await grantMcp(t, 'ann', ['write']), 'archive_project', { projectId: pa }),
  ).resolves.toMatchObject({ status: 'needs_approval' })
})

// A crash in a handler must not pass as "refused", and a coded failure keeps its code.
test.each([
  ['a plain Error', { text: 'crash' }, { message: 'The handler crashed.' }],
  [
    'an input Convex cannot carry',
    { anything: { $ref: 'x' } },
    { data: { code: 'INVALID_INPUT', message: 'anything.$ref: unknown field. Leave it out.' } },
  ],
])('callTool rejects with %s, as the tool threw it', async (_name, input, error) => {
  const { t } = await setup()
  await expect(
    callTool(t, tools, await grantMcp(t, 'ann', ['read']), 'echo_shapes', input),
  ).rejects.toMatchObject(error)
})

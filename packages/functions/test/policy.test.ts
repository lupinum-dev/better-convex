import { expect, test } from 'vitest'

import { decide, definePolicy, type Asker } from '../src/policy'

const policy = definePolicy({
  actions: ['organizations.list', 'projects.search', 'projects.create', 'projects.archive'],
  roles: {
    owner: ['*'],
    member: ['projects.search', 'projects.create'],
    viewer: ['projects.search'],
  },
  scopes: {
    'projects:read': { label: 'Read', actions: ['organizations.list', 'projects.search'] },
    'projects:write': { label: 'Write', actions: ['projects.create', 'projects.archive'] },
  },
  agents: { 'projects.archive': 'approve' },
})

const person: Asker = { kind: 'person' }
const writer: Asker = { kind: 'agent', scopes: ['projects:read', 'projects:write'] }
const reader: Asker = { kind: 'agent', scopes: ['projects:read'] }

// Catches: an agent getting more than its person, its grant, or its rule allows.
test.each([
  [person, 'owner', 'projects.archive', 'allow'],
  [person, 'member', 'projects.archive', 'deny'],
  [person, 'viewer', 'projects.create', 'deny'],
  [person, null, 'projects.search', 'deny'],
  [writer, 'owner', 'projects.archive', 'approve'],
  [writer, 'member', 'projects.archive', 'deny'],
  [writer, 'member', 'projects.create', 'allow'],
  [reader, 'owner', 'projects.create', 'deny'],
  [reader, 'viewer', 'projects.search', 'allow'],
  [{ kind: 'system' }, null, 'projects.archive', 'allow'],
] as const)(
  'decide intersects role, grant and agent rule: %j as %s for %s is %s',
  (asker, role, action, expected) => {
    expect(decide(policy, { asker, role, action })).toBe(expected)
  },
)

test('tenantless actions skip the role but keep the grant', () => {
  expect(
    decide(policy, { asker: reader, role: null, action: 'organizations.list', tenantless: true }),
  ).toBe('allow')
  expect(
    decide(policy, {
      asker: { kind: 'agent', scopes: [] },
      role: null,
      action: 'organizations.list',
      tenantless: true,
    }),
  ).toBe('deny')
})

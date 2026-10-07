import { expect, test } from 'vitest'

import { can, decide, definePolicy, type Asker } from '../src/policy'

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

// K1: a role named like a prototype key threw a TypeError instead of denying.
test.each(['superuser', 'toString', 'constructor', '__proto__'])(
  'the unknown role or scope %j grants nothing',
  (name) => {
    expect(can(policy, 'projects.search', name as never)).toBe(false)
    expect(
      decide(policy, {
        asker: { kind: 'agent', scopes: [name] },
        role: 'owner',
        action: 'projects.search',
      }),
    ).toBe('deny')
  },
)

// E13: three-part prefixes match only their own actions; the type accepts them too (types.test.ts).
test('a two-segment prefix matches only its own actions', () => {
  const billing = definePolicy({
    actions: ['billing.invoices.create', 'billing.plans.read'],
    roles: { accountant: ['billing.invoices.*'] },
    scopes: {},
  })
  expect(can(billing, 'billing.invoices.create', 'accountant')).toBe(true)
  expect(can(billing, 'billing.plans.read', 'accountant')).toBe(false)
})

// Class 4 tables: a decision the policy reads that is outside its type at runtime (no decision, a
// near-miss string, a truthy object, an unawaited promise, an error) must never count as "allow".
// Codex round 2: a rule like `(input) => decisions[input.mode]` returned undefined, and the agent
// ran without approval.
const agent: Asker = { kind: 'agent', scopes: ['all'] }
const withAgentRule = (rule: unknown) =>
  definePolicy({
    actions: ['projects.archive'],
    roles: { owner: ['*'] },
    scopes: { all: { label: 'All', actions: ['*'] } },
    agents: { 'projects.archive': rule as 'allow' },
  })
const archiveAsAgent = (policy: ReturnType<typeof withAgentRule>) =>
  decide(policy, { action: 'projects.archive', asker: agent, role: 'owner', input: { mode: 'x' } })

test.each([
  ['undefined', undefined, 'approve'],
  ['null', null, 'approve'],
  ["'ALLOW'", 'ALLOW', 'approve'],
  ["'allow '", 'allow ', 'approve'],
  ['1', 1, 'approve'],
  ['{}', {}, 'approve'],
  ['a Promise of undefined', Promise.resolve(undefined), 'approve'],
  ["a Promise of 'allow'", Promise.resolve('allow'), 'approve'],
  ["'allow'", 'allow', 'allow'],
  ["'deny'", 'deny', 'deny'],
] as const)('an agent rule that returns no decision asks a person: %s', (_, value, expected) => {
  expect(archiveAsAgent(withAgentRule(() => value))).toBe(expected)
})

test('an agent rule that throws asks a person', () => {
  const rule = () => {
    throw new Error('The rule broke.')
  }
  expect(archiveAsAgent(withAgentRule(rule))).toBe('approve')
})

// The same values written as the rule itself, not returned by a function.
test.each([
  ["'ALLOW'", 'ALLOW'],
  ["'allow '", 'allow '],
  ['1', 1],
  ['{}', {}],
  ['a Promise of undefined', Promise.resolve(undefined)],
])('an agent rule that is no decision asks a person: %s', (_, value) => {
  expect(archiveAsAgent(withAgentRule(value))).toBe('approve')
})

// Fails open today: `?? 'allow'` treats an explicit null like a missing rule. Drop `.fails` with the fix.
test.fails('an agent rule that is null asks a person', () => {
  expect(archiveAsAgent(withAgentRule(null))).toBe('approve')
})

// A role's patterns that are not a list of action patterns grant nothing: a list that is missing
// denies, anything else that is not a list of strings throws (the call fails, nothing runs).
test.each([
  ['undefined', 'deny', undefined],
  ['null', 'deny', null],
  ["'*'", 'throws', '*'],
  ["'ALLOW'", 'throws', 'ALLOW'],
  ['1', 'throws', 1],
  ['{}', 'throws', {}],
  ['a Promise of a list', 'throws', Promise.resolve(['*'])],
  ['[undefined]', 'throws', [undefined]],
  ['[null]', 'throws', [null]],
  ["['ALLOW']", 'deny', ['ALLOW']],
  ["['allow ']", 'deny', ['allow ']],
  ['[1]', 'throws', [1]],
  ['[{}]', 'throws', [{}]],
] as const)('a role whose patterns are %s grants nothing: %s', (_, expected, patterns) => {
  const odd = definePolicy({
    actions: ['projects.archive'],
    roles: { owner: patterns as never },
    scopes: {},
  })
  const decided = () => decide(odd, { action: 'projects.archive', asker: person, role: 'owner' })
  if (expected === 'throws') expect(decided).toThrow(TypeError)
  else expect(decided()).toBe(expected)
})

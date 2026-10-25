import { v } from 'convex/values'
import { expect, test } from 'vitest'

import { checkInput, fingerprint, inertMarkdown, jsonOf, matches, oneLine } from '../src/values'

// Codex review: bytes hashed as `{}` (a change went unnoticed) and int64 fields threw.
test('a fingerprint sees bytes and int64 fields', async () => {
  const row = (bytes: number[], count: bigint) => ({
    _id: 'x',
    data: new Uint8Array(bytes).buffer,
    count,
  })
  const first = await fingerprint(row([1, 2], 5n))
  expect(await fingerprint(row([1, 2], 5n))).toBe(first)
  expect(await fingerprint(row([1, 3], 5n))).not.toBe(first)
  expect(await fingerprint(row([1, 2], 6n))).not.toBe(first)
})

// G10, D7: text a person reads before deciding.
test.each([
  ['Old".\n\n[Approve here](https://evil.example)', 'Old". [Approve here](https://evil.example)'],
  ['​​', ''],
  ['a‮txt.exe', 'a txt.exe'],
  ['x'.repeat(400), `${'x'.repeat(299)}…`],
])('oneLine(%j) is %j', (input, expected) => {
  expect(oneLine(input)).toBe(expected)
})

// Catches: a summary that a markdown host shows as a link a person might click while deciding.
// GFM also links a bare `www.` address and an email address, with no brackets at all.
test.each([
  ['[a](https://b) <img src=x>', '\\[a\\]\\(https:\\/\\/b\\) \\<img src=x\\>'],
  ['Visit www.evil.example.', 'Visit www\\.evil.example.'],
  ['Mail ceo@evil.example', 'Mail ceo\\@evil.example'],
])('inert markdown shows %j as text', (input, expected) => {
  expect(inertMarkdown(input)).toBe(expected)
})

// Catches: a model unable to clear a field (send `null`) that the operation declares nullable,
// while a `null` for a field that cannot be null still means "left out".
test.each([
  [{ note: null }, { note: null }],
  [{ note: 'x' }, { note: 'x' }],
  [{ title: null }, {}],
  [{}, {}],
])('checkInput(%j) is %j', (input, expected) => {
  const json = jsonOf(
    v.object({ note: v.optional(v.union(v.string(), v.null())), title: v.optional(v.string()) }),
  )
  expect(checkInput(json, input, () => false)).toEqual({ ok: true, value: expected })
})

// Catches: a literal compared with its encoded JSON, so bigint and non-finite float members never matched.
test.each([
  ['literal 1n matches 1n', v.literal(1n), 1n, true],
  ['literal 1n does not match 2n', v.literal(1n), 2n, false],
  ['literal Infinity matches Infinity', v.literal(Infinity), Infinity, true],
  ['literal Infinity does not match -Infinity', v.literal(Infinity), -Infinity, false],
  ['literal NaN matches NaN', v.literal(Number.NaN), Number.NaN, true],
  ['literal "a" matches "a"', v.literal('a'), 'a', true],
  ['literal 3 matches 3', v.literal(3), 3, true],
  ['literal true does not match "true"', v.literal(true), 'true', false],
])('%s', (_name, validator, value, expected) => {
  expect(matches(jsonOf(validator), value, () => true)).toBe(expected)
})

// Keep (union members told apart by a bigint literal): the member the value is still matches, and a
// value of another tag does not, so the ID in it is read as the right kind of ID.
test.each([
  ['the member with the same bigint tag', { kind: 1n, id: 'x' }, true],
  ['no member with this bigint tag', { kind: 3n, id: 'x' }, false],
  ['the other member, a number tag', { kind: 2, id: 'x' }, true],
])('a union with bigint and number tags matches %s', (_name, value, expected) => {
  const union = v.union(
    v.object({ kind: v.literal(1n), id: v.string() }),
    v.object({ kind: v.literal(2), id: v.string() }),
  )
  expect(matches(jsonOf(union), value, () => true)).toBe(expected)
})

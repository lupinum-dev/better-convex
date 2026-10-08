import { v } from 'convex/values'
import { expect, test } from 'vitest'

import { fingerprint, inertMarkdown, jsonOf, matches, oneLine } from '../src/values'

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

test('inert markdown shows links and HTML as text', () => {
  expect(inertMarkdown('[a](https://b) <img src=x>')).toBe(
    '\\[a\\]\\(https:\\/\\/b\\) \\<img src=x\\>',
  )
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

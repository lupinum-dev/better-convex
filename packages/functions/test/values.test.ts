import { expect, test } from 'vitest'

import { fingerprint, inertMarkdown, oneLine } from '../src/values'

// Codex review: bytes hashed as `{}` (a change went unnoticed) and int64 fields threw.
test('a fingerprint sees bytes and int64 fields', () => {
  const row = (bytes: number[], count: bigint) => ({
    _id: 'x',
    data: new Uint8Array(bytes).buffer,
    count,
  })
  expect(fingerprint(row([1, 2], 5n))).toBe(fingerprint(row([1, 2], 5n)))
  expect(fingerprint(row([1, 2], 5n))).not.toBe(fingerprint(row([1, 3], 5n)))
  expect(fingerprint(row([1, 2], 5n))).not.toBe(fingerprint(row([1, 2], 6n)))
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

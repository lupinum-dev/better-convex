import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test } from 'vitest'

// P4: the core is Convex code, usable from any frontend. A dependency on Nuxt, Vue or an auth
// library would reach every app that installs it. Source imports are checked by
// scripts/check-boundaries.mjs, the packed build by test/packed/check-packed.mjs.
test('the package installs nothing but its convex peer', () => {
  const manifest = JSON.parse(readFileSync(join(import.meta.dirname, '../package.json'), 'utf8'))
  expect(manifest.dependencies).toBeUndefined()
  expect(Object.keys(manifest.peerDependencies)).toEqual(['convex'])
})

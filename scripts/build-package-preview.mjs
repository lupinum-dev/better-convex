#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { relative, resolve } from 'node:path'

import { buildAndPackReleaseTarball } from './pack-release-tarball.mjs'

const root = resolve(import.meta.dirname, '..')
const outputDirectory = resolve(root, '.package-preview')

function ensureClean() {
  const status = execFileSync('git', ['status', '--porcelain'], {
    cwd: root,
    encoding: 'utf8',
  }).trim()
  if (status) throw new Error(`Package preview requires a clean working tree:\n${status}`)
}

ensureClean()
rmSync(outputDirectory, { force: true, recursive: true })
mkdirSync(outputDirectory)
try {
  const vue = buildAndPackReleaseTarball('vue', outputDirectory, { repositoryRoot: root })
  const nuxt = buildAndPackReleaseTarball('nuxt', outputDirectory, { repositoryRoot: root })
  const bytes = readFileSync(nuxt.tarballPath)
  console.log(`directory=${relative(root, outputDirectory)}`)
  console.log('package_name=better-convex-nuxt')
  console.log(`sha256=${createHash('sha256').update(bytes).digest('hex')}`)
  console.log(`tarball=${relative(root, nuxt.tarballPath)}`)
  console.log(`vue_tarball=${relative(root, vue.tarballPath)}`)
} catch (error) {
  rmSync(outputDirectory, { force: true, recursive: true })
  throw error
}
ensureClean()

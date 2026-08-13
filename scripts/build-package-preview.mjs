#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'

import { buildAndPackReleaseTarball } from './pack-release-tarball.mjs'

const root = resolve(import.meta.dirname, '..')
const outputDirectory = resolve(root, '.package-preview')

function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
}

const initialStatus = git('status', '--porcelain')
if (initialStatus) {
  throw new Error(`Package preview requires a clean working tree:\n${initialStatus}`)
}

rmSync(outputDirectory, { force: true, recursive: true })
mkdirSync(outputDirectory)

try {
  const packages = ['vue', 'nuxt', 'mcp'].map((packageId) => {
    const artifact = buildAndPackReleaseTarball(packageId, outputDirectory, {
      repositoryRoot: root,
    })
    const bytes = readFileSync(artifact.tarballPath)
    return {
      name: artifact.packResult[0].name,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      tarball: relative(root, artifact.tarballPath),
    }
  })

  const manifestPath = resolve(outputDirectory, 'preview-manifest.json')
  writeFileSync(
    manifestPath,
    `${JSON.stringify({ sourceSha: git('rev-parse', 'HEAD'), packages }, null, 2)}\n`,
  )

  const output = [
    `directory=${relative(root, outputDirectory)}`,
    `manifest=${relative(root, manifestPath)}`,
  ].join('\n')
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${output}\n`)
  }
  console.log(output)
} catch (error) {
  rmSync(outputDirectory, { force: true, recursive: true })
  throw error
}

const finalStatus = git('status', '--porcelain')
if (finalStatus) {
  throw new Error(`Preview build changed tracked files:\n${finalStatus}`)
}

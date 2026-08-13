#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const [manifestArgument] = process.argv.slice(2)
if (!manifestArgument) throw new Error('Pass the preview manifest path.')

const manifest = JSON.parse(await readFile(resolve(manifestArgument), 'utf8'))
const sourceCommit = process.env.SOURCE_COMMIT
if (manifest.sourceSha !== sourceCommit || process.env.PREVIEW_SHA !== sourceCommit) {
  throw new Error('The preview commit does not match the pull request commit.')
}

const returnedUrls = new Set(process.env.PREVIEW_URLS?.match(/https:\/\/\S+/gu) ?? [])
if (returnedUrls.size !== manifest.packages.length) {
  throw new Error('pkg.pr.new returned an unexpected number of package URLs.')
}

for (const pkg of manifest.packages) {
  const expectedUrl = `https://pkg.pr.new/${process.env.GITHUB_REPOSITORY}/${pkg.name}@${sourceCommit}`
  if (!returnedUrls.has(expectedUrl)) {
    throw new Error(`pkg.pr.new did not return ${expectedUrl}.`)
  }
  const response = await fetch(expectedUrl, { redirect: 'follow' })
  if (!response.ok) {
    throw new Error(`Cannot download ${expectedUrl}: HTTP ${response.status}.`)
  }
  const bytes = Buffer.from(await response.arrayBuffer())
  const actual = createHash('sha256').update(bytes).digest('hex')
  if (actual !== pkg.sha256) {
    throw new Error(`${pkg.name} preview bytes differ from the local tarball.`)
  }
}

process.stdout.write(`Verified ${manifest.packages.length} commit-addressed package previews.\n`)

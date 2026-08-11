#!/usr/bin/env node

import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const MAX_RESPONSE_BYTES = 64 * 1024

function fail(message) {
  throw new Error(`[hosted-source-certification] ${message}`)
}

async function readBoundedJson(response) {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    fail('GitHub response exceeded the byte bound.')
  }
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_RESPONSE_BYTES) {
    fail('GitHub response was empty or exceeded the byte bound.')
  }
  try {
    return JSON.parse(bytes.toString('utf8'))
  } catch {
    fail('GitHub returned invalid JSON.')
  }
}

export async function assertHostedSourceCertification(options) {
  const { fetchImplementation = fetch, repository, sha, token } = options
  if (!/^[\w.-]+\/[\w.-]+$/u.test(repository ?? '')) fail('Invalid repository identity.')
  if (!/^[0-9a-f]{40}$/u.test(sha ?? '')) fail('Invalid source commit.')
  if (typeof token !== 'string' || token.length < 20 || token.length > 2_048) {
    fail('Invalid GitHub token.')
  }
  let response
  try {
    response = await fetchImplementation(
      `https://api.github.com/repos/${repository}/commits/${sha}/check-runs?check_name=release-gate&filter=latest&per_page=10`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
        },
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      },
    )
  } catch {
    fail('Could not read the hosted certification result.')
  }
  if (!response.ok) fail('GitHub rejected the certification lookup.')
  const payload = await readBoundedJson(response)
  const matches = Array.isArray(payload?.check_runs)
    ? payload.check_runs.filter(
        (check) =>
          check?.name === 'release-gate' &&
          check?.head_sha === sha &&
          check?.app?.slug === 'github-actions',
      )
    : []
  if (
    matches.length !== 1 ||
    matches[0].status !== 'completed' ||
    matches[0].conclusion !== 'success'
  ) {
    fail(`Exact commit ${sha} has no successful authoritative release-gate check.`)
  }
  console.log(`[hosted-source-certification] PASS: ${sha}`)
  return matches[0]
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  assertHostedSourceCertification({
    repository: process.env.GITHUB_REPOSITORY,
    sha: process.env.GITHUB_SHA,
    token: process.env.GITHUB_TOKEN,
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}

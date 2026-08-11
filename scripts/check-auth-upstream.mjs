#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const ledgerPath = path.join(repoRoot, 'security/upstream-convex-better-auth.json')
const githubApi = 'https://api.github.com'
const requestTimeoutMs = 15_000
const pageSize = 100
const maxPages = 10
const dispositions = new Set([
  'irrelevant',
  'already implemented',
  'patch required',
  'architectural review required',
])

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

function isSha(value) {
  return typeof value === 'string' && /^[0-9a-f]{40}$/u.test(value)
}

function isIsoInstant(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function matchesAuthorizedSeam(sourcePath, seam) {
  if (seam.endsWith('/**')) {
    const prefix = seam.slice(0, -3)
    return sourcePath === prefix || sourcePath.startsWith(`${prefix}/`)
  }
  return sourcePath === seam
}

function normalizeSourceSeamChanges(files, authorizedSourceSeams) {
  if (!Array.isArray(files)) return []
  return files
    .filter(
      (file) =>
        typeof file?.filename === 'string' &&
        authorizedSourceSeams.some(
          (seam) =>
            matchesAuthorizedSeam(file.filename, seam) ||
            (typeof file.previous_filename === 'string' &&
              matchesAuthorizedSeam(file.previous_filename, seam)),
        ),
    )
    .map((file) => ({
      filename: file.filename,
      status: file.status,
      sha: file.sha ?? null,
      ...(typeof file.previous_filename === 'string'
        ? { previousFilename: file.previous_filename }
        : {}),
    }))
    .sort((left, right) => left.filename.localeCompare(right.filename))
}

function normalizeRelease(release) {
  return {
    tagName: release.tag_name,
    publishedAt: release.published_at ?? null,
    url: release.html_url,
    draft: release.draft,
    prerelease: release.prerelease,
  }
}

function normalizeAdvisory(advisory) {
  return {
    ghsaId: advisory.ghsa_id,
    cveId: advisory.cve_id ?? null,
    severity: advisory.severity,
    publishedAt: advisory.published_at ?? null,
    updatedAt: advisory.updated_at ?? null,
    withdrawnAt: advisory.withdrawn_at ?? null,
    url: advisory.html_url,
  }
}

function normalizeIssue(issue) {
  return {
    number: issue.number,
    state: issue.state,
    title: issue.title,
    updatedAt: issue.updated_at,
    url: issue.html_url,
  }
}

function normalizePullRequest(pull) {
  return {
    number: pull.number,
    state: pull.state,
    merged: pull.merged,
    title: pull.title,
    updatedAt: pull.updated_at,
    url: pull.html_url,
    headSha: pull.head?.sha,
    baseSha: pull.base?.sha,
  }
}

function validateDisposition(record, label, failures) {
  if (!record || typeof record !== 'object') {
    failures.push(`${label} monitoring record is missing`)
    return
  }
  if (!dispositions.has(record.disposition)) {
    failures.push(`${label} has an unsupported disposition: ${String(record.disposition)}`)
  }
  if (record.reviewComplete !== true) {
    failures.push(`${label} has not completed its required human review`)
  }
  if (typeof record.rationale !== 'string' || record.rationale.trim().length < 20) {
    failures.push(`${label} requires a concrete review rationale`)
  }
  if (record.disposition === 'patch required') {
    failures.push(`${label} still requires an imported security patch`)
  }
  if (record.disposition === 'already implemented') {
    if (!Array.isArray(record.evidence) || record.evidence.length === 0) {
      failures.push(`${label} is already implemented but cites no repository evidence`)
    } else {
      for (const evidence of record.evidence) {
        if (
          typeof evidence !== 'string' ||
          path.isAbsolute(evidence) ||
          evidence.includes('..') ||
          !existsSync(path.join(repoRoot, evidence))
        ) {
          failures.push(`${label} cites missing or unsafe evidence: ${String(evidence)}`)
        }
      }
    }
  }
}

function validateMonitoringLedger(ledger, now = new Date()) {
  const failures = []
  const monitoring = ledger?.monitoring
  if (!monitoring || typeof monitoring !== 'object') {
    return ['provenance ledger has no canonical monitoring record']
  }
  if (monitoring.apiRepository !== 'get-convex/better-auth') {
    failures.push('monitoring repository must be get-convex/better-auth')
  }
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(monitoring.reviewedAt ?? '')) {
    failures.push('monitoring reviewedAt must be an ISO date')
  } else {
    const reviewedAt = Date.parse(`${monitoring.reviewedAt}T00:00:00Z`)
    const ageMs = now.getTime() - reviewedAt
    const maxAgeMs = Number(monitoring.reviewExpiresAfterDays) * 24 * 60 * 60 * 1_000
    if (
      !Number.isInteger(monitoring.reviewExpiresAfterDays) ||
      monitoring.reviewExpiresAfterDays < 1 ||
      monitoring.reviewExpiresAfterDays > 31
    ) {
      failures.push('monitoring reviewExpiresAfterDays must be an integer from 1 through 31')
    } else if (ageMs > maxAgeMs) {
      failures.push(
        `upstream monitoring review expired on ${monitoring.reviewedAt}; complete the monthly review`,
      )
    } else if (ageMs < -24 * 60 * 60 * 1_000) {
      failures.push('upstream monitoring review date is in the future')
    }
  }

  const sourceSeams = ledger.authorizedSourceSeams
  if (!Array.isArray(sourceSeams) || sourceSeams.length === 0) {
    failures.push('provenance ledger has no authorized source seams to monitor')
  }

  validateDisposition(monitoring.defaultBranch, 'default branch', failures)
  validateDisposition(monitoring.releases, 'releases', failures)
  validateDisposition(monitoring.securityAdvisories, 'security advisories', failures)
  validateDisposition(monitoring.issue395, 'issue #395', failures)
  validateDisposition(monitoring.pull380, 'PR #380', failures)

  if (monitoring.defaultBranch?.name !== 'main') {
    failures.push('the recorded upstream default branch must be main')
  }
  if (!isSha(monitoring.defaultBranch?.head)) {
    failures.push('the recorded upstream default-branch head must be a full Git SHA')
  }
  if (
    !['identical', 'ahead', 'behind', 'diverged'].includes(monitoring.defaultBranch?.compareStatus)
  ) {
    failures.push('the recorded upstream compare status is invalid')
  }
  if (!Array.isArray(monitoring.defaultBranch?.sourceSeamChanges)) {
    failures.push('the recorded upstream source-seam diff must be an array')
  }
  if (!Array.isArray(monitoring.releases?.items)) {
    failures.push('the recorded upstream releases must be an array')
  }
  if (!Array.isArray(monitoring.securityAdvisories?.items)) {
    failures.push('the recorded upstream security advisories must be an array')
  }
  for (const [record, label] of [
    [monitoring.issue395, 'issue #395'],
    [monitoring.pull380, 'PR #380'],
  ]) {
    if (!isIsoInstant(record?.updatedAt)) failures.push(`${label} has an invalid updatedAt`)
    if (typeof record?.url !== 'string' || !record.url.startsWith('https://github.com/')) {
      failures.push(`${label} has an invalid canonical URL`)
    }
  }
  if (monitoring.issue395?.number !== 395) failures.push('monitoring must track exact issue #395')
  if (monitoring.pull380?.number !== 380) failures.push('monitoring must track exact PR #380')
  if (!isSha(monitoring.pull380?.headSha) || !isSha(monitoring.pull380?.baseSha)) {
    failures.push('PR #380 must record full head and base Git SHAs')
  }
  return failures
}

function compareField(expected, actual, label, failures) {
  if (stableJson(expected) !== stableJson(actual)) {
    failures.push(`${label} changed upstream and needs a reviewed disposition`)
  }
}

function compareMonitoringSnapshot(monitoring, current) {
  const failures = []
  compareField(
    monitoring.defaultBranch.name,
    current.defaultBranch.name,
    'default branch',
    failures,
  )
  compareField(
    monitoring.defaultBranch.head,
    current.defaultBranch.head,
    'default-branch head',
    failures,
  )
  compareField(
    monitoring.defaultBranch.compareStatus,
    current.defaultBranch.compareStatus,
    'baseline comparison status',
    failures,
  )
  compareField(
    monitoring.defaultBranch.sourceSeamChanges,
    current.defaultBranch.sourceSeamChanges,
    'enumerated source-seam diff',
    failures,
  )
  compareField(monitoring.releases.items, current.releases, 'GitHub releases', failures)
  compareField(
    monitoring.securityAdvisories.items,
    current.securityAdvisories,
    'repository security advisories',
    failures,
  )
  compareField(
    {
      number: monitoring.issue395.number,
      state: monitoring.issue395.state,
      title: monitoring.issue395.title,
      updatedAt: monitoring.issue395.updatedAt,
      url: monitoring.issue395.url,
    },
    current.issue395,
    'issue #395',
    failures,
  )
  compareField(
    {
      number: monitoring.pull380.number,
      state: monitoring.pull380.state,
      merged: monitoring.pull380.merged,
      title: monitoring.pull380.title,
      updatedAt: monitoring.pull380.updatedAt,
      url: monitoring.pull380.url,
      headSha: monitoring.pull380.headSha,
      baseSha: monitoring.pull380.baseSha,
    },
    current.pull380,
    'PR #380',
    failures,
  )
  return failures
}

function createGitHubClient({ fetch: fetchImplementation = globalThis.fetch, token } = {}) {
  if (typeof fetchImplementation !== 'function') throw new Error('global fetch is unavailable')
  const headers = {
    accept: 'application/vnd.github+json',
    'user-agent': 'better-convex-nuxt-auth-upstream-monitor',
    'x-github-api-version': '2022-11-28',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  }

  async function request(endpoint) {
    const url = endpoint.startsWith('https://') ? endpoint : `${githubApi}${endpoint}`
    const parsed = new URL(url)
    if (parsed.origin !== githubApi) throw new Error('GitHub pagination escaped api.github.com')
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs)
    try {
      const response = await fetchImplementation(url, {
        headers,
        signal: controller.signal,
        redirect: 'error',
      })
      if (!response.ok) {
        throw new Error(`GitHub API ${parsed.pathname} returned HTTP ${response.status}`)
      }
      return response.json()
    } finally {
      clearTimeout(timeout)
    }
  }

  async function pages(endpoint) {
    const values = []
    for (let page = 1; page <= maxPages; page += 1) {
      const separator = endpoint.includes('?') ? '&' : '?'
      const batch = await request(`${endpoint}${separator}per_page=${pageSize}&page=${page}`)
      if (!Array.isArray(batch)) throw new Error(`GitHub API ${endpoint} did not return a list`)
      values.push(...batch)
      if (batch.length < pageSize) return values
    }
    throw new Error(`GitHub API ${endpoint} exceeded the ${maxPages}-page monitoring bound`)
  }

  return { pages, request }
}

async function fetchCurrentMonitoring(ledger, options = {}) {
  const monitoring = ledger.monitoring
  const repository = monitoring.apiRepository
  const encodedRepository = repository
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/')
  const endpoint = `/repos/${encodedRepository}`
  const client = createGitHubClient(options)
  const repositoryRecord = await client.request(endpoint)
  const branchName = repositoryRecord.default_branch
  const encodedBranch = encodeURIComponent(branchName)
  const [branch, releases, securityAdvisories, issue, pull] = await Promise.all([
    client.request(`${endpoint}/branches/${encodedBranch}`),
    client.pages(`${endpoint}/releases`),
    client.pages(`${endpoint}/security-advisories`),
    client.request(`${endpoint}/issues/395`),
    client.request(`${endpoint}/pulls/380`),
  ])
  if (!isSha(branch?.commit?.sha)) throw new Error('GitHub returned an invalid branch head')
  const compare = await client.request(
    `${endpoint}/compare/${encodeURIComponent(ledger.upstream.commit)}...${encodeURIComponent(branch.commit.sha)}`,
  )
  if (!Array.isArray(compare.files))
    throw new Error('GitHub compare response omitted its file list')
  if (compare.files.length >= 300) {
    throw new Error('GitHub compare reached its 300-file bound; architectural review is required')
  }

  return {
    defaultBranch: {
      name: branchName,
      head: branch.commit.sha,
      compareStatus: compare.status,
      sourceSeamChanges: normalizeSourceSeamChanges(compare.files, ledger.authorizedSourceSeams),
    },
    releases: releases.map(normalizeRelease),
    securityAdvisories: securityAdvisories.map(normalizeAdvisory),
    issue395: normalizeIssue(issue),
    pull380: normalizePullRequest(pull),
  }
}

function parseArguments(arguments_) {
  if (arguments_.length === 0) return {}
  if (arguments_.length === 2 && arguments_[0] === '--fixture') {
    return { fixture: path.resolve(repoRoot, arguments_[1]) }
  }
  throw new Error('usage: pnpm check:auth-upstream [--fixture <current.json>]')
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  const ledger = readJson(ledgerPath)
  const failures = validateMonitoringLedger(ledger)
  let current
  if (options.fixture) {
    current = readJson(options.fixture)
  } else {
    current = await fetchCurrentMonitoring(ledger, {
      token: process.env.GITHUB_TOKEN || process.env.GH_TOKEN,
    })
  }
  failures.push(...compareMonitoringSnapshot(ledger.monitoring, current))
  if (failures.length > 0) {
    console.error(`Auth upstream monitoring failed with ${failures.length} issue(s):`)
    for (const failure of failures) console.error(`- ${failure}`)
    console.error('\nCurrent normalized upstream observation:')
    console.error(JSON.stringify(current, null, 2))
    process.exitCode = 1
    return
  }
  console.log(
    `Auth upstream monitoring passed (${ledger.monitoring.reviewedAt} review; ${current.defaultBranch.head}; ${current.releases.length} release(s); ${current.securityAdvisories.length} advisory record(s)).`,
  )
}

export {
  compareMonitoringSnapshot,
  createGitHubClient,
  fetchCurrentMonitoring,
  matchesAuthorizedSeam,
  normalizeAdvisory,
  normalizeIssue,
  normalizePullRequest,
  normalizeRelease,
  normalizeSourceSeamChanges,
  stableJson,
  validateMonitoringLedger,
}

const isMainModule = process.argv[1] && import.meta.url === `file://${process.argv[1]}`
if (isMainModule) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}

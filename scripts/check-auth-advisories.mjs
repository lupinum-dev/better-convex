import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'

import { supportedDependencyTuple } from './supported-dependency-tuple.mjs'

const ROOT = new URL('../', import.meta.url)
const POLICY_URL = new URL('security/auth-advisory-exceptions.json', ROOT)
const PROVENANCE_URL = new URL('security/upstream-convex-better-auth.json', ROOT)
const GITHUB_API = 'https://api.github.com'
const GITHUB_API_VERSION = '2026-03-10'
const MAX_EXCEPTION_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1000
const SEVERITIES = new Set(['unknown', 'low', 'moderate', 'medium', 'high', 'critical'])

function fail(message) {
  throw new Error(`[auth-advisories] ${message}`)
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function exactKeys(value, keys, label) {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`${label} must contain exactly: ${expected.join(', ')}.`)
  }
}

function requireString(value, label) {
  if (typeof value !== 'string' || value.trim() !== value || value.length === 0) {
    fail(`${label} must be a non-empty, trimmed string.`)
  }
  return value
}

function parseTimestamp(value, label) {
  requireString(value, label)
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    fail(`${label} must be an ISO-8601 UTC timestamp.`)
  }
  return timestamp
}

export function validateExceptionPolicy(policy, now = Date.now()) {
  if (!isObject(policy)) fail('Exception policy must be an object.')
  exactKeys(policy, ['schemaVersion', 'exceptions'], 'Exception policy')
  if (policy.schemaVersion !== 2) fail('Exception policy schemaVersion must be 2.')
  if (!Array.isArray(policy.exceptions)) fail('Exception policy exceptions must be an array.')

  const keys = [
    'id',
    'source',
    'auditScope',
    'package',
    'version',
    'owner',
    'mitigation',
    'reason',
    'sourceUrl',
    'createdAt',
    'expiresAt',
  ]
  const seen = new Set()
  return policy.exceptions.map((exception, index) => {
    const label = `Exception ${index + 1}`
    if (!isObject(exception)) fail(`${label} must be an object.`)
    exactKeys(exception, keys, label)
    for (const key of keys) requireString(exception[key], `${label}.${key}`)
    if (!['npm', 'github', 'upstream'].includes(exception.source)) {
      fail(`${label}.source must be npm, github, or upstream.`)
    }
    if (!['repository', 'clean-nuxt-consumer'].includes(exception.auditScope)) {
      fail(`${label}.auditScope must be repository or clean-nuxt-consumer.`)
    }
    let sourceUrl
    try {
      sourceUrl = new URL(exception.sourceUrl)
    } catch {
      fail(`${label}.sourceUrl must be an absolute URL.`)
    }
    if (sourceUrl.protocol !== 'https:') fail(`${label}.sourceUrl must use HTTPS.`)

    const createdAt = parseTimestamp(exception.createdAt, `${label}.createdAt`)
    const expiresAt = parseTimestamp(exception.expiresAt, `${label}.expiresAt`)
    if (expiresAt <= createdAt) fail(`${label} must expire after it was created.`)
    if (expiresAt - createdAt > MAX_EXCEPTION_DAYS * DAY_MS) {
      fail(`${label} exceeds the ${MAX_EXCEPTION_DAYS}-day maximum.`)
    }
    if (expiresAt <= now) fail(`${label} expired at ${exception.expiresAt}.`)

    const identity = exceptionIdentity(exception)
    if (seen.has(identity)) fail(`${label} duplicates ${identity}.`)
    seen.add(identity)
    return Object.freeze({ ...exception })
  })
}

function exceptionIdentity(value) {
  return [value.source, value.id, value.package, value.version].join('\u0000')
}

function normalizeSeverity(value) {
  if (typeof value !== 'string') return 'unknown'
  const severity = value.toLowerCase()
  return severity === 'medium' ? 'moderate' : SEVERITIES.has(severity) ? severity : 'unknown'
}

export function parsePnpmAudit(report, scope) {
  if (!isObject(report)) fail(`${scope} pnpm audit did not return an object.`)
  if (isObject(report.error)) {
    fail(
      `${scope} pnpm audit failed: ${String(report.error.message ?? report.error.code ?? 'unknown error')}`,
    )
  }
  if (!isObject(report.advisories)) fail(`${scope} pnpm audit omitted advisories.`)

  const findings = []
  for (const [key, advisory] of Object.entries(report.advisories)) {
    if (!isObject(advisory)) fail(`${scope} pnpm advisory ${key} is malformed.`)
    const id = requireString(
      typeof advisory.github_advisory_id === 'string'
        ? advisory.github_advisory_id
        : String(advisory.id ?? key),
      `${scope} advisory id`,
    )
    const packageName = requireString(advisory.module_name, `${scope} advisory ${id} package`)
    const url = requireString(advisory.url, `${scope} advisory ${id} URL`)
    const advisoryFindings = Array.isArray(advisory.findings) ? advisory.findings : []
    if (advisoryFindings.length === 0) fail(`${scope} advisory ${id} has no resolved finding.`)
    for (const finding of advisoryFindings) {
      if (!isObject(finding)) fail(`${scope} advisory ${id} has a malformed finding.`)
      findings.push({
        source: 'npm',
        id,
        package: packageName,
        version: requireString(finding.version, `${scope} advisory ${id} version`),
        severity: normalizeSeverity(advisory.severity),
        sourceUrl: url,
        paths: Array.isArray(finding.paths) ? finding.paths.map(String).sort() : [],
        scope,
      })
    }
  }
  return findings
}

export function parseGitHubAdvisories(advisories, source, importedCommit, expectedPackage) {
  if (!Array.isArray(advisories)) fail(`${source} GitHub response must be an array.`)
  const findings = []
  for (const advisory of advisories) {
    if (!isObject(advisory) || advisory.withdrawn_at) continue
    const id = requireString(advisory.ghsa_id, `${source} advisory id`)
    const sourceUrl = requireString(advisory.html_url, `${source} advisory ${id} URL`)
    if (source === 'upstream') {
      findings.push({
        source,
        id,
        package: 'get-convex/better-auth',
        version: importedCommit,
        severity: normalizeSeverity(advisory.severity),
        sourceUrl,
        paths: [],
        scope: 'imported source',
      })
      continue
    }

    if (typeof expectedPackage !== 'string' || !(expectedPackage in supportedDependencyTuple)) {
      fail(`GitHub tuple parsing requires one supported expected package.`)
    }
    if (!Array.isArray(advisory.vulnerabilities) || advisory.vulnerabilities.length === 0) {
      fail(`GitHub advisory ${id} has no vulnerability records.`)
    }
    if (!advisory.vulnerabilities.some((item) => item?.package?.name === expectedPackage)) {
      fail(`GitHub returned ${id} without the requested package ${expectedPackage}.`)
    }
    findings.push({
      source: 'github',
      id,
      package: expectedPackage,
      version: supportedDependencyTuple[expectedPackage],
      severity: normalizeSeverity(advisory.severity),
      sourceUrl,
      paths: [],
      scope: 'supported tuple',
    })
  }
  return findings
}

export function evaluateFindings(findings, exceptions) {
  const unique = new Map()
  for (const finding of findings) {
    const key = exceptionIdentity(finding)
    const existing = unique.get(key)
    if (existing) {
      existing.paths = [...new Set([...existing.paths, ...finding.paths])].sort()
      existing.scope = [...new Set([existing.scope, finding.scope])].sort().join(', ')
    } else {
      unique.set(key, { ...finding, paths: [...finding.paths] })
    }
  }

  const exceptionMap = new Map(
    exceptions.map((exception) => [exceptionIdentity(exception), exception]),
  )
  const applicable = []
  const excepted = []
  for (const finding of [...unique.values()].sort((a, b) =>
    exceptionIdentity(a).localeCompare(exceptionIdentity(b)),
  )) {
    const exception = exceptionMap.get(exceptionIdentity(finding))
    if (exception) {
      excepted.push({ finding, exception })
      exceptionMap.delete(exceptionIdentity(finding))
    } else {
      applicable.push(finding)
    }
  }
  if (exceptionMap.size > 0) {
    fail(
      `Stale exceptions do not match an applicable advisory: ${[...exceptionMap.keys()].join(', ')}.`,
    )
  }
  return { applicable, excepted }
}

function runAudit(args, scope, cwd = ROOT) {
  const result = spawnSync('pnpm', ['audit', ...args, '--json'], {
    cwd,
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 16 * 1024 * 1024,
    timeout: 120_000,
  })
  const output = result.stdout?.trim() || result.stderr?.trim()
  if (!output) fail(`${scope} pnpm audit returned no JSON.`)
  let report
  try {
    report = JSON.parse(output)
  } catch {
    fail(`${scope} pnpm audit returned invalid JSON.`)
  }
  return parsePnpmAudit(report, scope)
}

async function fetchJson(path) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'better-convex-nuxt-auth-advisory-gate',
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
  }
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  const response = await fetch(`${GITHUB_API}${path}`, {
    headers,
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) fail(`GitHub ${path} returned HTTP ${response.status}.`)
  if (response.headers.get('link')?.includes('rel="next"')) {
    fail(`GitHub ${path} exceeded one complete 100-record page.`)
  }
  return response.json()
}

async function collectGitHubFindings(importedCommit) {
  const upstreamPath =
    '/repos/get-convex/better-auth/security-advisories?state=published&per_page=100'
  const tupleQueries = Object.entries(supportedDependencyTuple).map(async ([name, version]) => {
    const path = `/advisories?ecosystem=npm&type=reviewed&per_page=100&affects=${encodeURIComponent(`${name}@${version}`)}`
    return parseGitHubAdvisories(await fetchJson(path), 'github', importedCommit, name)
  })
  const [tuple, upstream] = await Promise.all([Promise.all(tupleQueries), fetchJson(upstreamPath)])
  return [...tuple.flat(), ...parseGitHubAdvisories(upstream, 'upstream', importedCommit)]
}

function loadJson(url, label) {
  try {
    return JSON.parse(readFileSync(url, 'utf8'))
  } catch (error) {
    fail(`Could not read ${label}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function main() {
  const policy = loadJson(POLICY_URL, 'auth advisory exception policy')
  const exceptions = validateExceptionPolicy(policy)
  const provenance = loadJson(PROVENANCE_URL, 'auth provenance ledger')
  const importedCommit = requireString(provenance?.upstream?.commit, 'Imported upstream commit')
  const args = process.argv.slice(2)
  if (args.length > 0) {
    if (args.length !== 2 || args[0] !== '--production-dir') {
      fail('usage: node scripts/check-auth-advisories.mjs [--production-dir <directory>]')
    }
    const directory = resolve(args[1])
    if (!existsSync(resolve(directory, 'package.json'))) {
      fail(`production audit directory has no package.json: ${directory}`)
    }
    const findings = runAudit(['--prod'], 'clean OAuth production consumer', directory)
    const findingIdentities = new Set(findings.map(exceptionIdentity))
    const applicableExceptions = exceptions.filter(
      (exception) =>
        exception.auditScope === 'clean-nuxt-consumer' &&
        findingIdentities.has(exceptionIdentity(exception)),
    )
    const result = evaluateFindings(findings, applicableExceptions)
    if (result.applicable.length > 0) {
      const summary = result.applicable
        .map(
          (finding) =>
            `${finding.severity} ${finding.id} ${finding.package}@${finding.version} (${finding.sourceUrl})`,
        )
        .join('\n- ')
      fail(`Unresolved clean-consumer advisories:\n- ${summary}`)
    }
    console.log(
      `[auth-advisories] PASS: clean OAuth production consumer audit is clear (${result.excepted.length} active exceptions).`,
    )
    return
  }

  const findings = [
    ...runAudit(['--prod'], 'production'),
    ...runAudit([], 'complete'),
    ...(await collectGitHubFindings(importedCommit)),
  ]
  const result = evaluateFindings(
    findings,
    exceptions.filter((exception) => exception.auditScope === 'repository'),
  )
  for (const { finding, exception } of result.excepted) {
    console.warn(
      `[auth-advisories] EXCEPTED ${finding.id} ${finding.package}@${finding.version} until ${exception.expiresAt} (${exception.owner}).`,
    )
  }
  if (result.applicable.length > 0) {
    const summary = result.applicable
      .map(
        (finding) =>
          `${finding.severity} ${finding.id} ${finding.package}@${finding.version} (${finding.sourceUrl})`,
      )
      .join('\n- ')
    fail(`Unresolved applicable advisories:\n- ${summary}`)
  }
  console.log(
    `[auth-advisories] PASS: npm production/full audits, ${Object.keys(supportedDependencyTuple).length} exact GitHub package queries, and imported upstream advisories are clear (${result.excepted.length} active exceptions).`,
  )
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  appendFileSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { verify as verifySigstore } from 'sigstore'

const fail = (message) => {
  throw new Error(message)
}
const assert = (condition, message) => {
  if (!condition) fail(message)
}
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const sha512 = (bytes) => `sha512-${createHash('sha512').update(bytes).digest('base64')}`

export function classifyReconciliation({ modes, tag, release, assets, metadata }) {
  assert(
    modes.every((mode) => ['absent', 'oidc'].includes(mode)),
    'Registry state is unverified.',
  )
  assert(tag !== 'conflict', 'The release tag targets a different commit.')
  assert(
    !(tag === 'absent' && release === 'present'),
    'A GitHub Release exists without its certified tag.',
  )
  if (modes.includes('absent')) {
    assert(
      tag === 'absent' && release === 'absent',
      'Public GitHub history exists before npm publication is complete.',
    )
    return 'publish'
  }
  if (tag === 'absent' || release === 'absent' || assets !== 'verified' || metadata !== 'verified')
    return 'repair'
  return 'complete'
}

export function assertFreshFirstAttempt({ action, firstAttempt, mainSha, sourceSha }) {
  if (action === 'publish' && firstAttempt) {
    assert(
      mainSha === sourceSha,
      `First publication attempt is stale: current main is ${mainSha}, candidate source is ${sourceSha}.`,
    )
  }
}

export function releaseMetadataState(release, record) {
  return release.name === record.title &&
    release.body?.replace(/\r\n/gu, '\n').trimEnd() === record.notes.trimEnd() &&
    release.isPrerelease === (record.channel === 'next')
    ? 'verified'
    : 'conflict'
}

export function evaluateProvenanceStatement(statement, pkg, integrity, sourceSha) {
  const expectedSubject = `pkg:npm/${pkg.name.replaceAll('@', '%40')}@${pkg.version}`
  const expectedDigest = Buffer.from(integrity.slice('sha512-'.length), 'base64').toString('hex')
  const workflow = statement.predicate?.buildDefinition?.externalParameters?.workflow
  const source = statement.predicate?.buildDefinition?.resolvedDependencies?.find(
    (dependency) =>
      dependency.uri === 'git+https://github.com/lupinum-dev/better-convex@refs/heads/main',
  )?.digest?.gitCommit
  assert(
    statement.predicateType === 'https://slsa.dev/provenance/v1' &&
      statement.subject?.some(
        (subject) => subject.name === expectedSubject && subject.digest?.sha512 === expectedDigest,
      ) &&
      workflow?.repository === 'https://github.com/lupinum-dev/better-convex' &&
      workflow?.ref === 'refs/heads/main' &&
      workflow?.path === '.github/workflows/publish-prerelease.yml' &&
      source === sourceSha,
    `${pkg.name}@${pkg.version} provenance has the wrong bytes, source, or workflow identity.`,
  )
  return true
}

const npm = (args) => spawnSync('npm', args, { encoding: 'utf8' })
const npmView = (spec, field) => {
  const result = npm(['view', spec, field, '--json'])
  if (result.status === 0) return JSON.parse(result.stdout.trim() || 'null')
  if (/E404|404 Not Found/u.test(result.stderr)) return null
  fail(`npm view failed for ${spec} ${field}: ${result.stderr.trim()}`)
}
const gh = (args) => spawnSync('gh', args, { encoding: 'utf8' })
const ghJson = (args) => {
  const result = gh(args)
  assert(result.status === 0, `gh ${args.join(' ')} failed: ${result.stderr.trim()}`)
  return JSON.parse(result.stdout)
}

async function verifyProvenance(pkg, integrity, sourceSha) {
  const attestations = npmView(`${pkg.name}@${pkg.version}`, 'dist.attestations')
  const url = Array.isArray(attestations) ? attestations[0]?.url : attestations?.url
  assert(url, `${pkg.name}@${pkg.version} has no verifiable npm provenance.`)
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
  })
  assert(
    response.ok,
    `Provenance lookup failed for ${pkg.name}@${pkg.version}: HTTP ${response.status}`,
  )
  const document = await response.json()
  const attestation = document.attestations?.find(
    (item) => item.predicateType === 'https://slsa.dev/provenance/v1',
  )
  assert(
    attestation?.bundle?.dsseEnvelope?.payload,
    `${pkg.name}@${pkg.version} has incomplete SLSA provenance.`,
  )
  const statement = JSON.parse(
    Buffer.from(attestation.bundle.dsseEnvelope.payload, 'base64').toString('utf8'),
  )
  evaluateProvenanceStatement(statement, pkg, integrity, sourceSha)
  await verifySigstore(attestation.bundle, {
    certificateIssuer: 'https://token.actions.githubusercontent.com',
    certificateIdentityURI:
      '^https://github\\.com/lupinum-dev/better-convex/\\.github/workflows/publish-prerelease\\.yml@refs/heads/main$',
    certificateOIDs: {
      '1.3.6.1.4.1.57264.1.3': sourceSha,
      '1.3.6.1.4.1.57264.1.5': 'lupinum-dev/better-convex',
      '1.3.6.1.4.1.57264.1.6': 'refs/heads/main',
    },
  })
  return sha256(Buffer.from(JSON.stringify(attestation.bundle)))
}

function tagState(record) {
  const result = gh([
    'api',
    `repos/${process.env.GITHUB_REPOSITORY}/git/ref/tags/${record.tag}`,
    '--jq',
    '[.object.type,.object.sha]|@tsv',
  ])
  if (result.status !== 0 && /HTTP 404|Not Found/u.test(result.stderr)) return 'absent'
  assert(result.status === 0, `Could not inspect ${record.tag}: ${result.stderr.trim()}`)
  let [type, sha] = result.stdout.trim().split('\t')
  while (type === 'tag') {
    const object = ghJson(['api', `repos/${process.env.GITHUB_REPOSITORY}/git/tags/${sha}`]).object
    ;({ type, sha } = object)
  }
  return type === 'commit' && sha === record.sourceSha ? 'verified' : 'conflict'
}

function releaseState(directory, record) {
  const view = gh([
    'release',
    'view',
    record.tag,
    '--repo',
    process.env.GITHUB_REPOSITORY,
    '--json',
    'assets,body,isPrerelease,name',
  ])
  if (view.status !== 0 && /HTTP 404|release not found/iu.test(view.stderr))
    return { release: 'absent', assets: 'absent', metadata: 'absent' }
  assert(view.status === 0, `Could not inspect ${record.tag} Release: ${view.stderr.trim()}`)
  const release = JSON.parse(view.stdout)
  const expectedFiles = readdirSync(directory).sort()
  const observedFiles = release.assets.map((asset) => asset.name).sort()
  const metadata = releaseMetadataState(release, record)
  if (JSON.stringify(expectedFiles) !== JSON.stringify(observedFiles))
    return { release: 'present', assets: 'absent', metadata }
  const downloadDir = mkdtempSync(join(tmpdir(), 'better-convex-release-'))
  try {
    const download = gh([
      'release',
      'download',
      record.tag,
      '--repo',
      process.env.GITHUB_REPOSITORY,
      '--dir',
      downloadDir,
    ])
    assert(
      download.status === 0,
      `Could not download ${record.tag} assets: ${download.stderr.trim()}`,
    )
    const matches = expectedFiles.every(
      (file) =>
        sha256(readFileSync(join(directory, file))) ===
        sha256(readFileSync(join(downloadDir, file))),
    )
    return {
      release: 'present',
      assets: matches ? 'verified' : 'conflict',
      metadata,
    }
  } finally {
    rmSync(downloadDir, { recursive: true, force: true })
  }
}

async function inspect(directory, record) {
  assert(
    record.schemaVersion === 1 && /^[0-9a-f]{40}$/u.test(record.sourceSha),
    'Invalid release record.',
  )
  assert(
    record.packages.length === record.publishOrder.length,
    'Release record package order is incomplete.',
  )
  for (const asset of record.assets)
    assert(
      sha256(readFileSync(join(directory, asset.file))) === asset.sha256,
      `${asset.file} differs from the release record.`,
    )
  const packages = []
  for (const pkg of record.packages) {
    const bytes = readFileSync(join(directory, pkg.tarball))
    assert(
      sha256(bytes) === pkg.sha256 && sha512(bytes) === pkg.integrity,
      `${pkg.name} candidate bytes differ.`,
    )
    const registryIntegrity = npmView(`${pkg.name}@${pkg.version}`, 'dist.integrity')
    if (registryIntegrity == null) {
      packages.push({
        ...pkg,
        mode: 'absent',
        channelVersion: npmView(pkg.name, `dist-tags.${record.channel}`),
        provenanceBundleSha256: null,
      })
      continue
    }
    assert(
      registryIntegrity === pkg.integrity,
      `${pkg.name}@${pkg.version} exists with different bytes.`,
    )
    const channelVersion = npmView(pkg.name, `dist-tags.${record.channel}`)
    assert(
      channelVersion === pkg.version,
      `${pkg.name} ${record.channel}=${channelVersion ?? 'absent'}; expected ${pkg.version}.`,
    )
    packages.push({
      ...pkg,
      mode: 'oidc',
      channelVersion,
      provenanceBundleSha256: await verifyProvenance(pkg, registryIntegrity, record.sourceSha),
    })
  }
  const tag = tagState(record)
  const github = releaseState(directory, record)
  const action = classifyReconciliation({
    modes: packages.map((pkg) => pkg.mode),
    tag,
    ...github,
  })
  if (action === 'publish' && process.env.FIRST_ATTEMPT === 'true') {
    const mainSha = ghJson(['api', `repos/${process.env.GITHUB_REPOSITORY}/git/ref/heads/main`])
      .object.sha
    assertFreshFirstAttempt({
      action,
      firstAttempt: true,
      mainSha,
      sourceSha: record.sourceSha,
    })
  }
  return { action, packages, tag, ...github }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const directory = resolve(args.shift() ?? '.release')
  const argument = (name) => {
    const index = args.indexOf(name)
    return index === -1 ? undefined : args[index + 1]
  }
  const record = JSON.parse(readFileSync(join(directory, 'release-record.json'), 'utf8'))
  const state = await inspect(directory, record)
  if (args.includes('--probe')) {
    process.stdout.write(`${state.action === 'complete' ? 'complete' : 'active'}\n`)
    process.exit(0)
  }
  const verification = {
    schemaVersion: 1,
    sourceSha: record.sourceSha,
    unit: record.unit,
    version: record.version,
    channel: record.channel,
    packages: state.packages,
  }
  writeFileSync(
    join(directory, 'registry-verification.json'),
    `${JSON.stringify(verification, null, 2)}\n`,
  )
  const summary = argument('--summary')
  if (summary)
    appendFileSync(
      summary,
      `${[
        '',
        `# Release card: ${record.tag}`,
        '',
        `- Unit: \`${record.unit}\``,
        `- Source SHA: \`${record.sourceSha}\``,
        `- CI run: ${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${record.ciRunId}`,
        `- Workflow: ${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`,
        `- Channel: \`${record.channel}\``,
        `- Tag: \`${state.tag}\``,
        `- GitHub Release: \`${state.release}\``,
        `- Release metadata: \`${state.metadata}\``,
        `- Assets: \`${state.assets}\``,
        `- Approval: ${state.action === 'publish' ? 'awaiting protected npm approval' : 'not required'}`,
        '',
        '| Package | Version | npm | Provenance | SHA-256 |',
        '|---|---|---|---|---|',
        ...state.packages.map(
          (pkg) =>
            `| \`${pkg.name}\` | \`${pkg.version}\` | \`${pkg.mode}\` | \`${pkg.mode === 'oidc' ? 'verified' : 'pending'}\` | \`${pkg.sha256}\` |`,
        ),
        '',
        `**Next action:** ${state.action === 'publish' ? 'Approve the protected npm environment for this exact release unit.' : state.action === 'repair' ? 'Repair only the tag or GitHub Release from this retained candidate.' : 'None. The release is complete.'}`,
        '',
      ].join('\n')}\n`,
    )
  const output = argument('--github-output')
  if (output)
    for (const [name, value] of Object.entries({
      action: state.action,
      sha: record.sourceSha,
      unit: record.unit,
      version: record.version,
      channel: record.channel,
      tag: record.tag,
    }))
      appendFileSync(output, `${name}=${value}\n`)
  process.stdout.write(`Release reconciliation: ${state.action}.\n`)
}

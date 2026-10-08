// Dependency audit for CI: a high or critical advisory blocks only when users would install it,
// through the production dependencies of a published package. Every other production finding is a
// warning. Dev tools are not audited here (`--prod`); Dependabot alerts cover them.
import { spawnSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

export function classifyAdvisories(report, importers) {
  if (!report.advisories || report.error) throw new Error('pnpm audit did not return advisories')
  return Object.values(report.advisories).map((advisory) => {
    const reachesUsers = advisory.findings.some(finding => finding.paths.some(path => importers.has(path.split('>')[0])))
    return { ...advisory, reachesUsers, blocks: reachesUsers && ['high', 'critical'].includes(advisory.severity) }
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const run = args => spawnSync('pnpm', args, { encoding: 'utf8', maxBuffer: 64 << 20 })
  const listed = run(['-r', 'ls', '--json', '--depth', '-1'])
  if (listed.status !== 0) throw new Error(listed.stderr || 'Cannot list workspace packages')
  const root = realpathSync('.')
  // pnpm 11 uses `.` for the root and replaces path separators with `__`.
  const importers = new Set(JSON.parse(listed.stdout).filter(pkg => !pkg.private).map(pkg =>
    relative(root, pkg.path).split(sep).join('__') || '.'))
  const audited = run(['audit', '--prod', '--json']) // findings make pnpm exit nonzero
  const findings = classifyAdvisories(JSON.parse(audited.stdout), importers)
  for (const finding of findings) {
    const where = finding.reachesUsers ? 'users install it with a published package' : 'not installed by users of a published package'
    console.log(`${finding.blocks ? '::error::' : '::warning::'}${finding.module_name}: ${finding.title} (${finding.severity}; ${where}) ${finding.url ?? ''}`.trim())
  }
  const blocking = findings.filter(finding => finding.blocks).length
  console.log(blocking ? `${blocking} advisories block. Update the package or see https://oss.lupinum.com/docs/dependencies#audit` : `No blocking advisories (${findings.length} warnings).`)
  process.exitCode = blocking ? 1 : 0
}

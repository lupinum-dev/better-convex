// Copies the rendered docs site into every published package as dist/agent/,
// exported as `<package>/agent-docs`. Coding agents in consuming projects then
// read documentation that matches the installed version. Run after the docs build.
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const source = 'docs/.output/public/raw'
if (!existsSync(source)) throw new Error(`${source} is missing. Run pnpm docs:build first.`)

const field = (text, name) => new RegExp(`^${name}:\\s*["']?(.*?)["']?\\s*$`, 'm').exec(text)?.[1]
const pages = readdirSync(source, { recursive: true })
  .filter((file) => file.endsWith('.md'))
  .sort()
  .map((file) => {
    const text = readFileSync(join(source, file), 'utf8')
    const route = field(text, 'route')
    return `- [${field(text, 'title') ?? file}](./pages/${file.split('\\').join('/')})${route ? ` — ${route}` : ''}`
  })
if (!pages.length) throw new Error(`${source} contains no Markdown pages.`)

const directories = [
  '.',
  ...(existsSync('packages') ? readdirSync('packages').map((name) => join('packages', name)) : []),
]
for (const directory of directories) {
  if (!existsSync(join(directory, 'package.json'))) continue
  const pkg = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
  if (pkg.private) continue
  const output = join(directory, 'dist', 'agent')
  rmSync(output, { recursive: true, force: true })
  cpSync(source, join(output, 'pages'), { recursive: true })
  writeFileSync(
    join(output, 'AGENTS.md'),
    [
      `# ${pkg.name} ${pkg.version} documentation`,
      '',
      `These pages match the installed version ${pkg.version}. Prefer them over the`,
      'website, which may describe a different version.',
      '',
      ...pages,
      '',
    ].join('\n'),
  )
}

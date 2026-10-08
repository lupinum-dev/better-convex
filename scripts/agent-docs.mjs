// Copies the rendered docs site into every published package as dist/agent/,
// exported as `<package>/agent-docs`. Coding agents in consuming projects then
// read documentation that matches the installed version. Run after the docs build.
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const source = 'docs/.output/public/raw'
if (!existsSync(source)) throw new Error(`${source} is missing. Run pnpm docs:build first.`)
if (!readdirSync(source, { recursive: true }).some(file => file.endsWith('.md'))) throw new Error(`${source} contains no Markdown pages.`)

// The site's llms.txt is the index: pages in navigation order, each with the description agents
// match on. Its links point at /raw/ on the website; here they point at the copied pages.
const llms = 'docs/.output/public/llms.txt'
if (!existsSync(llms)) throw new Error(`${llms} is missing. Ginko Docs writes it during pnpm docs:build.`)
const index = readFileSync(llms, 'utf8').replace(/\]\(https?:\/\/[^/)\s]+\/raw\//g, '](./pages/').trim()

const directories = ['.', ...(existsSync('packages') ? readdirSync('packages').map(name => join('packages', name)) : [])]
for (const directory of directories) {
  if (!existsSync(join(directory, 'package.json'))) continue
  const pkg = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
  if (pkg.private) continue
  const output = join(directory, 'dist', 'agent')
  rmSync(output, { recursive: true, force: true })
  cpSync(source, join(output, 'pages'), { recursive: true })
  writeFileSync(join(output, 'AGENTS.md'), [
    `# ${pkg.name} ${pkg.version} documentation`,
    '',
    `These pages document the installed version ${pkg.version}. Prefer them over what you`,
    'remember about this package and over the website, which may describe another version.',
    'Read the pages that match the task before you write code. If they do not answer a question,',
    'the user can ask in the Lupinum OSS Discord: https://discord.lupinum.com',
    '',
    index.replace(/^# .*\n+/, ''),
    '',
  ].join('\n'))
}

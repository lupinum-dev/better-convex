// Copies the rendered docs site into every published package as dist/agent/,
// exported as `<package>/agent-docs`. Coding agents in consuming projects then
// read documentation that matches the installed version. Run after the docs build.
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'

const source = 'docs/.output/public/raw'
const content = 'docs/content/docs'
if (!existsSync(source)) throw new Error(`${source} is missing. Run pnpm docs:build first.`)

// Docs routes in navigation order: content files sorted by their numeric prefixes.
const stripOrder = (segment) => segment.replace(/^\d+\./, '')
const routeOrder = readdirSync(content, { recursive: true })
  .map((file) => file.split('\\').join('/'))
  .filter((file) => file.endsWith('.md'))
  .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
  .map((file) => {
    const route = file.replace(/\.md$/, '').split('/').map(stripOrder).join('/')
    return route === 'index' ? '/docs' : `/docs/${route}`
  })

const field = (text, name) => new RegExp(`^${name}:\\s*["']?(.*?)["']?\\s*$`, 'm').exec(text)?.[1]
const pages = readdirSync(source, { recursive: true })
  .map((file) => file.split('\\').join('/'))
  .filter((file) => file.endsWith('.md'))
  .map((file) => {
    const text = readFileSync(join(source, file), 'utf8')
    return { file, text, title: field(text, 'title') ?? file, route: field(text, 'route') }
  })
if (!pages.length) throw new Error(`${source} contains no Markdown pages.`)
const position = (page) => {
  if (page.route === '/docs') return -1
  const index = routeOrder.indexOf(page.route)
  return index === -1 ? routeOrder.length : index
}
pages.sort((a, b) => position(a) - position(b) || a.file.localeCompare(b.file))

const byRoute = new Map(pages.map((page) => [page.route, page]))
const pageLink = (route) => {
  const page = byRoute.get(route)
  if (!page) throw new Error(`The agent docs entry page links to ${route}, which has no page.`)
  return `[${page.title}](./pages/${page.file})`
}

// The rendered pages link to `/raw/<path>.md` on the docs site. Inside the
// package, rewrite those links so they resolve relative to each page.
const localLinks = (page) =>
  page.text.replace(/\]\(\/raw\/([^)#\s]+\.md)(#[^)\s]*)?\)/g, (match, target, anchor = '') => {
    if (!existsSync(join(source, target))) return match
    const link = relative(dirname(page.file), target).split('\\').join('/')
    return `](${link.startsWith('.') ? link : `./${link}`}${anchor})`
  })

const startHere = [
  [
    'Add Better Convex to a Nuxt app',
    [
      '/docs/get-started/installation',
      '/docs/get-started/first-realtime-page',
      '/docs/get-started/add-a-mutation',
    ],
  ],
  ['Use Vue without Nuxt', ['/docs/get-started/plain-vue']],
  [
    'Add sign-in and protect data',
    [
      '/docs/get-started/add-authentication',
      '/docs/get-started/protect-data',
      '/docs/build/authentication/backend-authorization',
    ],
  ],
  [
    'Query with changing inputs',
    ['/docs/build/queries/reactive-arguments', '/docs/build/queries/loading-and-stale-data'],
  ],
  ['Load a long list', ['/docs/build/queries/pagination', '/docs/recipes/infinite-scroll']],
  [
    'Update the page before the server answers',
    ['/docs/build/write-data/optimistic-updates', '/docs/recipes/optimistic-todo-list'],
  ],
  ['Upload files', ['/docs/build/files/upload-files', '/docs/recipes/file-upload-form']],
  [
    'Call Convex from Nuxt server routes',
    ['/docs/build/server/server-convex', '/docs/build/server/server-routes'],
  ],
  [
    'Handle errors',
    ['/docs/build/application-behavior/error-handling', '/docs/reference/error-types'],
  ],
  [
    'Check a setup or find a problem',
    ['/docs/get-started/installation', '/docs/operations/troubleshooting'],
  ],
  ['Upgrade from a beta', ['/docs/operations/upgrade-to-1-0']],
  ['Look up options and return values', ['/docs/reference/composables']],
]

const rules = [
  'Convex functions decide what a user may read or change. Check the user and the resource inside every protected query and mutation. The `auth` option of a composable and route middleware only control what the page shows.',
  'Destructure the composables: `const { mutate: createTodo, pending } = useConvexMutation(api.todos.create)`. The 1.0 betas returned a callable handle; that API no longer exists.',
  "Query arguments are a plain object, a ref, a computed value, a getter, or the literal `'skip'`. Each top-level field can also be a ref. Mutations, actions, and forms read their arguments once, when you call them.",
  "`'skip'` stops the query and clears its data, also with `keepPreviousData`.",
  'In an optimistic update, read the current result with `store.getQuery()` and IDs from `args`, not from component state, and create complete documents. Convex runs the update again when new server data arrives.',
  'For local development without a Convex account, run `pnpm exec better-convex convex dev --anonymous`. Run Nuxt commands with `--dotenv .env.local`.',
]

const sectionName = (route) => {
  const segment = route.split('/')[2]
  if (!segment) return 'Overview'
  return segment.charAt(0).toUpperCase() + segment.slice(1).replaceAll('-', ' ')
}
const index = []
let section
for (const page of pages) {
  const name = sectionName(page.route ?? '')
  if (name !== section) {
    section = name
    index.push('', `### ${name}`, '')
  }
  index.push(`- [${page.title}](./pages/${page.file})`)
}

const entryPage = (pkg) =>
  [
    `# ${pkg.name} ${pkg.version} documentation`,
    '',
    `These pages describe the installed version ${pkg.version}. Prefer them over the`,
    'website and over knowledge of earlier versions: the API changed during the 1.0 betas.',
    '',
    '## Start here',
    '',
    '| Task | Read in this order |',
    '| ---- | ------------------ |',
    ...startHere.map(([task, routes]) => `| ${task} | ${routes.map(pageLink).join(' → ')} |`),
    '',
    '## Rules',
    '',
    ...rules.map((rule) => `- ${rule}`),
    '',
    '## All pages',
    ...index,
    '',
  ].join('\n')

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
  for (const page of pages) {
    const text = localLinks(page)
    const broken = /\]\(\/raw\/[^)]*\)/.exec(text)
    if (broken) throw new Error(`${page.file} links to a missing page: ${broken[0]}`)
    writeFileSync(join(output, 'pages', page.file), text)
  }
  writeFileSync(join(output, 'AGENTS.md'), entryPage(pkg))
}

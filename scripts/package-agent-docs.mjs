import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { URL } from 'node:url'

import { parse } from 'yaml'

const entryExport = './dist/agent/AGENTS.md'
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')

function inside(root, path) {
  const rel = relative(root, path)
  if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`))
    throw new Error(`Documentation path escapes its root: ${path}`)
  return path
}

async function regularFile(root, path) {
  inside(root, path)
  if (!(await lstat(path)).isFile()) throw new Error(`Expected a documentation file: ${path}`)
  inside(await realpath(root), await realpath(path))
  return readFile(path)
}

async function markdownFiles(root, directory = root) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isSymbolicLink()) throw new Error(`Documentation must not contain symlinks: ${path}`)
    if (entry.isDirectory()) files.push(...(await markdownFiles(root, path)))
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(path)
  }
  return files.sort()
}

function isCanonicalUrl(value) {
  if (typeof value !== 'string') return false
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol)
  } catch {
    return false
  }
}

function pageMetadata(source, path) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(source)
  if (!match) throw new Error(`Generated page has no metadata: ${path}`)
  const meta = parse(match[1])
  if (
    !meta ||
    typeof meta.title !== 'string' ||
    !meta.title.trim() ||
    typeof meta.route !== 'string' ||
    !meta.route.startsWith('/') ||
    meta.route.startsWith('//') ||
    [...meta.route].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
    !isCanonicalUrl(meta.url)
  ) {
    throw new Error(`Generated page requires title, route and canonical URL: ${path}`)
  }
  return { title: meta.title, route: meta.route, url: meta.url }
}

async function packageIdentity(packageRoot) {
  const pkg = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
  if (
    pkg.private ||
    typeof pkg.name !== 'string' ||
    !pkg.name.trim() ||
    typeof pkg.version !== 'string' ||
    !pkg.version.trim()
  )
    throw new Error('Expected a public versioned package.')
  if (pkg.exports?.['./agent-docs'] !== entryExport)
    throw new Error(`Package must export ./agent-docs as ${entryExport}.`)
  return pkg
}

// The source is already rendered by Ginko Content. This helper packages bytes;
// it does not parse authored components or implement another Markdown renderer.
export async function buildPackageAgentDocs({ packageRoot, sourceRoot, startRoutes }) {
  packageRoot = resolve(packageRoot)
  sourceRoot = await realpath(sourceRoot)
  const pkg = await packageIdentity(packageRoot)
  if (
    !Array.isArray(startRoutes) ||
    startRoutes.length === 0 ||
    new Set(startRoutes).size !== startRoutes.length
  ) {
    throw new Error('Select at least one unique starting route.')
  }
  const pages = []
  const sources = new Map()
  for (const path of await markdownFiles(sourceRoot)) {
    const bytes = await regularFile(sourceRoot, path)
    const file = `pages/${relative(sourceRoot, path).split(sep).join('/')}`
    const metadata = pageMetadata(bytes.toString('utf8'), path)
    if (pages.some((page) => page.route === metadata.route || page.url === metadata.url))
      throw new Error(`Duplicate documented route: ${metadata.route}`)
    pages.push({ ...metadata, file, sha256: hash(bytes) })
    sources.set(file, bytes)
  }
  if (!pages.length) throw new Error('Generated public documentation is empty.')
  for (const route of startRoutes) {
    if (!pages.some((page) => page.route === route))
      throw new Error(`Starting route is missing: ${route}`)
  }
  const label = (value) => value.replace(/[\r\n[\]\\]/gu, ' ')
  const encodeSegment = (segment) =>
    encodeURIComponent(segment).replace(
      /[()]/gu,
      (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
    )
  const link = (page) =>
    `- [${label(page.title)}](./${page.file.split('/').map(encodeSegment).join('/')}) — ${page.route}`
  const entry = [
    `# ${pkg.name}`,
    '',
    `Documentation for installed version ${pkg.version}.`,
    '',
    'Read the relevant local pages before changing this package’s integration.',
    'Project instructions govern architecture, style and permissions.',
    '',
    '## Start here',
    '',
    ...startRoutes.map((route) => link(pages.find((page) => page.route === route))),
    '',
    '## Find a page',
    '',
    'The index below maps public documentation routes to this installed snapshot.',
    'For links to this documentation site, use the matching local page in manifest.json',
    'instead of fetching a possibly different website version. Preserve URL fragments.',
    'External dependencies have their own versioned contracts. Report missing guidance.',
    '',
    ...pages.map(link),
    '',
  ].join('\n')
  const manifest = {
    schemaVersion: 1,
    name: pkg.name,
    version: pkg.version,
    entrySha256: hash(entry),
    startRoutes,
    pages,
  }
  const output = join(packageRoot, 'dist', 'agent')
  await mkdir(dirname(output), { recursive: true })
  inside(await realpath(packageRoot), await realpath(dirname(output)))
  try {
    if ((await lstat(output)).isSymbolicLink())
      throw new Error('Documentation output must not be a symlink.')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  await rm(output, { recursive: true, force: true })
  for (const [file, bytes] of sources) {
    const destination = inside(output, resolve(output, file))
    await mkdir(dirname(destination), { recursive: true })
    await writeFile(destination, bytes)
  }
  await writeFile(join(output, 'AGENTS.md'), entry)
  // Write the inventory last. Interrupted builds fail verification before packing;
  // the runtime build already removes previous dist output. No watch reader uses it.
  await writeFile(join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  return manifest
}

export async function verifyPackageAgentDocs(packageRoot, { sourceRoot } = {}) {
  packageRoot = resolve(packageRoot)
  const pkg = await packageIdentity(packageRoot)
  const root = join(packageRoot, 'dist', 'agent')
  inside(await realpath(packageRoot), await realpath(root))
  const manifest = JSON.parse(
    (await regularFile(root, join(root, 'manifest.json'))).toString('utf8'),
  )
  if (
    manifest.schemaVersion !== 1 ||
    manifest.name !== pkg.name ||
    manifest.version !== pkg.version
  ) {
    throw new Error('Installed documentation identity differs from its package.')
  }
  const entry = await regularFile(root, join(root, 'AGENTS.md'))
  if (manifest.entrySha256 !== hash(entry))
    throw new Error('Documentation entry changed after generation.')
  if (
    !Array.isArray(manifest.pages) ||
    !manifest.pages.length ||
    !Array.isArray(manifest.startRoutes) ||
    !manifest.startRoutes.length
  ) {
    throw new Error('Documentation page inventory is missing.')
  }
  const expected = new Set(['AGENTS.md'])
  const routes = new Set()
  for (const page of manifest.pages) {
    if (
      typeof page.file !== 'string' ||
      !page.file.startsWith('pages/') ||
      !page.file.endsWith('.md') ||
      expected.has(page.file)
    ) {
      throw new Error('Invalid or duplicate documentation page path.')
    }
    const bytes = await regularFile(root, inside(root, resolve(root, page.file)))
    const metadata = pageMetadata(bytes.toString('utf8'), page.file)
    if (
      page.sha256 !== hash(bytes) ||
      metadata.route !== page.route ||
      metadata.url !== page.url ||
      metadata.title !== page.title ||
      routes.has(page.route)
    ) {
      throw new Error(`Documentation page differs from its inventory: ${page.file}`)
    }
    expected.add(page.file)
    routes.add(page.route)
  }
  if (manifest.startRoutes.some((route) => !routes.has(route)))
    throw new Error('Documentation starting route is missing.')
  const actual = (await markdownFiles(root)).map((file) =>
    relative(root, file).split(sep).join('/'),
  )
  if (actual.length !== expected.size || actual.some((file) => !expected.has(file)))
    throw new Error('Documentation has untracked Markdown pages.')
  if (sourceRoot) {
    sourceRoot = await realpath(sourceRoot)
    const files = await markdownFiles(sourceRoot)
    if (files.length !== manifest.pages.length)
      throw new Error('Documentation snapshot is stale: source page inventory changed.')
    for (const file of files) {
      const outputFile = `pages/${relative(sourceRoot, file).split(sep).join('/')}`
      const page = manifest.pages.find((page) => page.file === outputFile)
      if (!page || page.sha256 !== hash(await regularFile(sourceRoot, file))) {
        throw new Error(`Documentation snapshot is stale: ${outputFile}`)
      }
    }
  }
  return manifest
}

import { spawn, type ChildProcess } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseEnv } from 'node:util'

import { hasConvexAuthorityFile, resolveConvexInvocation } from './convex'

const LOCAL_ENV_FILE = '.env.local'
// Nuxt needs the deployment URLs from `.env.local`, not the deployment selector or keys.
const NUXT_CONVEX_NAMES = new Set(['CONVEX_SITE_URL', 'CONVEX_URL'])

function usage(): string {
  return [
    'Run `convex dev` and `nuxt dev` together. Ctrl-C stops both.',
    '',
    'Usage:',
    '  better-convex-nuxt dev [nuxt dev options]',
    '',
    `Without a deployment in ${LOCAL_ENV_FILE}, Convex starts a local backend that needs no`,
    'account. Nuxt starts once Convex has written the deployment URL, with the values from',
    `${LOCAL_ENV_FILE} on top of its own .env.`,
  ].join('\n')
}

async function readLocalEnvironment(cwd: string): Promise<Record<string, string>> {
  let source: string
  try {
    source = await readFile(resolve(cwd, LOCAL_ENV_FILE), 'utf8')
  } catch {
    return {}
  }
  return Object.fromEntries(
    Object.entries(parseEnv(source)).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined &&
        (!entry[0].toUpperCase().startsWith('CONVEX_') || NUXT_CONVEX_NAMES.has(entry[0])),
    ),
  )
}

/** Copy a child's output with a name in front of every line; partial lines (prompts) pass at once. */
function forward(stream: NodeJS.ReadableStream | null, out: NodeJS.WriteStream, name: string) {
  if (!stream) return
  let lineStart = true
  stream.setEncoding('utf8')
  stream.on('data', (chunk: string) => {
    const lines = chunk.split('\n')
    const text = lines
      .map((line, index) => {
        const last = index === lines.length - 1
        if (last && line === '') return line
        return index > 0 || lineStart ? `${name} ${line}` : line
      })
      .join('\n')
    lineStart = chunk.endsWith('\n')
    out.write(text)
  })
}

function exited(child: ChildProcess): Promise<number> {
  return new Promise((resolvePromise) => {
    if (child.exitCode !== null) resolvePromise(child.exitCode)
    else child.once('exit', (code, signal) => resolvePromise(code ?? (signal ? 1 : 0)))
  })
}

export async function runDevCommand(
  args: readonly string[],
  options: { cwd?: string } = {},
): Promise<number> {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(usage())
    return 0
  }
  const cwd = resolve(options.cwd ?? process.cwd())
  const anonymous = !(await hasConvexAuthorityFile(cwd))
  const convex = await resolveConvexInvocation(anonymous ? ['dev', '--anonymous'] : ['dev'], {
    cwd,
    developmentOnly: !anonymous,
  })
  const color = process.stdout.isTTY ? { FORCE_COLOR: '1' } : {}
  const children: ChildProcess[] = []
  const stopAll = () => {
    for (const child of children) if (child.exitCode === null) child.kill('SIGTERM')
  }
  // Ctrl-C reaches both children through the terminal; wait for them instead of exiting first.
  const onSignal = () => stopAll()
  process.on('SIGINT', onSignal)
  process.on('SIGTERM', onSignal)
  try {
    const convexChild = spawn(process.execPath, convex.args, {
      cwd,
      env: { ...convex.env, ...color },
      // Convex may ask a question (for example to log in), so it keeps the terminal's input.
      stdio: ['inherit', 'pipe', 'pipe'],
    })
    children.push(convexChild)
    forward(convexChild.stdout, process.stdout, '[convex]')
    forward(convexChild.stderr, process.stderr, '[convex]')
    const convexExit = exited(convexChild)

    // Nuxt reads the deployment URL once at startup, and a first run writes it only after the
    // backend is up.
    let local = await readLocalEnvironment(cwd)
    while (!local.CONVEX_URL) {
      const stopped = await Promise.race([
        convexExit.then(() => true),
        new Promise<false>((resolvePromise) => setTimeout(() => resolvePromise(false), 250)),
      ])
      if (stopped) return await convexExit
      local = await readLocalEnvironment(cwd)
    }
    if (anonymous) {
      console.log(
        '[better-convex-nuxt] Local Convex backend. Open its dashboard with: pnpm exec better-convex-nuxt convex dashboard',
      )
    }

    const nuxtChild = spawn(
      process.execPath,
      [resolve(cwd, 'node_modules/nuxt/bin/nuxt.mjs'), 'dev', ...args],
      { cwd, env: { ...process.env, ...local, ...color }, stdio: ['ignore', 'pipe', 'pipe'] },
    )
    children.push(nuxtChild)
    forward(nuxtChild.stdout, process.stdout, '[nuxt]  ')
    forward(nuxtChild.stderr, process.stderr, '[nuxt]  ')
    const nuxtExit = exited(nuxtChild)

    // When one side stops, stop the other: half a dev setup only produces confusing errors.
    const first = await Promise.race([convexExit, nuxtExit])
    stopAll()
    const [convexCode, nuxtCode] = await Promise.all([convexExit, nuxtExit])
    return first || convexCode || nuxtCode
  } finally {
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
    stopAll()
  }
}

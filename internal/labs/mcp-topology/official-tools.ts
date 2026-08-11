import { execFile as execFileCallback } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)

export const MCP_CONFORMANCE_PREFLIGHT_VERSION = '0.2.0-alpha.10'
export const MCP_INSPECTOR_VERSION = '2.0.0'
const maximumRelayBodyBytes = 1024 * 1024
const maximumRelayResponseBytes = 2 * 1024 * 1024
const officialToolTimeoutMs = 60_000

interface OfficialToolProbeOptions {
  endpoint: URL
  label: string
  repositoryRoot: string
  token: string
}

export interface OfficialToolProbeResult {
  conformanceScenarios: readonly string[]
  inspectorMethods: readonly string[]
}

function assertOutputIsSafe(output: string, token: string, label: string): void {
  if (output.includes(token)) throw new Error(`${label} exposed the lab bearer token`)
}

async function runPackageCli(
  repositoryRoot: string,
  packageSpec: string,
  args: readonly string[],
  redactions: readonly string[],
): Promise<string> {
  try {
    const { stderr, stdout } = await execFile('pnpm', ['dlx', packageSpec, ...args], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      timeout: officialToolTimeoutMs,
    })
    return `${stdout}\n${stderr}`
  } catch (error) {
    const output =
      error && typeof error === 'object'
        ? `${String('stdout' in error ? error.stdout : '')}\n${String(
            'stderr' in error ? error.stderr : '',
          )}`
        : ''
    const safeOutput = redactions.reduce(
      (current, secret) => current.replaceAll(secret, '[REDACTED]'),
      output,
    )
    throw new Error(
      `${packageSpec} exited unsuccessfully${safeOutput.trim() ? `:\n${safeOutput.slice(0, 8192)}` : ''}`,
      { cause: error },
    )
  }
}

async function readRequestBody(request: import('node:http').IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += bytes.byteLength
    if (total > maximumRelayBodyBytes) throw new Error('Conformance relay body exceeded its bound')
    chunks.push(bytes)
  }
  return Buffer.concat(chunks, total)
}

function copyRequestHeaders(request: import('node:http').IncomingMessage, token: string): Headers {
  const headers = new Headers()
  for (const [name, value] of Object.entries(request.headers)) {
    if (
      value === undefined ||
      name === 'authorization' ||
      name === 'connection' ||
      name === 'host' ||
      name === 'transfer-encoding'
    ) {
      continue
    }
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item)
    } else {
      headers.set(name, value)
    }
  }
  headers.set('authorization', `Bearer ${token}`)
  return headers
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
}

async function createConformanceAuthRelay(
  endpoint: URL,
  token: string,
): Promise<{
  close(): Promise<void>
  url: URL
}> {
  const server = createServer(async (request, response) => {
    try {
      const incomingUrl = new URL(request.url ?? '/', 'http://relay.invalid')
      if (incomingUrl.pathname !== endpoint.pathname || incomingUrl.search !== endpoint.search) {
        response.writeHead(404, { 'cache-control': 'no-store' }).end()
        return
      }
      const method = request.method ?? 'GET'
      const body =
        method === 'GET' || method === 'HEAD' ? undefined : await readRequestBody(request)
      const upstream = await fetch(endpoint, {
        body: body ? new Uint8Array(body).buffer : undefined,
        headers: copyRequestHeaders(request, token),
        method,
        redirect: 'manual',
        signal: AbortSignal.timeout(10_000),
      })
      const headers = Object.fromEntries(
        [...upstream.headers].filter(
          ([name]) =>
            name !== 'connection' && name !== 'content-length' && name !== 'transfer-encoding',
        ),
      )
      const responseBody = Buffer.from(await upstream.arrayBuffer())
      if (responseBody.byteLength > maximumRelayResponseBytes) {
        response.writeHead(502, { 'cache-control': 'no-store' }).end()
        return
      }
      response.writeHead(upstream.status, headers)
      response.end(responseBody)
    } catch {
      response.writeHead(502, { 'cache-control': 'no-store' }).end()
    }
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    await closeServer(server)
    throw new Error('Conformance relay did not receive a loopback port')
  }
  return {
    close: () => closeServer(server),
    url: new URL(endpoint.pathname, `http://127.0.0.1:${address.port}`),
  }
}

async function collectConformanceChecks(directory: string): Promise<unknown[]> {
  const checks: unknown[] = []
  const visit = async (current: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name)
      if (entry.isDirectory()) await visit(target)
      else if (entry.isFile() && entry.name === 'checks.json') {
        const parsed = JSON.parse(await readFile(target, 'utf8'))
        if (!Array.isArray(parsed)) throw new Error('Official conformance checks must be an array')
        checks.push(...parsed)
      }
    }
  }
  await visit(directory)
  return checks
}

/**
 * Executes published official tools against one already-running private topology candidate.
 * The relay adds only the lab bearer because the conformance CLI has no header option. It owns no
 * protocol behavior and is deleted with the temporary result directory after every run.
 */
export async function runOfficialMcpToolProbe(
  options: OfficialToolProbeOptions,
): Promise<OfficialToolProbeResult> {
  const inspectorProbes = [
    { args: [], expected: 'search_notes', method: 'tools/list' },
    {
      args: ['--tool-name', 'search_notes', '--tool-arg', 'workspaceId=workspace-a', 'query=alpha'],
      expected: 'note-a',
      method: 'tools/call',
    },
    { args: [], expected: 'note://{id}', method: 'resources/templates/list' },
    {
      args: ['--uri', 'note://note-a'],
      expected: 'Alpha',
      method: 'resources/read',
    },
  ] as const
  const inspectorMethods = inspectorProbes.map((probe) => probe.method)
  const inspectorDirectory = await mkdtemp(path.join(tmpdir(), 'better-convex-mcp-inspector-'))
  const inspectorConfig = path.join(inspectorDirectory, 'mcp.json')
  await writeFile(
    inspectorConfig,
    JSON.stringify({
      mcpServers: {
        candidate: {
          headers: { Authorization: `Bearer ${options.token}` },
          protocolEra: 'modern',
          type: 'streamable-http',
          url: options.endpoint.href,
        },
      },
    }),
    { mode: 0o600 },
  )
  try {
    for (const probe of inspectorProbes) {
      const output = await runPackageCli(
        options.repositoryRoot,
        `@modelcontextprotocol/inspector@${MCP_INSPECTOR_VERSION}`,
        [
          '--cli',
          '--config',
          inspectorConfig,
          '--server',
          'candidate',
          '--method',
          probe.method,
          ...probe.args,
        ],
        [options.token],
      )
      assertOutputIsSafe(output, options.token, `${options.label} Inspector ${probe.method}`)
      if (!output.includes(probe.expected)) {
        throw new Error(
          `${options.label} Inspector ${probe.method} did not observe ${probe.expected}`,
        )
      }
    }
  } finally {
    await rm(inspectorDirectory, { force: true, recursive: true })
  }

  const relay = await createConformanceAuthRelay(options.endpoint, options.token)
  const outputDirectory = await mkdtemp(path.join(tmpdir(), 'better-convex-mcp-conformance-'))
  const conformanceScenarios = ['tools-list', 'resources-list', 'http-header-validation'] as const
  try {
    for (const scenario of conformanceScenarios) {
      const scenarioDirectory = path.join(outputDirectory, scenario)
      const output = await runPackageCli(
        options.repositoryRoot,
        `@modelcontextprotocol/conformance@${MCP_CONFORMANCE_PREFLIGHT_VERSION}`,
        [
          'server',
          '--url',
          relay.url.href,
          '--scenario',
          scenario,
          '--spec-version',
          '2026-07-28',
          '--output-dir',
          scenarioDirectory,
        ],
        [options.token],
      )
      assertOutputIsSafe(output, options.token, `${options.label} conformance ${scenario}`)
      const checks = await collectConformanceChecks(scenarioDirectory)
      if (checks.length === 0) {
        throw new Error(`${options.label} conformance ${scenario} produced no checks`)
      }
    }
  } finally {
    await relay.close()
    await rm(outputDirectory, { force: true, recursive: true })
  }

  return { conformanceScenarios, inspectorMethods }
}

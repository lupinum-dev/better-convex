import { chromium, type Page } from 'playwright'

import type { NotesDashboardBuild } from './build'

interface ToolCall {
  readonly arguments?: Record<string, unknown>
  readonly name: string
}

interface HostSnapshot {
  readonly initialized: number
  readonly messageBytes: string
  readonly openLinkCalls: number
  readonly openLinkUrls: string[]
  readonly teardownResponses: number
  readonly toolArgumentKeys: string[][]
  readonly toolNames: string[]
  readonly wrongSourcePosts: number
}

export interface NotesDashboardBrowserProof {
  readonly appHtmlBytes: number
  readonly firstMount: HostSnapshot
  readonly secondMount: HostSnapshot
  readonly toolCalls: readonly ToolCall[]
}

export interface NotesDashboardBrowserProofOptions {
  readonly additionalSecretSentinels?: readonly string[]
  readonly build: NotesDashboardBuild
  readonly callTool: (call: ToolCall) => Promise<unknown>
}

const HOST_ORIGIN = 'https://apps-lab.invalid'
const APP_ORIGIN = 'https://app-frame.invalid'
const APP_PATH = '/notes-dashboard.html'
const HOST_TOOL_PATH = '/__better_convex_mcp_tool__'
const SECRET_SENTINELS = Object.freeze([
  'cookie-sentinel-4e9e9f24',
  'mcp-bearer-sentinel-136ef36a',
  'convex-jwt-sentinel-59b7ac2c',
  'service-proof-sentinel-c0be5bb9',
  'provider-reference-sentinel-8ae47ad8',
  'raw-cause-sentinel-40da90d0',
  'raw-convex-client-sentinel-a0d931e7',
])

function hostHtml(javaScript: string): string {
  const escapedJavaScript = javaScript.replaceAll('</script', '<\\/script')
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="UTF-8">',
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-src ${APP_ORIGIN}; base-uri 'none'; object-src 'none'">`,
    '</head>',
    '<body>',
    `<script>Object.defineProperty(window,'__BCN_HOST_ONLY_SECRETS__',{value:Object.freeze(${JSON.stringify(SECRET_SENTINELS)}),enumerable:false})</script>`,
    `<script>${escapedJavaScript}</script>`,
    '</body>',
    '</html>',
  ].join('')
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function waitForValue<T>(
  read: () => Promise<T>,
  accepts: (value: T) => boolean,
  label: string,
): Promise<T> {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const value = await read()
    if (accepts(value)) return value
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`Timed out waiting for ${label}`)
}

async function snapshot(page: Page): Promise<HostSnapshot> {
  return page.evaluate(() => window.__BCN_MCP_APPS_HOST__.snapshot())
}

async function mount(
  page: Page,
  openLinks: boolean,
  initialInput?: Record<string, unknown>,
): Promise<void> {
  await page.evaluate(
    async ({ input, links, url }) => {
      await window.__BCN_MCP_APPS_HOST__.mount({
        ...(input === undefined ? {} : { initialInput: input }),
        openLinks: links,
        url,
      })
    },
    { input: initialInput, links: openLinks, url: `${APP_ORIGIN}${APP_PATH}` },
  )
}

async function teardown(page: Page): Promise<HostSnapshot> {
  const iframe = page.locator('iframe[data-testid="notes-dashboard-frame"]')
  await page.evaluate(async () => window.__BCN_MCP_APPS_HOST__.teardown())
  await iframe.waitFor({ state: 'detached' })
  return snapshot(page)
}

/**
 * Private browser proof. The App receives only the official postMessage bridge; the real MCP client
 * remains in the Node test and is reachable only through an allowlisted host endpoint.
 */
export async function proveNotesDashboardBrowserBoundary(
  options: NotesDashboardBrowserProofOptions,
): Promise<NotesDashboardBrowserProof> {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext().catch(async (error: unknown) => {
    await browser.close()
    throw error
  })
  const page = await context.newPage().catch(async (error: unknown) => {
    await context.close()
    await browser.close()
    throw error
  })
  const toolCalls: ToolCall[] = []
  const consoleErrors: string[] = []
  const consoleMessages: string[] = []
  const consoleTexts: string[] = []
  const consoleCaptures: Promise<void>[] = []
  const pageErrors: string[] = []
  const failedRequests: string[] = []
  const requestUrls: string[] = []
  const toolRequestBodies: string[] = []
  let hostCookieObserved = false
  let appCookieObserved = false

  page.on('console', (message) => {
    consoleTexts.push(message.text())
    if (message.type() === 'error') consoleErrors.push(message.text())
    consoleCaptures.push(
      Promise.all(
        message.args().map(async (argument) => {
          try {
            const value = await argument.evaluate((candidate) =>
              candidate instanceof MessageEvent
                ? {
                    data: candidate.data,
                    origin: candidate.origin,
                    type: candidate.type,
                  }
                : candidate,
            )
            return JSON.stringify(value) ?? String(value)
          } catch {
            return '<unserializable>'
          }
        }),
      ).then((values) => {
        consoleMessages.push([message.type(), message.text(), ...values].join('\n'))
      }),
    )
  })
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('requestfailed', (request) => failedRequests.push(request.url()))
  page.on('request', (request) => requestUrls.push(request.url()))

  try {
    await context.addCookies([
      {
        domain: 'apps-lab.invalid',
        httpOnly: true,
        name: 'bcn_session',
        path: '/',
        sameSite: 'Strict',
        secure: true,
        value: SECRET_SENTINELS[0]!,
      },
    ])

    await page.route(`${HOST_ORIGIN}/**`, async (route) => {
      const request = route.request()
      const url = new URL(request.url())
      if (url.pathname === '/' && request.method() === 'GET') {
        hostCookieObserved = request.headers().cookie?.includes(SECRET_SENTINELS[0]!) === true
        await route.fulfill({
          body: hostHtml(options.build.hostJavaScript),
          contentType: 'text/html',
          status: 200,
        })
        return
      }
      if (url.pathname === HOST_TOOL_PATH && request.method() === 'POST') {
        const body = request.postData() ?? ''
        toolRequestBodies.push(body)
        const parsed = JSON.parse(body) as ToolCall
        assert(
          parsed.name === 'search_notes' && parsed.arguments !== undefined,
          'The proof host forwarded a non-allowlisted MCP operation',
        )
        assert(
          Object.keys(parsed).sort().join(',') === 'arguments,name',
          `The proof host forwarded hidden call context: ${Object.keys(parsed).sort().join(',')}`,
        )
        toolCalls.push(parsed)
        const result = await options.callTool(parsed)
        await route.fulfill({
          body: JSON.stringify(result),
          contentType: 'application/json',
          status: 200,
        })
        return
      }
      await route.abort('blockedbyclient')
    })
    await page.route(`${APP_ORIGIN}/**`, async (route) => {
      const request = route.request()
      const url = new URL(request.url())
      if (url.pathname === APP_PATH && request.method() === 'GET') {
        appCookieObserved = request.headers().cookie?.includes(SECRET_SENTINELS[0]!) === true
        await route.fulfill({
          body: options.build.appHtml,
          contentType: 'text/html',
          status: 200,
        })
        return
      }
      await route.abort('blockedbyclient')
    })

    await page.goto(`${HOST_ORIGIN}/`)
    await mount(page, false, {
      limit: 1,
      query: 'initial',
      workspaceId: 'workspace-initial',
    })

    const iframe = page.locator('iframe[data-testid="notes-dashboard-frame"]')
    await iframe.waitFor({ state: 'attached' })
    await iframe.evaluate((element) => {
      if (element.getAttribute('sandbox') !== 'allow-scripts') {
        throw new Error('The MCP App iframe requested excess sandbox capabilities')
      }
      if (element.hasAttribute('allow')) {
        throw new Error('The MCP App iframe requested browser permissions')
      }
    })
    const frame = page.frameLocator('iframe[data-testid="notes-dashboard-frame"]')
    await frame.getByTestId('notes-dashboard').waitFor()
    await waitForValue(
      () => frame.getByTestId('workspace').textContent(),
      (value) => value === 'workspace-initial',
      'initial tool input delivered during initialization',
    )

    const input = { limit: 5, query: '', workspaceId: 'workspace-a' }
    await page.evaluate(async () =>
      window.__BCN_MCP_APPS_HOST__.sendPartialInput({
        query: 'alp',
        workspaceId: 'workspace-a',
      }),
    )
    await waitForValue(
      () => frame.getByTestId('partial-query').textContent(),
      (value) => value?.trim() === 'alp',
      'partial tool input delivery',
    )
    await page.evaluate(async (value) => window.__BCN_MCP_APPS_HOST__.sendInput(value), input)
    await waitForValue(
      () => frame.getByTestId('workspace').textContent(),
      (value) => value === 'workspace-a',
      'tool input delivery',
    )
    await waitForValue(
      () => frame.getByTestId('refresh').isEnabled(),
      Boolean,
      'input-enabled refresh',
    )
    const maliciousResult = {
      content: [
        {
          type: 'text' as const,
          text: 'model-visible fallback remains plain text',
        },
      ],
      structuredContent: {
        matches: [
          {
            body: '<img data-attacker src=x onerror="window.__BCN_ATTACK_EXECUTED__=true">',
            id: 'hostile-note',
            revision: 1,
            title: '<script>window.__BCN_ATTACK_EXECUTED__=true</script>',
            uri: 'note://hostile-note',
            workspaceId: 'workspace-a',
          },
        ],
      },
    }
    await page.evaluate(
      async (value) => window.__BCN_MCP_APPS_HOST__.sendResult(value),
      maliciousResult,
    )
    await waitForValue(
      () => frame.getByTestId('notes').textContent(),
      (value) => value?.includes('<img data-attacker') === true,
      'escaped malicious result text',
    )
    assert((await frame.locator('[data-attacker]').count()) === 0, 'Malicious result became DOM')
    assert(
      (await frame
        .locator('html')
        .evaluate(() => Reflect.get(window, '__BCN_ATTACK_EXECUTED__'))) === undefined,
      'Malicious result executed script',
    )

    const repeatedResult = {
      ...maliciousResult,
      structuredContent: {
        matches: [
          {
            body: 'The second result replaced the first result.',
            id: 'second-note',
            revision: 2,
            title: 'Second result',
            uri: 'note://second-note',
            workspaceId: 'workspace-a',
          },
        ],
      },
    }
    await page.evaluate(
      async (value) => window.__BCN_MCP_APPS_HOST__.sendResult(value),
      repeatedResult,
    )
    await waitForValue(
      () => frame.getByTestId('notes').textContent(),
      (value) => value?.includes('Second result') === true,
      'repeated tool result',
    )
    await page.evaluate(async () =>
      window.__BCN_MCP_APPS_HOST__.sendCancelled('host cancelled the prior request'),
    )
    await waitForValue(
      () => frame.getByTestId('cancel-reason').textContent(),
      (value) => value?.trim() === 'host cancelled the prior request',
      'tool cancellation delivery',
    )

    const forgedResult = {
      ...repeatedResult,
      structuredContent: {
        matches: [
          {
            body: 'This wrong-source message must be ignored.',
            id: 'forged-note',
            revision: 3,
            title: 'FORGED WRONG SOURCE',
            uri: 'note://forged-note',
            workspaceId: 'workspace-a',
          },
        ],
      },
    }
    await page.evaluate(
      async (value) => window.__BCN_MCP_APPS_HOST__.sendWrongSource(value),
      forgedResult,
    )
    assert(
      (await snapshot(page)).wrongSourcePosts === 1,
      'The sibling did not post its forged message',
    )
    await waitForValue(
      async () =>
        consoleTexts.some((message) => message.includes('Ignoring message from unknown source')),
      Boolean,
      'official wrong-source rejection',
    )
    assert(
      !(await frame.getByTestId('notes').textContent())?.includes('FORGED WRONG SOURCE'),
      'The App accepted a wrong-source bridge message',
    )

    await page.evaluate(async () => window.__BCN_MCP_APPS_HOST__.setTheme('dark'))
    await waitForValue(
      () => frame.locator('html').getAttribute('data-theme'),
      (value) => value === 'dark',
      'host theme update',
    )

    await frame.getByTestId('query').fill('alpha')
    await frame.getByTestId('limit').fill('5')
    await frame.getByTestId('refresh').click()
    await waitForValue(
      () => snapshot(page),
      (value) => value.toolNames.length >= 1,
      'host-mediated MCP tool request',
    )
    const refreshStatus = await waitForValue(
      () => frame.getByTestId('status').textContent(),
      (value) => value === 'ready' || value === 'error',
      'host-mediated MCP tool call',
    )
    assert(
      refreshStatus === 'ready',
      `The host-mediated MCP tool call failed: ${JSON.stringify({ consoleErrors, failedRequests, host: await snapshot(page), pageErrors, requestUrls, toolCalls })}`,
    )
    await waitForValue(
      () => frame.getByTestId('notes').textContent(),
      (value) => value?.includes('Alpha') === true,
      'real MCP tool result rendering',
    )
    assert(toolCalls.length === 1, 'The allowed App tool call did not reach the host exactly once')

    await page.evaluate(async () =>
      window.__BCN_MCP_APPS_HOST__.sendInput({
        limit: 5,
        query: '',
        workspaceId: 'workspace-b',
      }),
    )
    await frame.getByTestId('refresh').click()
    await waitForValue(
      () => frame.getByTestId('status').textContent(),
      (value) => value === 'error',
      'cross-tenant application denial',
    )
    assert(
      !(await frame.getByTestId('notes').textContent())?.includes('CROSS TENANT SECRET'),
      'A cross-tenant App result escaped application authorization',
    )

    await page.evaluate(async () =>
      window.__BCN_MCP_APPS_HOST__.sendInput({
        limit: 5,
        query: 'revoked',
        workspaceId: 'workspace-a',
      }),
    )
    await frame.getByTestId('refresh').click()
    await waitForValue(
      () => frame.getByTestId('status').textContent(),
      (value) => value === 'error',
      'revoked access denial',
    )
    assert(
      toolCalls.slice().length === 3,
      'The App authorization probes did not reach MCP exactly once',
    )

    await frame.getByTestId('denied-tool').click()
    await waitForValue(
      () => frame.getByTestId('status').textContent(),
      (value) => value === 'tool-denied',
      'denied App write',
    )
    assert(toolCalls.slice().length === 3, 'A denied App tool escaped the host allowlist')
    assert(await frame.getByTestId('open-link').isDisabled(), 'Link capability was fabricated')

    const appOuterHtml = await frame.locator('html').evaluate((element) => element.outerHTML)
    const firstBeforeTeardown = await snapshot(page)
    assert(firstBeforeTeardown.initialized === 1, 'The App initialized more than once')
    assert(firstBeforeTeardown.openLinkCalls === 0, 'A missing link capability was invoked')
    assert(
      firstBeforeTeardown.openLinkUrls.length === 0,
      'A link target escaped without capability',
    )
    assert(
      JSON.stringify(firstBeforeTeardown.toolNames) ===
        JSON.stringify(['search_notes', 'search_notes', 'search_notes', 'rename_note']),
      'Unexpected tools crossed the App Bridge',
    )
    assert(
      JSON.stringify(firstBeforeTeardown.toolArgumentKeys) ===
        JSON.stringify([
          ['limit', 'query', 'workspaceId'],
          ['limit', 'query', 'workspaceId'],
          ['limit', 'query', 'workspaceId'],
          ['noteId', 'requestKey', 'title'],
        ]),
      'The App Bridge forwarded hidden tool arguments',
    )

    const firstMount = await teardown(page)
    assert(firstMount.teardownResponses === 1, 'The App did not complete graceful teardown')

    await mount(page, true)
    const secondFrame = page.frameLocator('iframe[data-testid="notes-dashboard-frame"]')
    await secondFrame.getByTestId('notes-dashboard').waitFor()
    await waitForValue(
      () => secondFrame.getByTestId('open-link').isEnabled(),
      Boolean,
      'negotiated link capability',
    )
    await secondFrame.getByTestId('open-link').click()
    await waitForValue(
      () => secondFrame.getByTestId('status').textContent(),
      (value) => value === 'link-denied',
      'host-denied link request',
    )
    const secondMount = await teardown(page)
    assert(secondMount.initialized === 1, 'A fresh App mount initialized more than once')
    assert(secondMount.openLinkCalls === 1, 'The negotiated link request was not host-mediated')
    assert(
      JSON.stringify(secondMount.openLinkUrls) ===
        JSON.stringify(['https://docs.example.invalid/notes']),
      'The App requested an unexpected external link target',
    )
    assert(secondMount.teardownResponses === 1, 'The remounted App did not tear down cleanly')

    await new Promise((resolve) => setTimeout(resolve, 0))
    await Promise.all([...consoleCaptures])
    assert(hostCookieObserved, 'The host credential sentinel was not present at its outer boundary')
    assert(!appCookieObserved, 'The host credential cookie crossed into the App origin')
    const leakSurfaces = [
      options.build.appHtml,
      options.build.hostJavaScript,
      appOuterHtml,
      firstMount.messageBytes,
      secondMount.messageBytes,
      toolRequestBodies.join('\n'),
      consoleMessages.join('\n'),
      pageErrors.join('\n'),
    ]
    for (const sentinel of [...SECRET_SENTINELS, ...(options.additionalSecretSentinels ?? [])]) {
      assert(
        leakSurfaces.every((surface) => !surface.includes(sentinel)),
        `Credential sentinel escaped into the MCP App boundary: ${sentinel}`,
      )
    }
    assert(
      consoleErrors.length === 0,
      `Unexpected browser console errors: ${consoleErrors.join('; ')}`,
    )
    assert(pageErrors.length === 0, `Unexpected browser page errors: ${pageErrors.join('; ')}`)
    assert(failedRequests.length === 0, `Unexpected failed requests: ${failedRequests.join('; ')}`)
    assert(
      requestUrls.every(
        (url) =>
          url === `${HOST_ORIGIN}/` ||
          url === `${APP_ORIGIN}${APP_PATH}` ||
          url === `${HOST_ORIGIN}${HOST_TOOL_PATH}`,
      ),
      `The MCP App made an unexpected network request: ${requestUrls.join(', ')}`,
    )
    assert(
      !options.build.appHtml.includes('window.open'),
      'The App bundle bypasses host navigation',
    )

    return {
      appHtmlBytes: new TextEncoder().encode(options.build.appHtml).byteLength,
      firstMount,
      secondMount,
      toolCalls,
    }
  } finally {
    await context.close()
    await browser.close()
  }
}

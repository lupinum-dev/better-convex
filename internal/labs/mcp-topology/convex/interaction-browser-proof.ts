import { chromium } from 'playwright'

import {
  interactionUrl,
  INTERACTION_LAB_SESSIONS,
  INTERACTION_ORIGIN,
  INTERACTION_SESSION_COOKIE,
} from './fixture/convex/interaction_page_contract'

export interface InteractionBrowserProof {
  readonly finalStatus: string
  readonly requestMethods: readonly string[]
}

export interface InteractionBrowserProofOptions {
  readonly additionalSecretSentinels: readonly string[]
  readonly locator: string
  readonly siteUrl: string
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export async function proveInteractionBrowserBoundary(
  options: InteractionBrowserProofOptions,
): Promise<InteractionBrowserProof> {
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
  const consoleErrors: string[] = []
  const pageErrors: string[] = []
  const failedRequests: Array<{ error: string; method: string; url: string }> = []
  const requestMethods: string[] = []
  const requestUrls: string[] = []
  const requestDiagnostics: Array<{
    bodyBytes: number
    method: string
    origin: string | null
    referer: string | null
  }> = []
  const responseDiagnostics: Array<{
    location: string | null
    method: string
    status: number
  }> = []
  const responseBodies: string[] = []

  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('requestfailed', (request) =>
    failedRequests.push({
      error: request.failure()?.errorText ?? 'unknown',
      method: request.method(),
      url: request.url(),
    }),
  )

  try {
    await context.addCookies([
      {
        domain: new URL(INTERACTION_ORIGIN).hostname,
        httpOnly: true,
        name: INTERACTION_SESSION_COOKIE,
        path: '/',
        sameSite: 'Strict',
        secure: true,
        value: INTERACTION_LAB_SESSIONS.alice,
      },
    ])
    await page.route(`${INTERACTION_ORIGIN}/**`, async (route) => {
      const browserRequest = route.request()
      requestUrls.push(browserRequest.url())
      const originalUrl = new URL(browserRequest.url())
      const upstreamUrl = new URL(`${originalUrl.pathname}${originalUrl.search}`, options.siteUrl)
      const headers = new Headers(browserRequest.headers())
      headers.delete('content-length')
      headers.delete('host')
      const body =
        browserRequest.method() === 'GET' || browserRequest.method() === 'HEAD'
          ? undefined
          : (browserRequest.postData() ?? '')
      requestMethods.push(browserRequest.method())
      requestDiagnostics.push({
        bodyBytes: body === undefined ? 0 : Buffer.byteLength(body),
        method: browserRequest.method(),
        origin: headers.get('origin'),
        referer: headers.get('referer'),
      })
      const upstream = await fetch(upstreamUrl, {
        ...(body === undefined ? {} : { body }),
        headers,
        method: browserRequest.method(),
        redirect: 'manual',
      })
      const responseBody = Buffer.from(await upstream.arrayBuffer())
      responseBodies.push(responseBody.toString('utf8'))
      responseDiagnostics.push({
        location: upstream.headers.get('location'),
        method: browserRequest.method(),
        status: upstream.status,
      })
      const suppressSyntheticRedirect =
        browserRequest.method() === 'POST' && upstream.status === 303
      await route.fulfill({
        body: responseBody,
        headers: suppressSyntheticRedirect
          ? Object.fromEntries(
              [...upstream.headers].filter(([name]) => name.toLowerCase() !== 'location'),
            )
          : Object.fromEntries(upstream.headers),
        // Chromium races a route-fulfilled same-URL 303 against the explicit canonical GET below.
        // Preserve and assert the real upstream response, but suppress only that synthetic redirect.
        status: suppressSyntheticRedirect ? 204 : upstream.status,
      })
    })

    const reviewedInteractionUrl = interactionUrl(options.locator)
    await page.goto(reviewedInteractionUrl, { waitUntil: 'domcontentloaded' })
    assert(
      (await page.evaluate(() => location.origin)) === INTERACTION_ORIGIN,
      'The browser did not retain the fixed application origin',
    )
    assert(
      (await page.getByTestId('status').textContent()) === 'pending',
      'The production interaction page did not render the pending canonical state',
    )
    assert(
      (await page.getByTestId('effect').textContent()) === 'workspace_deleted: 1 note(s)',
      'The production interaction page did not render the exact application effect',
    )
    assert((await page.evaluate(() => document.referrer)) === '', 'The page received a referrer')
    assert(
      (await page.evaluate(() => document.cookie)) === '',
      'The HTTP-only application session became script-readable',
    )
    const pendingHtml = await page.locator('html').evaluate((element) => element.outerHTML)
    assert(!pendingHtml.includes(options.locator), 'The opaque locator was copied into page markup')

    const [confirmationResponse] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url() === reviewedInteractionUrl && response.request().method() === 'POST',
      ),
      page.getByTestId('confirm').click(),
    ])
    assert(
      confirmationResponse.status() === 204,
      `The browser harness did not suppress the synthetic redirect: ${confirmationResponse.status()}`,
    )
    assert(
      responseDiagnostics.some(
        (response) =>
          response.method === 'POST' &&
          response.status === 303 &&
          response.location === reviewedInteractionUrl,
      ),
      `Confirmation POST omitted the canonical upstream redirect: ${JSON.stringify({ requestDiagnostics, responseBodies, responseDiagnostics })}`,
    )
    assert(
      requestDiagnostics.some(
        (request) =>
          request.method === 'POST' &&
          request.origin === INTERACTION_ORIGIN &&
          request.referer === `${INTERACTION_ORIGIN}/`,
      ),
      `Confirmation POST omitted the real same-origin browser metadata: ${JSON.stringify(requestDiagnostics)}`,
    )
    // Perform the canonical GET explicitly after suppressing only Playwright's synthetic redirect.
    await page.goto(reviewedInteractionUrl, { waitUntil: 'domcontentloaded' })
    const finalStatus = (await page.getByTestId('status').textContent()) ?? ''
    assert(finalStatus === 'applied', `The explicit confirmation settled as ${finalStatus}`)
    assert((await page.getByTestId('confirm').count()) === 0, 'Applied operation stayed actionable')

    const finalHtml = await page.locator('html').evaluate((element) => element.outerHTML)
    const leakSurfaces = [
      pendingHtml,
      finalHtml,
      responseBodies.join('\n'),
      requestUrls.join('\n'),
      consoleErrors.join('\n'),
      pageErrors.join('\n'),
      JSON.stringify(failedRequests),
      JSON.stringify(requestDiagnostics),
      JSON.stringify(responseDiagnostics),
    ]
    for (const sentinel of [
      ...Object.values(INTERACTION_LAB_SESSIONS),
      ...options.additionalSecretSentinels,
    ]) {
      assert(
        leakSurfaces.every((surface) => !surface.includes(sentinel)),
        `Credential sentinel escaped into the interaction page: ${sentinel}`,
      )
    }
    for (const surface of [
      pendingHtml,
      finalHtml,
      responseBodies.join('\n'),
      consoleErrors.join('\n'),
      pageErrors.join('\n'),
      JSON.stringify(requestDiagnostics),
    ]) {
      assert(
        !surface.includes(options.locator),
        'The opaque locator escaped its fixed URL and redirect boundary',
      )
    }
    assert(
      JSON.stringify(requestMethods) === JSON.stringify(['GET', 'POST', 'GET']),
      `Navigation performed unexpected requests: ${JSON.stringify(requestMethods)}`,
    )
    assert(
      consoleErrors.length === 0,
      `Unexpected browser console errors: ${consoleErrors.join('; ')}`,
    )
    assert(pageErrors.length === 0, `Unexpected browser errors: ${pageErrors.join('; ')}`)
    const unexpectedFailedRequests = failedRequests.filter(
      (request) =>
        !(
          request.url === reviewedInteractionUrl &&
          ((request.method === 'POST' && request.error === 'net::ERR_ABORTED') ||
            (request.method === 'GET' && request.error === 'net::ERR_NAME_NOT_RESOLVED'))
        ),
    )
    assert(
      unexpectedFailedRequests.length === 0,
      `Unexpected browser request failures: ${JSON.stringify(unexpectedFailedRequests)}`,
    )

    return { finalStatus, requestMethods }
  } finally {
    await context.close()
    await browser.close()
  }
}

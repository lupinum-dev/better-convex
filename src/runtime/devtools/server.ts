import { readFileSync, existsSync } from 'node:fs'

/**
 * Server handler for DevTools UI.
 * Serves the built Vue devtools application and API endpoints.
 */
import { defineEventHandler, setHeader, getRequestURL, createError, type H3Event } from 'h3'

import { useRuntimeConfig } from '#imports'

import { getAuthProxyStats } from './auth-proxy-registry'
import { isPathInsideDirectory, resolveDevtoolsFilePath } from './path-utils'

// MIME type mapping
const mimeTypes: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

function getMimeType(path: string): string {
  const ext = path.substring(path.lastIndexOf('.'))
  return mimeTypes[ext] || 'application/octet-stream'
}

export default defineEventHandler(async (event: H3Event) => {
  if (!import.meta.dev) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  }

  // Get the devtools output path from runtime config
  const config = useRuntimeConfig()
  const outputDir =
    typeof config.convexDevtoolsPath === 'string' ? config.convexDevtoolsPath : undefined

  const url = getRequestURL(event)
  let pathname = url.pathname.replace('/__convex_devtools__', '') || '/'

  // API endpoint: Auth proxy stats
  if (pathname === '/proxy-stats') {
    setHeader(event, 'Content-Type', 'application/json')
    setHeader(event, 'Cache-Control', 'no-cache')
    return JSON.stringify(await getAuthProxyStats())
  }

  // Default to index.html
  if (pathname === '/' || pathname === '') {
    pathname = '/index.html'
  }

  // If no output directory configured or doesn't exist, show fallback
  if (!outputDir || !existsSync(outputDir)) {
    if (pathname === '/index.html') {
      setHeader(event, 'Content-Type', 'text/html')
      return getFallbackHtml()
    }
    throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  }

  const filePath = resolveDevtoolsFilePath(outputDir, pathname)

  // Security: prevent path traversal
  if (!isPathInsideDirectory(outputDir, filePath)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }

  // Check if file exists
  if (!existsSync(filePath)) {
    if (pathname === '/index.html') {
      setHeader(event, 'Content-Type', 'text/html')
      return getFallbackHtml()
    }
    throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  }

  // Read and serve the file
  const content = readFileSync(filePath)
  setHeader(event, 'Content-Type', getMimeType(pathname))
  setHeader(event, 'Cache-Control', 'no-cache')

  return content
})

function getFallbackHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Convex DevTools</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #1e1e1e;
      color: #cccccc;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
    }
    .message {
      text-align: center;
      padding: 40px;
    }
    .message h1 {
      color: #ee8944;
      margin-bottom: 16px;
    }
    code {
      background: #252526;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 13px;
    }
  </style>
</head>
<body>
  <div class="message">
    <h1>DevTools Not Built</h1>
    <p>The DevTools UI needs to be built first.</p>
    <p style="margin-top: 16px;">Run: <code>pnpm run build:devtools</code></p>
  </div>
</body>
</html>`
}

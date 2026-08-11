import { defineEventHandler, sendWebResponse, toWebRequest } from 'h3'

import {
  bindPackedRuntimeFingerprint,
  getPackedRuntimeFingerprint,
} from '../../shared/release-fingerprint'

export default defineEventHandler(async (event) => {
  const request = toWebRequest(event)
  const runtimeFingerprint = getPackedRuntimeFingerprint()
  if (!runtimeFingerprint) {
    return await sendWebResponse(event, new Response(null, { status: 404 }))
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return await sendWebResponse(
      event,
      bindPackedRuntimeFingerprint(
        new Response(null, { headers: { allow: 'GET, HEAD' }, status: 405 }),
      ),
    )
  }

  return await sendWebResponse(
    event,
    bindPackedRuntimeFingerprint(
      new Response(
        request.method === 'HEAD' ? null : JSON.stringify({ schemaVersion: 1, runtimeFingerprint }),
        {
          headers: {
            'cache-control': 'no-store',
            'content-type': 'application/json',
            'x-content-type-options': 'nosniff',
          },
          status: 200,
        },
      ),
    ),
  )
})

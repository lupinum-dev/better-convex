<script setup lang="ts">
import { makeFunctionReference } from 'convex/server'

import { ConvexCallError } from '../../../../src/runtime/errors'

// Drives public error boundary end to end: a real Nuxt page, the
// real `useConvexQuery` composable, the real `executeQueryHttp` HTTP
// boundary, the real `normalizeConvexError`, and (via `src/module.ts`) the
// real universal payload plugin reducer/reviver — against a deterministic
// local HTTP mock standing in for Convex (no live credentials).
//
// The mock always answers with a structured 560 application failure whose wire
// message carries a sentinel and UDF frame. Central normalization replaces that
// message while preserving application-owned data/code/status. The composable
// stores that instance in its own identity-partitioned payload state (never
// `asyncData.error`), so it survives SSR -> payload -> hydration as a real
// `ConvexCallError` instance while the sentinel never reaches a public field.
//
// NOTE: this page deliberately does NOT hold the sentinel-secret literal
// anywhere in its own source: any string embedded in `<script setup>` is
// bundled verbatim into the shipped client JS, which would make the
// byte-scan's "sentinel absent from every byte the browser receives"
// assertion trivially false for a reason that has nothing to do with the
// error contract. The e2e test does the sentinel substring check itself,
// against the raw `jsonString`/`toJSONString` this page exposes.
//
const query = makeFunctionReference<'query'>('fixture:query')

const result = await useConvexQuery(query, {})

onMounted(() => {
  const e = result.error.value
  ;(window as unknown as Record<string, unknown>).__ssrErrorsConsumer = {
    present: e != null,
    isConvexCallError: e instanceof ConvexCallError,
    ctorName: e?.constructor?.name ?? null,
    name: (e as { name?: string } | null)?.name ?? null,
    kind: (e as { kind?: string } | null)?.kind ?? null,
    message: (e as { message?: string } | null)?.message ?? null,
    code: (e as { code?: string } | null)?.code ?? null,
    status: (e as { status?: number } | null)?.status ?? null,
    data: (e as { data?: unknown } | null)?.data ?? null,
    // Raw causes are never retained and cannot appear after payload revival.
    causeIsUndefined: e ? (e as unknown as { cause?: unknown }).cause === undefined : null,
    jsonString: e ? JSON.stringify(e) : null,
    toJSONString:
      e && typeof (e as { toJSON?: unknown }).toJSON === 'function'
        ? JSON.stringify((e as { toJSON: () => unknown }).toJSON())
        : null,
  }
})
</script>

<template>
  <div class="ssr-errors-consumer">
    <h1>ssr-errors-consumer</h1>
    <div v-if="result.error.value" class="err">
      <p class="err-kind">{{ result.error.value.kind }}</p>
      <p class="err-message">{{ result.error.value.message }}</p>
      <p class="err-status">{{ result.error.value.status }}</p>
    </div>
    <div v-else class="no-err">no error</div>
  </div>
</template>

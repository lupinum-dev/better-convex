import { definePayloadPlugin, definePayloadReducer, definePayloadReviver } from '#app'

import { ConvexCallError, isSerializedConvexCallError, normalizeConvexError } from '../errors'

/**
 * Internal universal Nuxt payload plugin for {@link ConvexCallError}.
 * Registered with `mode: 'all'` and an explicit negative `order` (-50) by
 * `src/module.ts`, so the reviver exists before Nuxt parses the SSR payload.
 *
 * The reducer emits the public `toJSON()` shape, including `functionName`. The
 * reviver rebuilds a real `ConvexCallError` only after strict structural
 * validation, so an arbitrary object that carries `name: 'ConvexCallError'`, an
 * unknown key, or a malformed field is never revived.
 */
export default definePayloadPlugin(() => {
  definePayloadReducer('ConvexCallError', (value) => {
    if (!(value instanceof ConvexCallError)) return
    return value.toJSON()
  })

  definePayloadReviver('ConvexCallError', (value) => {
    if (!isSerializedConvexCallError(value)) return
    return normalizeConvexError(value)
  })
})

import { defineEventHandler } from 'nuxt/server'

import { api } from '#convex/api'

export default defineEventHandler(() => {
  return {
    hasApi: Boolean(api.tasks.list),
  }
})

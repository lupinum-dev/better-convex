import betterAuth from 'better-convex-nuxt/convex-auth/convex.config'
import { defineApp } from 'convex/server'

const app = defineApp()
app.use(betterAuth, { name: 'betterAuth' })

export default app

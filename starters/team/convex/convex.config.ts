import rateLimiter from '@convex-dev/rate-limiter/convex.config'
import { defineApp } from 'convex/server'

import betterAuth from './betterAuth/convex.config'

const app = defineApp()
app.use(betterAuth, { name: 'betterAuth' })
app.use(rateLimiter)

export default app

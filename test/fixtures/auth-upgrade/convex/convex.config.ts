// The harness adds the schema of 1.0.0-beta.7, then the 1.0 schema and adapter, to ./betterAuth.
import { defineApp } from 'convex/server'

import betterAuth from './betterAuth/convex.config'

const app = defineApp()
app.use(betterAuth, { name: 'betterAuth' })

export default app

import { defineApp } from 'convex/server'

import auth from './betterAuth/convex.config'

const app = defineApp()
app.use(auth, { name: 'betterAuth' })

export default app

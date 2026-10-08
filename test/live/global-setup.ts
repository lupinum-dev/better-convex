// Runs once before the live project: the smoke installs the built packages into its starter copy.
// The dry run (BCN_LIVE_LOCAL=1) also needs the pinned local backend.
import integrationSetup, { buildPackages } from '../integration/global-setup'

export default async function setup() {
  if (process.env.BCN_LIVE_LOCAL === '1' && !process.env.CONVEX_DEPLOY_KEY) {
    await integrationSetup()
  } else {
    buildPackages()
  }
}

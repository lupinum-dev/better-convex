import { anonymous } from 'better-auth/plugins'

import options from '../../../../../internal/convex-auth/schema-options'

export default {
  ...options,
  plugins: [...options.plugins.filter((plugin) => plugin.id === 'jwt'), anonymous()],
}

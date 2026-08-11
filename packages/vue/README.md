# better-convex-vue

Identity-safe Convex lifecycle primitives for standalone Vue 3 applications.
Use `better-convex-nuxt` instead when Nuxt should own SSR, generated aliases,
server calls, or optional Better Auth integration.

## Install

```bash
pnpm add better-convex-vue@0.8.0-beta.36 convex@1.42.2 vue@^3.5.0
```

```ts
import { createApp } from 'vue'
import { createBetterConvex } from 'better-convex-vue'

import App from './App.vue'

createApp(App)
  .use(createBetterConvex({ convexUrl: import.meta.env.VITE_CONVEX_URL }))
  .mount('#app')
```

Use generated Convex references directly inside `setup`:

```ts
import { useConvexMutation, useConvexQuery } from 'better-convex-vue'
import type { Id } from '../convex/_generated/dataModel'
import { api } from '../convex/_generated/api'

const notes = useConvexQuery(api.notes.list)
const rename = useConvexMutation(api.notes.rename)

async function renameNote(id: Id<'notes'>, title: string) {
  await rename({ id, title })
}
```

`notes.data.value === undefined` means no value has settled; a Convex `null`
result remains valid data. Pass `'skip'` explicitly to skip a query. Mutations
and actions reject normally, while their readonly `status`, `pending`, `data`,
and `error` refs describe the newest invocation.

Pagination requires an initial page size:

```ts
import { useConvexPaginatedQuery } from 'better-convex-vue'
import type { Id } from '../convex/_generated/dataModel'
import { api } from '../convex/_generated/api'

function useWorkspaceNotes(workspaceId: Id<'workspaces'>) {
  return useConvexPaginatedQuery(api.notes.listPaginated, { workspaceId }, { initialNumItems: 20 })
}
```

Advanced cross-bundle hosts use `better-convex-vue/embedded`. MCP App UIs use
`better-convex-vue/mcp-app` and must additionally install its exact optional
peers: `@modelcontextprotocol/ext-apps@1.7.5`,
`@modelcontextprotocol/sdk@1.30.0`, and `zod@4.4.3`.

Documentation: <https://better-convex-nuxt.vercel.app>

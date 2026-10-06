<script setup lang="ts">
import { can } from '@lupinum/better-convex-functions'
import type { Id } from '~~/convex/_generated/dataModel'
import { policy } from '~~/convex/policy'

import { api } from '#convex/api'

const { status, client } = useConvexAuth()
const route = useRoute()
const signedIn = computed(() => status.value === 'authenticated')
function whenSignedIn<T>(args: () => T) {
  return computed(() => (signedIn.value ? args() : 'skip'))
}
const live = { auth: 'required', server: false } as const

const organizations = useConvexPaginatedQuery(
  api.projects.organizations,
  whenSignedIn(() => ({})),
  { ...live, initialNumItems: 100 },
)
const organizationId = ref<Id<'organizations'>>()
watchEffect(() => (organizationId.value ??= organizations.data.value?.[0]?.id))
const organization = computed(() =>
  organizations.data.value?.find(({ id }) => id === organizationId.value),
)
function inOrganization<T>(args: (id: Id<'organizations'>) => T) {
  return computed(() =>
    signedIn.value && organizationId.value ? args(organizationId.value) : 'skip',
  )
}

const text = ref('')
const projects = useConvexPaginatedQuery(
  api.projects.search,
  inOrganization((id) => ({ organizationId: id, text: text.value })),
  { ...live, initialNumItems: 50 },
)
const { data: requests } = await useConvexQuery(
  api.agents.pending,
  inOrganization((id) => ({ tenantId: id })),
  live,
)
const { data: activity } = await useConvexQuery(
  api.agents.activity,
  inOrganization((id) => ({ tenantId: id, limit: 10 })),
  live,
)
const { data: connections } = await useConvexQuery(
  api.connections.list,
  whenSignedIn(() => ({})),
  live,
)

const create = useConvexMutation(api.projects.create)
const archive = useConvexMutation(api.projects.archive)
const approve = useConvexMutation(api.agents.approve)
const decline = useConvexMutation(api.agents.decline)
const disconnect = useConvexMutation(api.connections.revoke)

const codeOf = (error: unknown) => {
  const e = error as { code?: unknown; data?: { code?: unknown } } | undefined
  return typeof e?.code === 'string'
    ? e.code
    : typeof e?.data?.code === 'string'
      ? e.data.code
      : undefined
}
const messageOf = (error: unknown) => {
  const data = (error as { data?: { message?: unknown } } | undefined)?.data
  return typeof data?.message === 'string' ? data.message : 'That did not work. Try again.'
}

// Every action reports its failure here, so a failed click never looks like success.
const actions = [create, archive, approve, decline, disconnect]
const failed = computed(() => actions.map((action) => action.error.value).find(Boolean))
function act<A>(action: { mutate: (args: A) => Promise<unknown> }, args: A) {
  return action.mutate(args).catch(() => {})
}

// The account can stop working while the page is open: signed out elsewhere, or suspended.
const accountProblem = computed(() => {
  const code = codeOf(organizations.error.value)
  if (code === 'ACCOUNT_DISABLED')
    return 'This account cannot use the app right now. Ask an owner of your organization.'
  if (code === 'NOT_SIGNED_IN') return 'Your session ended. Sign in again to continue.'
  return ''
})

// An approved request can still fail (the project changed meanwhile); say why.
const approvalNote = ref('')
async function approveRequest(approvalId: string) {
  const outcome = await approve.mutate({ approvalId }).catch(() => null)
  approvalNote.value =
    outcome?.status === 'failed' ? `Could not do it: ${outcome.error.message}` : ''
}

// One click, one project: a second submit before the first returns does nothing.
const name = ref('')
let creating = false
async function createProject() {
  if (!organizationId.value || creating) return
  creating = true
  try {
    if (
      await create
        .mutate({ organizationId: organizationId.value, name: name.value })
        .catch(() => null)
    )
      name.value = ''
  } finally {
    creating = false
  }
}

const archiving = ref<string>()
async function archiveProject(projectId: Id<'projects'>) {
  if (archiving.value) return
  archiving.value = projectId
  await archive.mutate({ projectId }).catch(() => {})
  archiving.value = undefined
}

const form = reactive({ email: '', password: '', name: '' })
const authError = ref('')
async function signIn(mode: 'in' | 'up') {
  authError.value = ''
  // Sign-up does not start a session here, so a new account signs in right after.
  const created =
    mode === 'up'
      ? await client.signUp.email({
          email: form.email,
          password: form.password,
          name: form.name || form.email,
        })
      : null
  const result = created?.error
    ? created
    : await client.signIn.email({ email: form.email, password: form.password })
  if (result.error) authError.value = result.error.message ?? 'That did not work.'
  else if (returnTo.value) await navigateTo(returnTo.value)
}
// Where to go after signing in, when a link sent the person here (an approval link). Same-site paths only.
const returnTo = computed(() => {
  const value = route.query.return
  return typeof value === 'string' && /^\/(?!\/)[\w\-/]*$/.test(value) ? value : null
})

async function signOutAndIn() {
  await client.signOut().catch(() => {})
  reloadNuxtApp()
}

const door = (request: {
  mine: boolean
  requester: { door: string; clientId?: string; agent?: string }
}) => {
  if (!request.mine) return "a teammate's agent"
  return request.requester.door === 'mcp'
    ? `an MCP host (${request.requester.clientId})`
    : `your agent ${request.requester.agent}`
}
const when = (at: number) =>
  new Date(at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
const activityLabel = {
  done: 'done',
  approved: 'approved',
  declined: 'declined',
  failed: 'failed',
} as const
</script>

<template>
  <main>
    <p v-if="status === 'loading'">Checking session…</p>

    <form v-else-if="!signedIn" class="card" @submit.prevent="signIn('in')">
      <h1>Projects</h1>
      <p v-if="returnTo" class="muted">Sign in to continue to your agent's request.</p>
      <label>Email <input v-model="form.email" type="email" required autocomplete="email" /></label>
      <label
        >Password
        <input
          v-model="form.password"
          type="password"
          required
          minlength="8"
          autocomplete="current-password"
      /></label>
      <label>Name (new accounts) <input v-model="form.name" autocomplete="name" /></label>
      <p v-if="authError" role="alert">{{ authError }}</p>
      <div class="row">
        <button type="submit">Sign in</button>
        <button type="button" class="secondary" @click="signIn('up')">Create account</button>
      </div>
    </form>

    <section v-else-if="accountProblem" class="card problem" role="alert">
      <span>{{ accountProblem }}</span>
      <button type="button" class="secondary" @click="signOutAndIn">Sign in again</button>
    </section>

    <template v-else>
      <header class="row">
        <h1>Projects</h1>
        <select
          v-if="(organizations.data.value?.length ?? 0) > 1"
          v-model="organizationId"
          aria-label="Organization"
        >
          <option v-for="org in organizations.data.value" :key="org.id" :value="org.id">
            {{ org.name }}
          </option>
        </select>
        <button
          v-if="organizations.canLoadMore.value"
          type="button"
          class="secondary"
          @click="organizations.loadMore(100)"
        >
          More organizations
        </button>
        <span v-if="organization" class="muted"
          >{{ organization.name }} · {{ organization.role }}</span
        >
        <button type="button" class="secondary" @click="client.signOut()">Sign out</button>
      </header>

      <p v-if="failed" class="card problem" role="alert">
        <span>{{ messageOf(failed) }}</span>
        <button
          type="button"
          class="secondary"
          @click="actions.forEach((action) => action.reset())"
        >
          Dismiss
        </button>
      </p>

      <!-- Outside the list: a failed request leaves it at once. -->
      <p v-if="approvalNote" class="card problem" role="status">{{ approvalNote }}</p>

      <section v-if="requests?.length" class="card attention" aria-label="Agent requests">
        <h2>Agents are waiting for you</h2>
        <ul>
          <li v-for="request in requests" :key="request.id">
            <span class="text"
              >{{ request.summary }}
              <small class="muted">Asked by {{ door(request) }}.</small></span
            >
            <span class="row">
              <button
                type="button"
                :disabled="approve.pending.value"
                @click="approveRequest(request.id)"
              >
                Approve
              </button>
              <button
                type="button"
                class="secondary"
                :disabled="decline.pending.value"
                @click="act(decline, { approvalId: request.id })"
              >
                Decline
              </button>
            </span>
          </li>
        </ul>
      </section>

      <section class="card">
        <form
          v-if="can(policy, 'projects.create', organization?.role)"
          class="row"
          @submit.prevent="createProject"
        >
          <input
            v-model="name"
            placeholder="New project name"
            maxlength="100"
            required
            aria-label="New project name"
          />
          <button type="submit" :disabled="create.pending.value">Create</button>
        </form>
        <input
          v-model="text"
          type="search"
          placeholder="Search projects"
          aria-label="Search projects"
        />
        <p v-if="!projects.data.value?.length" class="muted">
          {{ text ? 'No project matches.' : 'No projects yet.' }}
        </p>
        <ul v-else>
          <li v-for="project in projects.data.value" :key="project.id">
            <span class="text">{{ project.name }}</span>
            <button
              v-if="can(policy, 'projects.archive', organization?.role)"
              type="button"
              class="secondary"
              :disabled="archiving === project.id"
              @click="archiveProject(project.id)"
            >
              Archive
            </button>
          </li>
        </ul>
        <button
          v-if="projects.canLoadMore.value"
          type="button"
          class="secondary"
          @click="projects.loadMore(50)"
        >
          Show more
        </button>
      </section>

      <section v-if="activity?.length" class="card" aria-label="Agent activity">
        <h2>What agents did here</h2>
        <ul>
          <li v-for="entry in activity" :key="entry.id">
            <span class="text">
              {{ entry.tool ?? entry.action }}
              <small class="muted">{{
                entry.actor.door === 'mcp'
                  ? `MCP host ${entry.actor.clientId}`
                  : `agent ${entry.actor.agent ?? ''}`
              }}</small>
            </span>
            <small class="muted">{{ activityLabel[entry.status] }} · {{ when(entry.at) }}</small>
          </li>
        </ul>
      </section>

      <section class="card">
        <h2>Connected agents</h2>
        <p v-if="!connections?.length" class="muted">
          Connect ChatGPT, Claude or VS Code to {{ $config.public.convex?.siteUrl ?? '' }}/mcp.
        </p>
        <ul v-else>
          <li v-for="connection in connections" :key="connection.clientId">
            <span class="text"
              >{{ connection.clientName ?? connection.clientId }}
              <small class="muted">{{ connection.scopes.join(', ') }}</small></span
            >
            <button
              type="button"
              class="secondary"
              :disabled="disconnect.pending.value"
              @click="act(disconnect, { clientId: connection.clientId })"
            >
              Disconnect
            </button>
          </li>
        </ul>
      </section>
    </template>
  </main>
</template>

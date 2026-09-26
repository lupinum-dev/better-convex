<script setup lang="ts">
import { createProjectInputSchema } from '~~/shared/inputSchemas'

import { api } from '#convex/api'
import { useProjectCreateRateLimit } from '~/composables/useProjectCreateRateLimit'

const props = defineProps<{
  onCreated?: () => Promise<void> | void
  teamId: string
}>()

const name = ref('')
const error = ref<string | null>(null)
const {
  canSubmit: canCreateProjectNow,
  message: rateLimitMessage,
  refresh: refreshCreateRateLimit,
} = await useProjectCreateRateLimit(() => props.teamId)
const { mutate: createProject, pending } = useConvexMutation(api.projects.create)

async function submit() {
  if (!canCreateProjectNow.value) {
    error.value = rateLimitMessage.value
    return
  }

  const parsed = createProjectInputSchema.safeParse({
    teamId: props.teamId,
    name: name.value,
  })
  if (!parsed.success) {
    error.value = parsed.error.issues[0]?.message ?? 'Project was not created'
    return
  }

  error.value = null
  try {
    await createProject(parsed.data)
    await refreshCreateRateLimit()
    await props.onCreated?.()
    name.value = ''
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Project was not created'
  }
}
</script>

<template>
  <NameCreateForm
    v-model:name="name"
    :disabled="!canCreateProjectNow"
    :error="error ?? rateLimitMessage"
    :pending="pending"
    placeholder="Project name"
    @submit="submit"
  />
</template>

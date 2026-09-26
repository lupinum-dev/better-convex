<script setup lang="ts">
import { createOrganizationInputSchema } from '~~/shared/inputSchemas'

import { api } from '#convex/api'

const name = ref('')
const error = ref<string | null>(null)
const { mutate: createOrganization, pending } = useConvexMutation(api.organizations.create)

async function submit() {
  const parsed = createOrganizationInputSchema.safeParse({
    name: name.value,
  })
  if (!parsed.success) {
    error.value = parsed.error.issues[0]?.message ?? 'Organization was not created'
    return
  }

  error.value = null
  try {
    await createOrganization(parsed.data)
    name.value = ''
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Organization was not created'
  }
}
</script>

<template>
  <NameCreateForm
    v-model:name="name"
    :error="error"
    :pending="pending"
    placeholder="Organization name"
    @submit="submit"
  />
</template>

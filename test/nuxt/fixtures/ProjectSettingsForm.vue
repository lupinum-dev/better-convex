<script setup lang="ts">
// The "Prefill a form from a query" recipe in
// docs/content/docs/3.build/2.write-data/5.forms.md. Keep both in sync: only
// the imports differ (`api.projectSettings.*` and auto-imports in the docs).
import { type } from 'arktype'
import { reactive, ref, watchEffect } from 'vue'

import { useConvexForm } from '../../../src/runtime/composables/useConvexForm'
import { useConvexQuery } from '../../../src/runtime/composables/useConvexQuery'
import { getProjectSettings, saveProjectSettings } from './project-settings-api'

const props = defineProps<{ projectId: string }>()

const defaults = { name: '', notifyByEmail: true }
const values = reactive({ ...defaults })
// The project whose settings filled the form. Later edits belong to the user.
const seededFor = ref<string>()

const {
  data: settings,
  status,
  isStale,
} = await useConvexQuery(getProjectSettings, () => ({
  projectId: props.projectId,
}))

watchEffect(() => {
  // Seed once per project, and only from a current result.
  if (seededFor.value === props.projectId) return
  if (status.value !== 'success' || isStale.value) return
  const current = settings.value
  if (current === undefined) return
  // `null` is a real result: the project has no settings yet, so the defaults apply.
  Object.assign(
    values,
    current === null ? defaults : { name: current.name, notifyByEmail: current.notifyByEmail },
  )
  seededFor.value = props.projectId
})

const { submit, pending, fieldErrors, formError } = useConvexForm(saveProjectSettings, {
  schema: type({ name: 'string > 0', notifyByEmail: 'boolean' }),
  toArgs: (parsed) => parsed,
})

async function save() {
  await submit({ ...values }, { projectId: props.projectId })
}
</script>

<template>
  <p v-if="seededFor !== projectId && status === 'error'" role="alert">
    The settings could not be loaded.
  </p>
  <p v-else-if="seededFor !== projectId" aria-busy="true">Loading settings…</p>
  <form v-else @submit.prevent="save">
    <label>
      Name
      <input v-model="values.name" name="name" :aria-invalid="Boolean(fieldErrors.name)" />
    </label>
    <p v-for="message in fieldErrors.name" :key="message">{{ message }}</p>
    <label>
      <input v-model="values.notifyByEmail" name="notifyByEmail" type="checkbox" />
      Email me about changes
    </label>
    <p v-if="formError" role="alert">{{ formError }}</p>
    <button :disabled="pending">Save</button>
  </form>
</template>

<script setup lang="ts">
import { api } from '@@/convex/_generated/api'
import type { Id } from '@@/convex/_generated/dataModel'

const props = defineProps<{
  storageId: Id<'_storage'>
  filename: string
}>()

const { data: imageUrl, status } = useConvexQuery(
  api.files.getUrl,
  () => ({ storageId: props.storageId }),
  { auth: 'required' },
)
</script>

<template>
  <div class="w-full h-full">
    <img v-if="imageUrl" :src="imageUrl" :alt="filename" class="w-full h-full object-cover" />
    <div v-else-if="status === 'pending'" class="w-full h-full flex items-center justify-center">
      <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-muted" />
    </div>
    <div
      v-else
      class="w-full h-full flex items-center justify-center"
      aria-label="File unavailable"
    >
      <UIcon name="i-lucide-image-off" class="size-6 text-muted" />
    </div>
  </div>
</template>

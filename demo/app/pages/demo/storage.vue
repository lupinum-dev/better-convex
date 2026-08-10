<script setup lang="ts">
import { api } from '@@/convex/_generated/api'

definePageMeta({
  middleware: 'auth',
})

const { can } = await useDemoPermissions()

// File upload
const {
  upload,
  status: uploadStatus,
  progress,
  error: uploadError,
  cancel: cancelUpload,
} = useConvexFileUpload(api.files.generateUploadUrl, {
  maxSize: 5 * 1024 * 1024, // 5MB
  allowedTypes: ['image/*'],
})

// Save file metadata after upload
const saveFile = useConvexMutation(api.files.save)
const saveError = saveFile.error

// List files
const { data: files, status: filesStatus } = await useConvexQuery(api.files.list, {})

// Delete file
const deleteFile = useConvexMutation(api.files.remove)
const deleteError = deleteFile.error

// Combined error from any operation
const operationError = computed(() => deleteError.value || saveError.value)

function clearErrors() {
  deleteError.value = null
  saveError.value = null
}

// File input ref
const fileInputRef = ref<HTMLInputElement | null>(null)

// Drag state
const isDragging = ref(false)

async function handleFileSelect(event: Event) {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (file) await uploadFile(file)
  // Reset input
  if (fileInputRef.value) fileInputRef.value.value = ''
}

async function handleDrop(event: DragEvent) {
  isDragging.value = false
  const file = event.dataTransfer?.files[0]
  if (file) await uploadFile(file)
}

async function uploadFile(file: File) {
  try {
    const storageId = await upload(file)
    if (storageId) {
      await saveFile({
        storageId,
        filename: file.name,
      })
    }
  } catch (e) {
    // AbortError is expected when user cancels - don't log as error
    if (e instanceof DOMException && e.name === 'AbortError') {
      return
    }
    console.error('Upload failed:', e)
  }
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
</script>

<template>
  <div class="p-6 lg:p-8 max-w-4xl mx-auto">
    <!-- Header -->
    <div class="mb-6">
      <h1 class="text-2xl font-bold mb-2">File Storage</h1>
      <p class="text-muted">Upload images with progress tracking using useConvexFileUpload.</p>
    </div>

    <!-- Explanation -->
    <UAlert
      class="mb-6"
      icon="i-lucide-info"
      color="secondary"
      variant="subtle"
      title="How it works"
      description="useConvexFileUpload handles the entire upload flow: generating upload URLs, uploading to Convex storage, and tracking progress. useConvexStorageUrl converts storage IDs to accessible URLs."
    />

    <!-- Operation Error -->
    <UAlert
      v-if="operationError"
      class="mb-6"
      icon="i-lucide-alert-circle"
      color="error"
      variant="subtle"
      :title="operationError.message"
      :close-icon="'i-lucide-x'"
      @close="clearErrors"
    />

    <!-- Upload Zone -->
    <UCard v-if="can('file.upload')" class="mb-6">
      <input
        ref="fileInputRef"
        type="file"
        accept="image/*"
        class="hidden"
        @change="handleFileSelect"
      />

      <div
        @dragover.prevent="isDragging = true"
        @dragleave="isDragging = false"
        @drop.prevent="handleDrop"
        :class="[
          'border-2 border-dashed rounded-xl p-8 text-center transition-all cursor-pointer',
          isDragging ? 'border-primary bg-primary/5' : 'border-default hover:border-primary/50',
        ]"
        @click="fileInputRef?.click()"
      >
        <div v-if="uploadStatus === 'pending'" @click.stop>
          <UProgress :value="progress.percent" color="primary" class="mb-4" />
          <p class="text-sm text-muted mb-3">Uploading... {{ progress.percent }}%</p>
          <UButton
            icon="i-lucide-x"
            color="neutral"
            variant="outline"
            size="sm"
            @click="cancelUpload"
          >
            Cancel
          </UButton>
        </div>

        <div v-else>
          <UIcon
            name="i-lucide-upload-cloud"
            :class="[
              'w-12 h-12 mx-auto mb-4 transition-colors',
              isDragging ? 'text-primary' : 'text-muted',
            ]"
          />
          <p class="font-medium mb-1">
            {{ isDragging ? 'Drop to upload' : 'Click or drag image to upload' }}
          </p>
          <p class="text-sm text-muted">PNG, JPG, GIF up to 5MB</p>
        </div>
      </div>

      <UAlert
        v-if="uploadError"
        class="mt-4"
        color="error"
        icon="i-lucide-alert-circle"
        :title="uploadError.message"
      />
    </UCard>

    <UAlert
      v-else
      class="mb-6"
      icon="i-lucide-lock"
      color="warning"
      variant="subtle"
      title="Permission required"
      description="Sign in with the demo permission context to upload files."
    />

    <!-- File Gallery -->
    <UCard>
      <template #header>
        <div class="flex items-center justify-between">
          <span class="font-semibold">Uploaded Files</span>
          <UBadge variant="subtle" color="neutral"> {{ files?.length || 0 }} files </UBadge>
        </div>
      </template>

      <!-- Loading state -->
      <div
        v-if="filesStatus === 'pending'"
        class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4"
      >
        <USkeleton v-for="i in 4" :key="i" class="aspect-square rounded-lg" />
      </div>

      <!-- Empty state -->
      <div v-else-if="!files?.length" class="text-center py-12">
        <UIcon name="i-lucide-image" class="w-12 h-12 text-muted mx-auto mb-4" />
        <p class="text-muted">No files uploaded yet</p>
      </div>

      <!-- File grid -->
      <div v-else class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        <div v-for="file in files" :key="file._id" class="group relative">
          <FilePreview
            :storage-id="file.storageId"
            :filename="file.filename"
            class="aspect-square rounded-lg overflow-hidden bg-elevated"
          />

          <!-- Overlay -->
          <div
            class="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex flex-col items-center justify-center p-2"
          >
            <p class="text-white text-xs text-center truncate w-full mb-1">
              {{ file.filename }}
            </p>
            <p class="text-white/70 text-xs mb-2">
              {{ formatFileSize(file.size) }}
            </p>
            <div class="flex items-center gap-1.5 mb-2">
              <UAvatar :src="file.uploaderAvatarUrl" :alt="file.uploaderName" size="2xs" />
              <span class="text-white/80 text-xs truncate max-w-20">
                {{ file.uploaderName }}
              </span>
            </div>
            <UButton
              v-if="can('file.delete', { ownerId: file.uploadedBy })"
              icon="i-lucide-trash-2"
              color="error"
              size="xs"
              @click="void deleteFile({ id: file._id })"
            >
              Delete
            </UButton>
          </div>
        </div>
      </div>
    </UCard>
  </div>
</template>

<script setup lang="ts">
import type { Id } from '~~/convex/_generated/dataModel'

type ProjectSummary = {
  _id: Id<'projects'>
  name: string
}

const statusFilter = defineModel<'active' | 'deleted'>('statusFilter', { required: true })
const editingProjectId = ref<Id<'projects'> | null>(null)
const projectRenameName = ref('')
const projectRenamePending = ref(false)

const props = defineProps<{
  teamId: string
  projects: readonly ProjectSummary[]
  projectsLoading: boolean
  canLoadMore: boolean
  canCreateProject?: boolean
  canUpdateProject?: boolean
  canDeleteProject?: boolean
  onLoadMore: () => void
  onRefresh: () => Promise<void> | void
  onRename: (projectId: Id<'projects'>, name: string) => Promise<void> | void
  onDelete: (projectId: Id<'projects'>) => void
  onRestore: (projectId: Id<'projects'>) => void
}>()

function startRename(project: ProjectSummary) {
  editingProjectId.value = project._id
  projectRenameName.value = project.name
}

function cancelRename() {
  editingProjectId.value = null
  projectRenameName.value = ''
}

async function submitRename(project: ProjectSummary) {
  const name = projectRenameName.value.trim()
  if (!name || name === project.name) {
    cancelRename()
    return
  }

  projectRenamePending.value = true
  try {
    await props.onRename(project._id, name)
    cancelRename()
  } finally {
    projectRenamePending.value = false
  }
}
</script>

<template>
  <section class="projects-panel" aria-label="Projects">
    <ProjectCreateForm v-if="canCreateProject" :team-id="teamId" :on-created="onRefresh" />
    <p v-else class="empty">You do not have permission to create projects in this team.</p>

    <section class="toolbar">
      <button
        class="button"
        :aria-pressed="statusFilter === 'active'"
        @click="statusFilter = 'active'"
      >
        Active
      </button>
      <button
        class="button"
        :aria-pressed="statusFilter === 'deleted'"
        @click="statusFilter = 'deleted'"
      >
        Deleted
      </button>
    </section>

    <ul v-if="projects.length" class="items-list">
      <li v-for="project in projects" :key="project._id">
        <form
          v-if="editingProjectId === project._id"
          class="toolbar"
          @submit.prevent="submitRename(project)"
        >
          <input v-model="projectRenameName" :disabled="projectRenamePending" />
          <button
            class="button"
            type="submit"
            :disabled="projectRenamePending || !projectRenameName.trim()"
          >
            Save
          </button>
          <button
            class="button"
            type="button"
            :disabled="projectRenamePending"
            @click="cancelRename"
          >
            Cancel
          </button>
        </form>
        <template v-else>
          <span>{{ project.name }}</span>
          <button
            v-if="statusFilter === 'active' && canUpdateProject"
            class="button"
            @click="startRename(project)"
          >
            Rename
          </button>
        </template>
        <button
          v-if="editingProjectId !== project._id && statusFilter === 'active' && canDeleteProject"
          class="button"
          @click="onDelete(project._id)"
        >
          Delete
        </button>
        <button
          v-else-if="editingProjectId !== project._id && canDeleteProject"
          class="button"
          @click="onRestore(project._id)"
        >
          Restore
        </button>
      </li>
    </ul>

    <section v-else-if="projectsLoading" class="empty">Loading projects...</section>
    <section v-else class="empty">No projects yet.</section>

    <button v-if="canLoadMore" class="button" @click="onLoadMore">Load more</button>
  </section>
</template>

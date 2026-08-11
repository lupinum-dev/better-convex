<script setup lang="ts">
import type { Id } from '~~/convex/_generated/dataModel'
import { renameProjectInputSchema } from '~~/shared/inputSchemas'

import { api } from '#convex/api'

const props = defineProps<{
  teamId: string
  canCreateProject?: boolean
  canUpdateProject?: boolean
  canDeleteProject?: boolean
}>()

const statusFilter = ref<'active' | 'deleted'>('active')
const renameProject = useConvexMutation(api.projects.rename)
const softDeleteProject = useConvexMutation(api.projects.softDelete)
const restoreProject = useConvexMutation(api.projects.restore)
const {
  data: projectData,
  isLoading: projectsLoading,
  canLoadMore,
  loadMore,
  refresh,
} = await useConvexPaginatedQuery(
  api.projects.list,
  computed(() => ({ teamId: props.teamId, status: statusFilter.value })),
  {
    initialNumItems: 20,
  },
)

const projects = computed(() => projectData.value ?? [])

function loadMoreProjects() {
  loadMore(20)
}

async function renameSelectedProject(projectId: Id<'projects'>, name: string) {
  const parsed = renameProjectInputSchema.safeParse({
    projectId,
    name,
  })
  if (!parsed.success) return

  await renameProject({
    projectId,
    name: parsed.data.name,
  })
}

async function deleteSelectedProject(projectId: Id<'projects'>) {
  await softDeleteProject({ projectId })
}

async function restoreSelectedProject(projectId: Id<'projects'>) {
  await restoreProject({ projectId })
}
</script>

<template>
  <ProjectsPanel
    v-model:status-filter="statusFilter"
    :team-id="teamId"
    :projects="projects"
    :projects-loading="projectsLoading"
    :can-load-more="canLoadMore"
    :can-create-project="canCreateProject"
    :can-update-project="canUpdateProject"
    :can-delete-project="canDeleteProject"
    :on-load-more="loadMoreProjects"
    :on-refresh="refresh"
    :on-rename="renameSelectedProject"
    :on-delete="deleteSelectedProject"
    :on-restore="restoreSelectedProject"
  />
</template>

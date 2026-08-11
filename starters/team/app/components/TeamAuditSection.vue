<script setup lang="ts">
import { api } from '#convex/api'

const props = defineProps<{
  teamId: string
}>()

const {
  data: teamAuditData,
  canLoadMore: canLoadMoreTeamAudit,
  loadMore: loadMoreTeamAudit,
} = await useConvexPaginatedQuery(
  api.audit.listForTeam,
  computed(() => ({ teamId: props.teamId })),
  {
    initialNumItems: 10,
  },
)

const teamAuditEvents = computed(() => teamAuditData.value ?? [])
</script>

<template>
  <AuditPanel
    title="Team activity"
    :events="teamAuditEvents"
    :can-load-more="canLoadMoreTeamAudit"
    :on-load-more="loadMoreTeamAudit"
  />
</template>

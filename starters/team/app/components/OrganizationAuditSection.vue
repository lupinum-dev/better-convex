<script setup lang="ts">
import { api } from '#convex/api'

const props = defineProps<{
  organizationId: string
}>()

const {
  data: orgAuditData,
  canLoadMore: canLoadMoreOrgAudit,
  loadMore: loadMoreOrgAudit,
} = await useConvexPaginatedQuery(
  api.audit.listForOrganization,
  computed(() => ({ organizationId: props.organizationId })),
  {
    initialNumItems: 10,
  },
)

const orgAuditEvents = computed(() => orgAuditData.value ?? [])
</script>

<template>
  <AuditPanel
    title="Organization activity"
    :events="orgAuditEvents"
    :can-load-more="canLoadMoreOrgAudit"
    :on-load-more="loadMoreOrgAudit"
  />
</template>

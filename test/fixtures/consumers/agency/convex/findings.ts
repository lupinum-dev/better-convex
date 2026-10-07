import { fail } from '@lupinum/better-convex-functions'
import { v } from 'convex/values'

import { mutation, query } from './functions'

const order = { critical: 0, warning: 1, notice: 2 } as const
/** website-checker caps one bulk acknowledge at 500 findings. */
const acknowledgeCap = 500

/**
 * What a coding agent needs to fix a site: its open and regressed findings,
 * worst first, as one Markdown brief (website-checker's "Build agent prompt").
 */
export const brief = query({
  action: 'findings.brief',
  args: { projectId: v.id('projects') },
  returns: v.object({ findings: v.number(), brief: v.string() }),
  tool: {
    name: 'get_fix_brief',
    description:
      "A Markdown brief of a site's open findings, worst first, for a coding agent to fix.",
    args: { projectId: 'The site, from list_projects.' },
  },
  handler: async (ctx, { projectId }) => {
    const project = await ctx.db.get(projectId)
    if (!project) fail('NOT_FOUND', 'No projects with this ID.')
    const rows = []
    for (const state of ['regressed', 'open'] as const) {
      rows.push(
        ...(await ctx.db
          .query('findings')
          .withIndex('by_project_state', (q) => q.eq('projectId', projectId).eq('state', state))
          .take(200)),
      )
    }
    rows.sort((a, b) => order[a.severity] - order[b.severity])
    const lines = [
      `# Fix request: ${project.name} (${project.url})`,
      '',
      `${rows.length} open finding${rows.length === 1 ? '' : 's'}.`,
    ]
    for (const [index, finding] of rows.entries()) {
      lines.push(
        '',
        `## ${index + 1}. ${finding.title} (${finding.severity})`,
        `Page: ${finding.url}`,
        '',
        finding.detail,
      )
    }
    return { findings: rows.length, brief: lines.join('\n') }
  },
})

/** Marks findings as seen and planned; it does not resolve them. Agents ask a person first. */
export const acknowledge = mutation({
  action: 'findings.acknowledge',
  args: { findingIds: v.array(v.id('findings')) },
  returns: v.object({ acknowledged: v.number() }),
  tool: {
    name: 'acknowledge_findings',
    description:
      'Acknowledge findings of one site: they stay listed until a crawl sees them fixed.',
  },
  approval: async (ctx, { findingIds }) => {
    const first = findingIds[0] && (await ctx.db.get(findingIds[0]))
    const project = first && (await ctx.db.get(first.projectId))
    return `Acknowledge ${findingIds.length} finding${findingIds.length === 1 ? '' : 's'} on ${project?.name ?? 'a site'}.`
  },
  handler: async (ctx, { findingIds }) => {
    if (findingIds.length > acknowledgeCap)
      fail('TOO_LARGE', `Acknowledge at most ${acknowledgeCap} findings at once.`)
    let acknowledged = 0
    for (const id of findingIds) {
      const finding = await ctx.db.get(id)
      if (!finding || finding.state === 'fixed' || finding.state === 'acknowledged') continue
      await ctx.db.patch(id, { state: 'acknowledged' })
      acknowledged++
    }
    return { acknowledged }
  },
})

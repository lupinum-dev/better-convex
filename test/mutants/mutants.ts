/**
 * The mutation check: one row per security guard, the one-line break that
 * removes it, and the tests that must fail when it is gone.
 *
 * `pnpm test:mutants` runs every row (`--only <id>` for one). The plugin in
 * `plugin.ts` applies a row in memory as its file loads; nothing is written to
 * the working tree. `run.ts` holds the rules a row must pass.
 *
 * Every fixed security finding adds one regression test and one row here
 * whose `kills` names that test.
 */

type Project = 'functions' | 'agents' | 'unit' | 'convex' | 'mcp' | 'security'

export interface Mutant {
  /** Stable ID, e.g. 'S10-acting-as-status'. */
  id: string
  /** The invariant or class it guards: 'S1'…'S18', 'C1'…'C11', or 'budget'. */
  guards: string
  /** Repo-relative file. */
  file: string
  /** Must match exactly once in `file`. */
  find: string
  replace: string
  /** Full vitest test names ("file > describe > test") that must ALL fail. */
  kills: string[]
  /** The vitest projects that hold the `kills` tests. Default: ['functions', 'agents']. */
  projects?: Project[]
}

/** Mutants no test can see, with the reason. The runner does not run them. */
export interface Equivalent {
  id: string
  file: string
  find: string
  replace: string
  reason: string
}

const F = 'packages/functions/test'
const A = 'packages/agents/test'
const inApp = `${A}/approvals/approvals.test.ts > an in-app agent step acts only on a live grant, in the current turn of a running run`

export const mutants: Mutant[] = [
  {
    id: 'S1-internal-functions',
    guards: 'S1',
    file: 'packages/functions/src/guard.ts',
    find: 'fn.isPublic || fn.isInternal || fn.isHttp',
    replace: 'fn.isPublic || fn.isHttp',
    kills: [
      `${F}/no-bypass.test.ts > raw functions are found in any module, router routes included`,
    ],
  },
  {
    id: 'S1-router-walk',
    guards: 'S1',
    file: 'packages/functions/src/guard.ts',
    find: "typeof router?.getRoutes === 'function'",
    replace: 'false',
    kills: [
      `${F}/no-bypass.test.ts > raw functions are found in any module, router routes included`,
    ],
  },
  {
    id: 'S3-get-readable',
    guards: 'S3',
    file: 'packages/functions/src/rules.ts',
    find: "row !== null && (await judge(table, row, 'read')) === 'ok' ? row : null",
    replace: 'row',
    kills: [`${F}/rules.test.ts > a get of a foreign row returns null`],
  },
  {
    id: 'S3-query-rows',
    guards: 'S3',
    file: 'packages/functions/src/rules.ts',
    find: "if ((await judge(table, doc, 'read')) !== 'ok') {",
    replace: 'if (false) {',
    kills: [
      `${F}/rules.test.ts > a query that returns a foreign row fails instead of leaking it`,
      `${F}/rules.test.ts > reading a query with take checks the rows`,
      `${F}/rules.test.ts > reading a query with first checks the rows`,
      `${F}/rules.test.ts > reading a query with unique checks the rows`,
      `${F}/rules.test.ts > reading a query with paginate checks the rows`,
      `${F}/rules.test.ts > reading a query with search checks the rows`,
      `${F}/rules.test.ts > reading a query with forAwait checks the rows`,
      `${F}/rules.test.ts > reading a query with next checks the rows`,
    ],
  },
  {
    id: 'S3-paginate',
    guards: 'S3',
    file: 'packages/functions/src/rules.ts',
    find: 'await rowsOf(result.page)',
    replace: 'void result',
    kills: [`${F}/rules.test.ts > reading a query with paginate checks the rows`],
  },
  {
    id: 'S3-unique',
    guards: 'S3',
    file: 'packages/functions/src/rules.ts',
    find: 'const rows = await rowsOf(await query.take(2))',
    replace: 'const rows = await query.take(2)',
    kills: [`${F}/rules.test.ts > reading a query with unique checks the rows`],
  },
  {
    id: 'S3-qualified-get',
    guards: 'S3',
    file: 'packages/functions/src/rules.ts',
    find: 'raw.normalizeId(table, args[1] as string) === null',
    replace: 'false',
    kills: [`${F}/rules.test.ts > a table-qualified get only finds rows of that table`],
  },
  {
    id: 'S3-inside-call',
    guards: 'S3',
    file: 'packages/functions/src/rules.ts',
    find: 'return (await chain(load, raw, ref)).some((t) => t.id === call.tenant!.id)',
    replace: 'return true',
    kills: [
      `${F}/shapes.test.ts > K3: a client is created only under the agency the call names, where the role allows it`,
    ],
  },
  {
    id: 'S3-owner',
    guards: 'S3',
    file: 'packages/functions/src/rules.ts',
    find: "actor.kind !== 'visitor' && row[rule.field] === actor.user._id ? 'ok' : 'hidden'",
    replace: "'ok'",
    kills: [`${F}/rules.test.ts > owner rows of other people fail the query`],
  },
  {
    id: 'S3-tenant-role',
    guards: 'S3',
    file: 'packages/functions/src/rules.ts',
    find: "        return call.allows(role, call.action) ? 'ok' : 'denied'",
    replace: "        return 'ok'",
    kills: [`${F}/rules.test.ts > writes check the row tenant and the role there`],
  },
  {
    id: 'S3-patch-after',
    guards: 'S3',
    file: 'packages/functions/src/rules.ts',
    find: "await assertWritable(table, next, 'write')\n      await assertParent(table, row, next)\n      wrote(id)\n      return (raw.patch",
    replace: 'await assertParent(table, row, next)\n      wrote(id)\n      return (raw.patch',
    kills: [`${F}/rules.test.ts > writes check the row tenant and the role there`],
  },
  {
    id: 'S4-unknown-method',
    guards: 'S4',
    file: 'packages/functions/src/rules.ts',
    find: 'if (prop in methods) return methods[prop]',
    replace: "if (prop in methods || prop !== 'then') return methods[prop] ?? query[prop]",
    kills: [
      `${F}/rules.test.ts > a query method the library does not know fails instead of passing rows through`,
    ],
  },
  {
    id: 'S4-system',
    guards: 'S4',
    file: 'packages/functions/src/rules.ts',
    find: 'get system(): never {',
    replace: 'get system(): never {\n      return raw.system as never',
    kills: [`${F}/rules.test.ts > system tables are closed to operations`],
  },
  {
    id: 'S5-own',
    guards: 'S5',
    file: 'packages/functions/src/policy.ts',
    find: 'record && Object.hasOwn(record, key) ? record[key] : undefined',
    replace: 'record?.[key]',
    kills: [
      `${F}/policy.test.ts > the unknown role or scope "toString" grants nothing`,
      `${F}/policy.test.ts > the unknown role or scope "constructor" grants nothing`,
      `${F}/policy.test.ts > the unknown role or scope "__proto__" grants nothing`,
      `${F}/shapes.test.ts > K1: the unknown role "toString" is denied`,
      `${F}/shapes.test.ts > K1: the unknown role "constructor" is denied`,
      `${F}/shapes.test.ts > K1: the unknown role "__proto__" is denied`,
    ],
  },
  {
    id: 'S5-role-layer',
    guards: 'S5',
    file: 'packages/functions/src/policy.ts',
    find: 'if (role === null || !roleAllows(policy, role, action)) return',
    replace: 'if (role === null) return',
    kills: [
      `${F}/policy.test.ts > decide intersects role, grant and agent rule: {"kind":"person"} as member for projects.archive is deny`,
      `${F}/shapes.test.ts > K1: the unknown role "superuser" is denied`,
    ],
  },
  {
    id: 'S6-caller-visitor',
    guards: 'S6',
    file: 'packages/functions/src/functions.ts',
    find: '      (await signedIn(ctx)) ??\n',
    replace: '',
    kills: [`${F}/rules.test.ts > the web client sees coded failures`],
  },
  {
    id: 'S6-decide-visitor',
    guards: 'S6',
    file: 'packages/functions/src/policy.ts',
    find: "if (asker.kind === 'visitor') return isPublic ? 'allow' : 'deny'",
    replace: "if (asker.kind === 'visitor') return 'allow'",
    kills: [`${F}/rules.test.ts > a visitor reads published pages; drafts and edits need a member`],
  },
  {
    id: 'S7-reached-raw',
    guards: 'S7',
    file: 'packages/functions/src/functions.ts',
    find: '                reachedRaw()\n',
    replace: '',
    kills: [
      `${F}/rules.test.ts > a raw function reached from an operation keeps none of its writes, even if the handler catches`,
      `${F}/rules.test.ts > an internal action that reached a raw function fails`,
    ],
  },
  {
    id: 'S7-settle',
    guards: 'S7',
    file: 'packages/functions/src/functions.ts',
    find: '      if (tainted) throw tainted\n      return value',
    replace: '      return value',
    kills: [
      `${F}/rules.test.ts > a raw function reached from an operation keeps none of its writes, even if the handler catches`,
    ],
  },
  {
    id: 'S7-internal-action',
    guards: 'S7',
    file: 'packages/functions/src/functions.ts',
    find: 'if (reached) {',
    replace: 'if (false) {',
    kills: [`${F}/rules.test.ts > an internal action that reached a raw function fails`],
  },
  {
    id: 'S7-wrap-args',
    guards: 'S7',
    file: 'packages/functions/src/functions.ts',
    find: 'isComponent(ref) ? args : { actingAs: as, input: args ?? {} }',
    replace: 'args',
    kills: [
      `${F}/rules.test.ts > operations cannot call or schedule the app's raw functions`,
      `${F}/rules.test.ts > an internal operation run now acts as the caller, with the rules`,
    ],
  },
  {
    id: 'S8-different-places',
    guards: 'S8',
    file: 'packages/functions/src/functions.ts',
    find: 'if (named.length > 0 && !deepest && !op.crossTenant) {',
    replace: 'if (false) {',
    kills: [
      `${F}/shapes.test.ts > K2: a move between a workspace and an organization needs crossTenant, and a role in both that allows it`,
    ],
  },
  {
    id: 'S8-cross-tenant-role',
    guards: 'S8',
    file: 'packages/functions/src/functions.ts',
    find: 'if (role === null || role === undefined || !roleAllows(policy, role, op.action))',
    replace: 'if (role === null || role === undefined)',
    kills: [
      `${F}/shapes.test.ts > K2: a move between a workspace and an organization needs crossTenant, and a role in both that allows it`,
    ],
  },
  {
    id: 'S9-door-scopes',
    guards: 'S9',
    file: 'packages/agents/src/door.ts',
    find: 'entry.scopes.some((scope) => principal.scopes.includes(scope))',
    replace: 'true',
    kills: [`${A}/door/door.test.ts > a read-only grant lists only read tools`],
  },
  {
    id: 'S9-decide-grant',
    guards: 'S9',
    file: 'packages/functions/src/policy.ts',
    find: "    if (!granted) return 'deny'\n",
    replace: '',
    kills: [
      `${F}/policy.test.ts > decide intersects role, grant and agent rule: {"kind":"agent","scopes":["projects:read"]} as owner for projects.create is deny`,
      `${F}/policy.test.ts > tenantless actions skip the role but keep the grant`,
    ],
  },
  {
    id: 'S10-acting-as-status',
    guards: 'S10',
    file: 'packages/functions/src/functions.ts',
    find: "row?.status === 'executing' ||",
    replace: 'true ||',
    kills: [
      `${A}/approvals/approvals.test.ts > work refuses an approval that is not executing right now`,
    ],
  },
  {
    id: 'S10-internal-approve',
    guards: 'S10',
    file: 'packages/functions/src/functions.ts',
    find: "authorized.decision === 'approve' &&",
    replace: 'false &&',
    kills: [
      `${A}/approvals/approvals.test.ts > an internal operation that needs approval runs only under one`,
    ],
  },
  {
    id: 'S10-decide-expired',
    guards: 'S10',
    file: 'packages/agents/src/tools.ts',
    find: 'if (row.expiresAt <= Date.now())',
    replace: 'if (false)',
    kills: [
      `${A}/approvals/approvals.test.ts > approving an expired request is refused and changes nothing`,
    ],
  },
  {
    id: 'S10-tool-executing',
    guards: 'S10',
    file: 'packages/agents/src/tools.ts',
    find: "row?.status !== 'executing' ||",
    replace: 'false ||',
    kills: [
      `${A}/approvals/approvals.test.ts > work refuses an approval that is not executing right now`,
    ],
  },
  {
    id: 'S11-changed-hash',
    guards: 'S11',
    file: 'packages/agents/src/tools.ts',
    find: 'if (!now || (await fingerprint(now)) !== before) return true',
    replace: 'if (!now) return true',
    kills: [
      `${A}/approvals/approvals.test.ts > approving fails as STALE when the project changed after the request`,
      `${A}/approvals/approvals.test.ts > every row a request covers is checked for changes, up to a stated limit`,
      `${A}/approvals/approvals.test.ts > a request on a row of an anyOf table fails as STALE when that row changed`,
      `${A}/approvals/approvals.test.ts > a request naming rows as record keys fails as STALE when one changed`,
    ],
  },
  {
    id: 'S11-record-keys',
    guards: 'S11',
    file: 'packages/functions/src/values.ts',
    find: '            ...idsIn(json.keys, key),\n',
    replace: '',
    kills: [
      `${A}/approvals/approvals.test.ts > a request naming rows as record keys fails as STALE when one changed`,
    ],
  },
  {
    id: 'S11-max-seen',
    guards: 'S11',
    file: 'packages/agents/src/tools.ts',
    find: 'if (touched.length > maxSeen) {',
    replace: 'if (false) {',
    kills: [
      `${A}/approvals/approvals.test.ts > every row a request covers is checked for changes, up to a stated limit`,
    ],
  },
  {
    id: 'S11-fingerprint-json',
    guards: 'S11',
    file: 'packages/functions/src/values.ts',
    find: 'stable(convexToJson(row as Value))',
    replace: 'stable(row)',
    kills: [`${F}/values.test.ts > a fingerprint sees bytes and int64 fields`],
  },
  {
    id: 'S11-input-rows',
    guards: 'S11',
    file: 'packages/agents/src/tools.ts',
    find: 'of idsIn(jsonOf(v.object(op.args)), input)) {',
    replace: 'of [] as { table: string; id: string }[]) {',
    kills: [
      `${A}/approvals/approvals.test.ts > a request on a row of an anyOf table fails as STALE when that row changed`,
      `${A}/approvals/approvals.test.ts > a request naming rows as record keys fails as STALE when one changed`,
      `${A}/approvals/approvals.test.ts > a request naming a row the agent cannot read fails as NOT_FOUND and stores nothing`,
    ],
  },
  {
    id: 'S12-writes-per-minute',
    guards: 'S12',
    file: 'packages/agents/src/tools.ts',
    find: 'if ((row?.count ?? 0) >= perMinute) {',
    replace: 'if (false) {',
    kills: [`${A}/approvals/approvals.test.ts > an agent may make 60 writes a minute, then waits`],
  },
  {
    id: 'S12-open-requests',
    guards: 'S12',
    file: 'packages/agents/src/tools.ts',
    find: 'if (open.length >= openApprovals) {',
    replace: 'if (false) {',
    kills: [`${A}/approvals/approvals.test.ts > an agent with 20 open requests is told to wait`],
  },
  {
    id: 'S12-ids-per-call',
    guards: 'S12',
    file: 'packages/functions/src/functions.ts',
    find: 'if (++ids > idsPerCall)',
    replace: 'if (++ids < 0)',
    kills: [
      `${F}/rules.test.ts > a call with more IDs than the limit is refused before the handler runs`,
    ],
  },
  {
    id: 'S13-new-summary',
    guards: 'S13',
    file: 'packages/agents/src/tools.ts',
    find: '              summary: inertMarkdown(summary),',
    replace: '              summary,',
    kills: [
      `${A}/approvals/approvals.test.ts > summaries are one plain line for people, and inert markdown for agents`,
    ],
  },
  {
    id: 'S13-one-line',
    guards: 'S13',
    file: 'packages/agents/src/tools.ts',
    find: 'const summary = oneLine(',
    replace: 'const summary = String(',
    kills: [
      `${A}/approvals/approvals.test.ts > summaries are one plain line for people, and inert markdown for agents`,
      `${A}/door/door.test.ts > the approval text an MCP host shows carries no live markdown from row data`,
    ],
  },
  {
    id: 'S13-escape-html',
    guards: 'S13',
    file: 'packages/functions/src/values.ts',
    find: '[\\\\`*_[\\]()<>!#|~]',
    replace: '[\\\\`*_[\\]()!#|~]',
    kills: [`${F}/values.test.ts > inert markdown shows links and HTML as text`],
  },
  {
    id: 'S13-invisible',
    guards: 'S13',
    file: 'packages/functions/src/values.ts',
    find: "text.replace(invisible, ' ')",
    replace: 'text',
    kills: [
      `${F}/values.test.ts > oneLine("\u200B\u200B") is ""`,
      `${F}/values.test.ts > oneLine("a\u202Etxt.exe") is "a txt.exe"`,
    ],
  },
  {
    id: 'S13-repeated-summary',
    guards: 'S13',
    file: 'packages/agents/src/tools.ts',
    find: 'summary: inertMarkdown(same.summary),',
    replace: 'summary: same.summary,',
    kills: [
      `${A}/approvals/approvals.test.ts > summaries are one plain line for people, and inert markdown for agents`,
    ],
  },
  {
    id: 'S13-check-approval-summary',
    guards: 'S13',
    file: 'packages/agents/src/tools.ts',
    find: 'summary: inertMarkdown(row.summary),',
    replace: 'summary: row.summary,',
    kills: [
      `${A}/approvals/approvals.test.ts > summaries are one plain line for people, and inert markdown for agents`,
    ],
  },
  {
    id: 'S14-cancel-requests',
    guards: 'S14',
    file: 'packages/agents/src/runs.ts',
    find: '    if (which(row))',
    replace: '    if (false)',
    kills: [
      `${A}/door/door.test.ts > revoking a connection cancels its open requests, and its tools then fail`,
    ],
  },
  {
    id: 'S14-mcp-principal',
    guards: 'S14',
    file: 'packages/functions/src/functions.ts',
    find: 'const { user: authUser } = await auth\n      .requireMcpPrincipal(\n        ctx,\n        caller.principal,\n        options.approved ? { allowExpiredToken: true } : {},\n      )',
    replace:
      'const { user: authUser } = await Promise.resolve({ user: { id: caller.principal.userId } })',
    kills: [
      `${A}/door/door.test.ts > revoking a connection cancels its open requests, and its tools then fail`,
      `${A}/approvals/approvals.test.ts > a follow-up of an approved request changes nothing after the person revokes the connection`,
    ],
  },
  {
    id: 'S14-in-app-revoked',
    guards: 'S14',
    file: 'packages/functions/src/functions.ts',
    find: 'grant.revokedAt !== undefined ||',
    replace: '',
    kills: [
      `${A}/approvals/approvals.test.ts > an in-app agent step acts only on a live grant, in the current turn of a running run: 'grant revoked'`,
    ],
  },
  {
    id: 'S14-live-grant',
    guards: 'S14',
    file: 'src/runtime/convex-auth/mcp-principal.ts',
    find: 'if (!grant || grant.grantId !== principal.grantId) throw accessDenied()',
    replace: 'if (false) throw accessDenied()',
    kills: [
      'test/convex/mcp-oauth.test.ts > requireMcpPrincipal > denies a revoked connection and a disabled client',
      'test/convex/mcp-oauth.test.ts > requireMcpPrincipal > with allowExpiredToken, accepts an expired token of a live grant and still denies a revoked one',
    ],
    projects: ['convex'],
  },
  {
    id: 'S14-token-expiry',
    guards: 'S14',
    file: 'src/runtime/convex-auth/mcp-principal.ts',
    find: 'principal.expiresAt * 1_000 <= Date.now()',
    replace: 'false',
    kills: ['test/convex/mcp-oauth.test.ts > requireMcpPrincipal > denies a expired principal'],
    projects: ['convex'],
  },
  {
    id: 'S15-activity-tenant',
    guards: 'S15',
    file: 'packages/agents/src/tools.ts',
    find: 'tenantId: extra.tenant?.id,',
    replace: 'tenantId: undefined,',
    kills: [
      `${A}/door/door.test.ts > agent writes appear in the tenant activity feed; non-members cannot read it`,
    ],
  },
  {
    id: 'S15-activity-member',
    guards: 'S15',
    file: 'packages/agents/src/tools.ts',
    find: 'if (!tenant || (await roleOf(ctx, actor.user, tenant)) === null)',
    replace: 'if (!tenant)',
    kills: [
      `${A}/door/door.test.ts > agent writes appear in the tenant activity feed; non-members cannot read it`,
    ],
  },
  {
    id: 'S16-replay',
    guards: 'S16',
    file: 'packages/agents/src/tools.ts',
    find: 'if (earlier) {',
    replace: 'if (false) {',
    kills: [
      `${A}/approvals/approvals.test.ts > re-asking with the same request_id after expiry makes a new request; a retry then replays`,
      `${A}/approvals/approvals.test.ts > a retry after a large approved result replays the marker`,
      `${A}/door/cost.test.ts > a tool call with a request_id, and its retry`,
      `${A}/door/door.test.ts > a numeric request_id still deduplicates`,
    ],
  },
  {
    id: 'S16-numeric-request-id',
    guards: 'S16',
    file: 'packages/agents/src/door.ts',
    find: "typeof rawRequestId === 'number' ? String(rawRequestId) : rawRequestId",
    replace: 'rawRequestId',
    kills: [`${A}/door/door.test.ts > a numeric request_id still deduplicates`],
  },
  {
    id: 'S16-same-call',
    guards: 'S16',
    file: 'packages/agents/src/tools.ts',
    find: 'if (same)',
    replace: 'if (false)',
    kills: [`${A}/approvals/approvals.test.ts > the same call twice makes one request`],
  },
  {
    id: 'S16-earlier-call',
    guards: 'S16',
    file: 'packages/agents/src/tools.ts',
    find: 'if (earlier.call !== call)',
    replace: 'if (false)',
    kills: [
      `${A}/approvals/approvals.test.ts > re-asking with the same request_id after expiry makes a new request; a retry then replays`,
    ],
  },
  {
    id: 'S16-same-key',
    guards: 'S16',
    file: 'packages/agents/src/tools.ts',
    find: 'if (sameKey.some((row) => callKey(row.tool, row.input) !== call)) {',
    replace: 'if (false) {',
    kills: [
      `${A}/approvals/approvals.test.ts > re-asking with the same request_id after expiry makes a new request; a retry then replays`,
    ],
  },
  {
    id: 'S17-allof-hidden',
    guards: 'S17',
    file: 'packages/functions/src/rules.ts',
    find: "if (part === 'hidden') return 'hidden'",
    replace: '',
    kills: [
      `${F}/rules.test.ts > every part of an allOf rule holds, even for an operation without its own check`,
    ],
  },
  {
    id: 'S17-allof-denied',
    guards: 'S17',
    file: 'packages/functions/src/rules.ts',
    find: "if (part === 'denied') verdict = 'denied'",
    replace: '',
    kills: [`${F}/rules.test.ts > writes check the row tenant and the role there`],
  },
  {
    id: 'S18-parties',
    guards: 'S18',
    file: 'packages/agents/src/tools.ts',
    find: 'for (const party of parties) if (await approverIn(party.tenantId)) return true',
    replace: 'void parties',
    kills: [
      `${A}/approvals/approvals.test.ts > an approver decides a request only when every row it touches is of the approver’s tenant`,
    ],
  },
  {
    id: 'S18-intersection',
    guards: 'S18',
    file: 'packages/agents/src/tools.ts',
    find: 'common = new Set([...(common ?? owners)].filter((tenantId) => owners.has(tenantId)))',
    replace: 'common = new Set([...(common ?? []), ...owners])',
    kills: [
      `${A}/approvals/approvals.test.ts > an approver decides a request only when every row it touches is of the approver’s tenant`,
    ],
  },
  {
    id: 'S18-call-tenant',
    guards: 'S18',
    file: 'packages/agents/src/tools.ts',
    find: 'if (row.tenantId !== undefined && (await approverIn(row.tenantId))) return true',
    replace: '',
    kills: [
      `${A}/approvals/approvals.test.ts > a co-owner may decide a request through \`approvers\`; a viewer may not`,
      `${A}/approvals/approvals.test.ts > a row a request only reads gives its tenant no say, even with sharedRows`,
    ],
  },
  {
    id: 'S18-approver-role',
    guards: 'S18',
    file: 'packages/agents/src/tools.ts',
    find: 'return role !== null && approvers.roles.includes(role)',
    replace: 'return role !== null',
    kills: [
      `${A}/approvals/approvals.test.ts > a co-owner may decide a request through \`approvers\`; a viewer may not`,
    ],
  },
  {
    id: 'S18-pending',
    guards: 'S18',
    file: 'packages/agents/src/tools.ts',
    find: 'row.requester.userId !== actor.user._id && (await mayDecide(ctx, actor, row))',
    replace: 'row.requester.userId !== actor.user._id',
    kills: [
      `${A}/approvals/approvals.test.ts > a co-owner may decide a request through \`approvers\`; a viewer may not`,
    ],
  },
  {
    id: 'S18-get',
    guards: 'S18',
    file: 'packages/agents/src/tools.ts',
    find: 'if (!row || !(await mayDecide(ctx, actor, row))) return null',
    replace: 'if (!row) return null',
    kills: [
      `${A}/approvals/approvals.test.ts > an approver decides a request only when every row it touches is of the approver’s tenant`,
    ],
  },
  // In-app agent steps: a live grant, the current turn, a running run (T1).
  {
    id: 'S9-in-app-turn',
    guards: 'C1',
    file: 'packages/functions/src/functions.ts',
    find: "run.status !== 'running' || caller.turn !== run.turn",
    replace: "run.status !== 'running'",
    kills: [`${inApp}: 'step of turn 1, run in turn 2'`],
    projects: ['agents'],
  },
  {
    id: 'S9-in-app-waiting-run',
    guards: 'C1',
    file: 'packages/functions/src/functions.ts',
    find: "(run.status !== 'running' || caller.turn !== run.turn)",
    replace: '(caller.turn !== run.turn)',
    kills: [`${inApp}: 'run waiting'`],
    projects: ['agents'],
  },
  {
    id: 'S9-in-app-ended-run',
    guards: 'C1',
    file: 'packages/functions/src/functions.ts',
    find: "if (run.status === 'done' || run.status === 'failed')",
    replace: 'if (false)',
    kills: [`${inApp}: 'run done'`, `${inApp}: 'run failed'`],
    projects: ['agents'],
  },
  {
    id: 'S14-in-app-grant-expiry',
    guards: 'S14',
    file: 'packages/functions/src/functions.ts',
    find: ' || grant.expiresAt <= Date.now()',
    replace: '',
    kills: [`${inApp}: 'grant expired'`],
    projects: ['agents'],
  },
  // What handlers see of the actor, and how long approved follow-ups act (T2, T7).
  {
    id: 'C10-shown-internal-action',
    guards: 'C10',
    file: 'packages/functions/src/functions.ts',
    find: 'actor: shown(who) }',
    replace: 'actor: who }',
    kills: [
      `${A}/approvals/approvals.test.ts > work an approved request scheduled runs under the approval, for an hour`,
    ],
    projects: ['agents'],
  },
  {
    id: 'C10-shown-operation',
    guards: 'C10',
    file: 'packages/functions/src/functions.ts',
    find: 'actor: shown(actor) }',
    replace: 'actor }',
    kills: [
      `${A}/approvals/approvals.test.ts > work an approved request scheduled runs under the approval, for an hour`,
    ],
    projects: ['agents'],
  },
  {
    id: 'C1-follow-up-after-revoke',
    guards: 'S14',
    file: 'packages/functions/src/functions.ts',
    find: 'const { user: authUser } = await auth',
    replace:
      'const { user: authUser } = options.approved ? { user: { id: caller.principal.userId } } : await auth',
    kills: [
      `${A}/approvals/approvals.test.ts > a follow-up of an approved request changes nothing after the person revokes the connection`,
    ],
    projects: ['agents'],
  },
  {
    id: 'C1-follow-up-window',
    guards: 'C1',
    file: 'packages/functions/src/functions.ts',
    find: 'Date.now() < row.decidedAt + followUpWindow &&',
    replace: '',
    kills: [
      `${A}/approvals/approvals.test.ts > the same follow-up scheduled again after the hour changes nothing`,
      `${A}/approvals/approvals.test.ts > work an approved request scheduled runs under the approval, for an hour`,
    ],
    projects: ['agents'],
  },
  // unguardedFunctions: the files it scans and the maps it refuses (B2).
  {
    id: 'S1-unguarded-skip-dots',
    guards: 'S1',
    file: 'packages/functions/src/guard.ts',
    find: '(file.match(/\\./g) ?? []).length <= 1',
    replace: 'true',
    kills: [
      `${F}/no-bypass.test.ts > raw functions are found in any module, router routes included`,
      `${F}/no-bypass.test.ts > only files Convex skips throws`,
    ],
    projects: ['functions'],
  },
  {
    id: 'S1-unguarded-skip-generated',
    guards: 'S1',
    file: 'packages/functions/src/guard.ts',
    find: "!segments.includes('_generated') && ",
    replace: '',
    kills: [
      `${F}/no-bypass.test.ts > raw functions are found in any module, router routes included`,
    ],
    projects: ['functions'],
  },
  {
    id: 'S1-unguarded-empty-map',
    guards: 'S1',
    file: 'packages/functions/src/guard.ts',
    find: 'if (deployed.length === 0)',
    replace: 'if (false)',
    kills: [
      `${F}/no-bypass.test.ts > an empty map throws`,
      `${F}/no-bypass.test.ts > only files Convex skips throws`,
    ],
    projects: ['functions'],
  },
  {
    id: 'S1-unguarded-no-operations',
    guards: 'S1',
    file: 'packages/functions/src/guard.ts',
    find: 'if (!functions.some(([, fn]) => fn[OPERATION]))',
    replace: 'if (false)',
    kills: [`${F}/no-bypass.test.ts > no defineFunctions operation throws`],
    projects: ['functions'],
  },
  {
    id: 'S1-unguarded-trusted-routes',
    guards: 'S1',
    file: 'packages/functions/src/guard.ts',
    find: '.filter(([route]) => !trusted(route))',
    replace: '',
    kills: [
      `${F}/no-bypass.test.ts > raw functions are found in any module, router routes included`,
    ],
    projects: ['functions'],
  },
  {
    id: 'S1-unguarded-trusted-marker',
    guards: 'S1',
    file: 'packages/functions/src/guard.ts',
    find: '!fn[OPERATION] && !fn[GUARDED]',
    replace: '!fn[OPERATION]',
    kills: [
      `${F}/no-bypass.test.ts > raw functions are found in any module, router routes included`,
    ],
    projects: ['functions'],
  },
  // createBetterConvexTestAuth refuses to run outside a test runner (B1).
  {
    id: 'C9-test-auth-runner',
    guards: 'C9',
    file: 'src/runtime/convex-auth/test.ts',
    find: '): BetterConvexAuth<DataModel, BetterConvexTestAuthInstance> {\n  requireTestRunner()\n',
    replace: '): BetterConvexAuth<DataModel, BetterConvexTestAuthInstance> {\n',
    kills: [
      'test/convex/auth-component-limits.test.ts > auth component limits > refuses to sign in or grant outside a test runner',
    ],
    projects: ['convex'],
  },
  // The MCP transport bounds and the access verifier boundary.
  {
    id: 'S12-transport-declared-length',
    guards: 'S12',
    file: 'packages/agents/src/transport.ts',
    find: 'if (bytes > maximumMcpRequestBytes) throw new McpTransportFailure(413)',
    replace: 'if (false) throw new McpTransportFailure(413)',
    kills: [
      `${A}/mcp/transport.test.ts > MCP transport bounds > accepts the exact request limit and rejects declared or streamed overflow`,
    ],
    projects: ['agents'],
  },
  {
    id: 'S12-transport-streamed-length',
    guards: 'S12',
    file: 'packages/agents/src/transport.ts',
    find: 'if (total > maximumBytes) {',
    replace: 'if (false) {',
    kills: [
      `${A}/mcp/transport.test.ts > MCP transport bounds > accepts the exact request limit and rejects declared or streamed overflow`,
      `${A}/mcp/transport.test.ts > MCP transport bounds > bounds JSON responses and rejects streaming or non-JSON responses`,
      `${A}/mcp/convex-handler.test.ts > Convex-native official MCP handler composition > enforces request bounds before protocol parsing or application construction`,
    ],
    projects: ['agents'],
  },
  {
    id: 'S14-access-resource',
    guards: 'S14',
    file: 'packages/agents/src/access.ts',
    find: "if (resource !== expectedResource) throw new TypeError('Unexpected access resource')",
    replace: "if (false) throw new TypeError('Unexpected access resource')",
    kills: [
      `${A}/mcp/access-verifier.test.ts > provider-neutral MCP access verification boundary > rejects a verifier result with another resource`,
    ],
    projects: ['agents'],
  },
  {
    id: 'S14-access-issuer',
    guards: 'S14',
    file: 'packages/agents/src/access.ts',
    find: "if (issuer !== expectedIssuer) throw new TypeError('Unexpected access issuer')",
    replace: "if (false) throw new TypeError('Unexpected access issuer')",
    kills: [
      `${A}/mcp/access-verifier.test.ts > provider-neutral MCP access verification boundary > rejects a verifier result with a rewritten issuer`,
      `${A}/mcp/convex-handler.test.ts > Convex-native official MCP handler composition > rejects foreign issuers and never accepts a bearer from query or body`,
    ],
    projects: ['agents'],
  },
]

export const equivalents: Equivalent[] = [
  {
    id: 'S11-input-rows-map',
    file: 'packages/agents/src/tools.ts',
    find: 'const inputRows = new Map(rows)',
    replace: 'const inputRows = new Map<string, Record<string, unknown> | null>()',
    reason:
      'The idsIn loop loads every row the input names again, so the copy of the rows authorize read adds none.',
  },
  {
    id: 'S11-rows-clear',
    file: 'packages/agents/src/tools.ts',
    find: '            rows.clear()\n',
    replace: '',
    reason:
      'The summary rows are merged with the input rows, which the idsIn loop already holds: no row is lost or added.',
  },
  {
    id: 'S14-live-grant-id',
    file: 'src/runtime/convex-auth/mcp-principal.ts',
    find: 'if (!grant || grant.grantId !== principal.grantId) throw accessDenied()',
    replace: 'if (!grant) throw accessDenied()',
    reason:
      'queryOAuthLiveGrant returns null unless the consent ID equals principal.grantId, and returns that ID: the second check is defence in depth.',
  },
]

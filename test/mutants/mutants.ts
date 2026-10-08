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

/**
 * `integration` holds the starter's real-backend journey. Only rows in a starter file reach it:
 * `test/integration/harness.ts` applies the row to the starter copy that `nuxt dev` serves. The
 * packages run there from their build, which no row changes.
 */
type Project = 'functions' | 'agents' | 'unit' | 'convex' | 'mcp' | 'security' | 'integration'

export interface Mutant {
  /** Stable ID, e.g. 'S10-acting-as-status'. */
  id: string
  /**
   * What it guards: an invariant 'S1'…'S18' (plan.md section 6), a bug class 'C1'…'C11'
   * (review-checklist.md), or a short name such as 'transport' or 'live'.
   */
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
const fuzz = `${F}/query-fuzz.test.ts > a random query chain hands out exactly the raw rows, or fails on a foreign one`
const starter = 'starters/mcp-oauth-agent/convex'
const leaks = `${starter}/leaks.test.ts > no call reaches another organization’s project`
const inApp = `${A}/approvals/approvals.test.ts > an in-app agent step acts only on a live grant, in the current turn of a running run`
const sequences = `${A}/approvals/sequence-fuzz.test.ts > random sequences of agent calls, decisions, revokes and clock steps change only what someone may change`
const consumers = 'test/fixtures/consumers'
const agency = `${consumers}/agency/convex`
const agencyLeaks = `${agency}/agency.test.ts > no call reaches another client or agency`
const content = `${consumers}/content/convex`
const contentLeaks = `${content}/content.test.ts > no call from site A reaches site B's pages`
const marketplace = `${consumers}/marketplace/convex`
const marketplaceLeaks = `${marketplace}/marketplace.test.ts > no call reaches another organization's order or draft`
const sites = `${consumers}/sites/convex`
const sitesLeaks = `${sites}/sites.test.ts > no call reaches another organization's site`
const callbacks = `${A}/callbacks/callbacks.test.ts`
const agentRule = `${F}/policy.test.ts > an agent rule that`
const journey =
  'test/integration/mcp-auth.integration.test.ts > MCP OAuth starter end to end > lets a person decide an agent request on the link the agent gives'

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
    id: 'S2-table-without-rule',
    guards: 'S2',
    file: 'packages/functions/src/functions.ts',
    find: '[T in AppTables<DM>]: Rule<',
    replace: '[T in AppTables<DM>]?: Rule<',
    kills: [`${F}/types.test.ts > a table without a rule is a type error that names it`],
    projects: ['functions'],
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
  // T4: the seeded fuzz runs random chains and compares them with the same chain on the raw db.
  // Only the fuzz sees the unique() drift.
  {
    id: 'S3-fuzz-checks-wrong-rows',
    guards: 'S3',
    file: 'packages/functions/src/rules.ts',
    find: 'for (const row of rows) await check(row)',
    replace: 'for (const row of rows.slice(1)) await check(row)',
    kills: [
      fuzz,
      `${F}/rules.test.ts > reading a query with take checks the rows`,
      `${F}/rules.test.ts > reading a query with unique checks the rows`,
      `${F}/rules.test.ts > reading a query with paginate checks the rows`,
    ],
  },
  {
    id: 'S3-fuzz-unique-drift',
    guards: 'S3',
    file: 'packages/functions/src/rules.ts',
    find: 'if (rows.length > 1)',
    replace: 'if (rows.length > 2)',
    kills: [fuzz],
  },
  {
    id: 'S3-fuzz-order-drift',
    guards: 'S3',
    file: 'packages/functions/src/rules.ts',
    find: 'guardQuery(query[name](...args), check)',
    replace: "guardQuery(name === 'order' ? query : query[name](...args), check)",
    kills: [
      fuzz,
      `${F}/rules.test.ts > reading a query with first checks the rows`,
      `${F}/rules.test.ts > reading a query with next checks the rows`,
    ],
  },
  // T5: the agents type tests run tsc on a copy of the sources, with the row applied to the copy.
  {
    // V5: the internals stay off the result, or an app's declaration file must name their type.
    id: 'C8-declarations-internals',
    guards: 'C8',
    file: 'packages/agents/src/tools.ts',
    find: 'return { functions, catalog, approvals, activity, disconnected }',
    replace:
      'return { functions, catalog, approvals, activity, disconnected, kit: internalsOf(fns) as Internals }',
    kills: [`${A}/types.test.ts > the app type-checks and emits declarations`],
    projects: ['agents'],
  },
  {
    id: 'C2-summary-runs-queries',
    guards: 'C2',
    file: 'packages/functions/src/functions.ts',
    find: "ctx: Omit<QueryCtx, 'runQuery'> & { actor: ActorFor<A> },",
    replace: 'ctx: QueryCtx & { actor: ActorFor<A> },',
    kills: [`${A}/types.test.ts > a plan cannot write, call or schedule functions`],
    projects: ['agents'],
  },
  {
    id: 'C2-summary-writes',
    guards: 'C2',
    file: 'packages/functions/src/functions.ts',
    find: "ctx: Omit<QueryCtx, 'runQuery'> & { actor: ActorFor<A> },",
    replace: "ctx: Omit<MutationCtx, 'runQuery'> & { actor: ActorFor<A> },",
    kills: [`${A}/types.test.ts > a plan cannot write, call or schedule functions`],
    projects: ['agents'],
  },
  {
    id: 'C8-tool-arg-descriptions',
    guards: 'C8',
    file: 'packages/functions/src/functions.ts',
    find: 'args?: { [K in keyof Args]?: string }',
    replace: 'args?: Record<string, string>',
    kills: [`${A}/types.test.ts > a tool's argument description must name an argument`],
    projects: ['agents'],
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
    // The door and callTool share this filter, so it fails both.
    id: 'S9-door-scopes',
    guards: 'S9',
    file: 'packages/agents/src/tools.ts',
    find: 'entry.scopes.some((scope) => principal.scopes.includes(scope))',
    replace: 'true',
    kills: [
      `${A}/door/door.test.ts > a read-only grant lists only read tools`,
      `${A}/door/call-tool.test.ts > callTool refuses a tool the grant does not unlock, and names the tools it unlocks`,
    ],
  },
  {
    // callTool sends the input through JSON, as a host must, so a test sees what the door sees.
    id: 'callTool-json',
    guards: 'callTool',
    file: 'packages/agents/src/test.ts',
    find: 'JSON.parse(JSON.stringify(input)) as Record<string, unknown>',
    replace: 'input',
    kills: [`${A}/door/call-tool.test.ts > callTool sends the input as JSON, as a host does`],
  },
  {
    // callTool returns the output after the JSON trip the door makes, so a test sees what a host gets.
    id: 'callTool-json-output',
    guards: 'callTool',
    file: 'packages/agents/src/test.ts',
    find: 'JSON.parse(JSON.stringify(output)) as ToolSuccess',
    replace: 'output',
    kills: [
      `${A}/door/call-tool.test.ts > callTool returns the output as JSON, as the door sends it`,
    ],
  },
  {
    // STRESS G2: input Convex cannot carry is named as a field, at the door and in callTool.
    id: 'G2-unsendable-input',
    guards: 'G2',
    file: 'packages/agents/src/tools.ts',
    find: 'if (invalid) fail(invalid.code, invalid.message)',
    replace: 'if (false) fail(invalid.code, invalid.message)',
    kills: [
      `${A}/door/door.test.ts > wrong input {"name":"x","$schema":"tool"} is named in the error`,
      `${A}/door/call-tool.test.ts > callTool rejects with an input Convex cannot carry, as the tool threw it`,
    ],
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
      sequences,
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
    id: 'S11-seen-before-authorize',
    guards: 'S11',
    file: 'packages/agents/src/tools.ts',
    find: "if (now === null || (await fingerprint(now)) !== hash) fail('STALE', stale)",
    replace: '',
    kills: [
      `${A}/approvals/approvals.test.ts > approving a request whose row was deleted fails as STALE`,
    ],
    projects: ['agents'],
  },
  {
    id: 'S11-plan-stored',
    guards: 'S11',
    file: 'packages/agents/src/tools.ts',
    // Approve runs the plan as the person saw it (release reviews 1 and 2: it looked again).
    find: 'frozen(row.plan)',
    replace: 'frozen(settle(await planOf(op, checked, input)))',
    kills: [
      `${A}/approvals/approvals.test.ts > approving runs the plan the person saw: 'a second project matches now'`,
    ],
    projects: ['agents'],
  },
  {
    id: 'S11-plan-fence',
    guards: 'S11',
    file: 'packages/functions/src/rules.ts',
    find: 'if (call.plan && !(await call.plan.has(id)))',
    replace: 'if (false)',
    kills: [
      `${A}/approvals/approvals.test.ts > approved work cannot change a row that is not in the plan`,
    ],
    projects: ['agents'],
  },
  {
    id: 'S11-plan-created',
    guards: 'S11',
    file: 'packages/functions/src/rules.ts',
    find: '      await call.plan?.created(String(id))\n',
    replace: '',
    kills: [
      `${A}/approvals/approvals.test.ts > the follow-up of approved work may change a row that work created`,
    ],
    projects: ['agents'],
  },
  {
    id: 'S11-cancel-own-jobs',
    guards: 'S11',
    file: 'packages/functions/src/functions.ts',
    find: 'if (approved && !scheduledHere.has(String(id)))',
    replace: 'if (false)',
    kills: [
      `${A}/approvals/approvals.test.ts > approved work cannot cancel a job it did not schedule`,
    ],
    projects: ['agents'],
  },
  {
    id: 'S11-plan-files',
    guards: 'S11',
    file: 'packages/functions/src/functions.ts',
    find: 'if (!files.has(id))',
    replace: 'if (false)',
    kills: [
      `${A}/approvals/approvals.test.ts > approved work deletes only the files its plan lists: 'a file the plan does not list'`,
    ],
    projects: ['agents'],
  },
  {
    id: 'S11-renew-only-asks',
    guards: 'S11',
    file: 'packages/agents/src/tools.ts',
    find: "if (renew && decision !== 'approve') fail('STALE', stale)",
    replace: '',
    kills: [`${A}/approvals/approvals.test.ts > asking again after STALE never runs the work`],
    projects: ['agents'],
  },
  {
    id: 'S11-renew-waiting-run',
    guards: 'S11',
    file: 'packages/agents/src/tools.ts',
    find: "if (run?.status === 'waiting' && run.approvalIds?.includes(row._id))",
    replace: 'if (false)',
    kills: [
      `${A}/approvals/approvals.test.ts > an in-app run that waits on a request waits on the new one after STALE`,
    ],
    projects: ['agents'],
  },
  {
    id: 'S11-renew-wake',
    guards: 'S11',
    file: 'packages/agents/src/tools.ts',
    find: '(renewed ? renewed.expiresAt : Date.now()) + 1000',
    replace: '(renewed ? renewed.expiresAt : Date.now()) + 3_600_000',
    kills: [
      `${A}/approvals/approvals.test.ts > an in-app run that waits on a request waits on the new one after STALE`,
    ],
    projects: ['agents'],
  },
  {
    id: 'S11-renew-turn',
    guards: 'S11',
    file: 'packages/agents/src/tools.ts',
    find: 'approved: approval !== undefined || renew',
    replace: 'approved: approval !== undefined',
    kills: [
      `${A}/approvals/approvals.test.ts > an in-app run that waits on a request waits on the new one after STALE`,
    ],
    projects: ['agents'],
  },
  {
    id: 'S11-ask-again',
    guards: 'S11',
    file: 'packages/agents/src/tools.ts',
    find: "reason.code === 'STALE' ? await askAgain(ctx, row) : undefined",
    replace: 'undefined',
    kills: [
      `${A}/approvals/approvals.test.ts > a request whose row changed is asked again with the current data`,
    ],
    projects: ['agents'],
  },
  {
    id: 'C2-plan-frozen-input',
    guards: 'C2',
    file: 'packages/functions/src/functions.ts',
    find: 'await op.plan(planReader(ctx), frozen(input))',
    replace: 'await op.plan(planReader(ctx), input)',
    kills: [
      `${A}/approvals/approvals.test.ts > a plan cannot change the input the person approves`,
    ],
    projects: ['agents'],
  },
  {
    id: 'C2-plan-paginate',
    guards: 'C2',
    file: 'packages/functions/src/rules.ts',
    find: "if (prop === 'paginate')",
    replace: 'if (false)',
    kills: [`${A}/approvals/approvals.test.ts > a plan cannot paginate`],
    projects: ['agents'],
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
    find: 'if (ids.size > maxSeen) {',
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
    find: 'of idsIn(jsonOf(v.object(op.args)), input))\n',
    replace: 'of [] as { table: string; id: string }[])\n',
    kills: [
      `${A}/approvals/approvals.test.ts > a request whose input names a row that changed fails as STALE, also with a plan of its own rows`,
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
      sequences,
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
      sequences,
    ],
  },
  {
    // A revoke deletes the consent. Without the consent checks the live-grant query admits the
    // revoked token as before, so the call goes through.
    id: 'S14-live-grant',
    guards: 'S14',
    file: 'src/runtime/convex-auth/oauth-live-access.ts',
    find: '    !consent ||\n    !nonEmptyString(consent.id) ||\n    consent.id !== args.grantId ||\n    consent.clientId !== clientId ||\n    consent.userId !== userId ||\n    !consentResources?.includes(identifier) ||\n    !consentScopes ||\n    !containsEvery(consentScopes, scopes)\n  ) {\n    return null\n  }\n  return { user: admission.user, grantId: consent.id }',
    replace:
      '    false\n  ) {\n    return null\n  }\n  return { user: admission.user, grantId: args.grantId }',
    kills: [
      'test/convex/mcp-oauth.test.ts > requireMcpPrincipal > denies a revoked connection and a disabled client',
      'test/convex/mcp-oauth.test.ts > requireMcpPrincipal > with allowExpiredToken, accepts an expired token of a live grant and still denies a revoked one',
      `${A}/door/door.test.ts > revoking a connection cancels its open requests, and its tools then fail`,
      `${A}/approvals/approvals.test.ts > a follow-up of an approved request changes nothing after the person revokes the connection`,
    ],
    projects: ['convex', 'agents'],
  },
  {
    // The live-grant query returns null for a revoked grant. This check turns it into
    // MCP_ACCESS_DENIED; without it the next line reads `grant.user` and throws a TypeError.
    id: 'S14-live-grant-denied',
    guards: 'S14',
    file: 'src/runtime/convex-auth/mcp-principal.ts',
    find: 'if (!grant || grant.grantId !== principal.grantId) throw accessDenied()',
    replace: 'if (false) throw accessDenied()',
    kills: [
      'test/convex/mcp-oauth.test.ts > requireMcpPrincipal > denies a revoked connection and a disabled client',
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
    find: 'if (!tenant || (await roleOf(readOnly(ctx), actor.user, tenant)) === null)',
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
    file: 'packages/agents/src/tools.ts',
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
    find: 'if (asked && callKey(asked.tool, asked.input) !== call)',
    replace: 'if (false)',
    // The sequence fuzz found the second case, 2026-10-07: a call that runs at once took the key.
    kills: [
      `${A}/approvals/approvals.test.ts > re-asking with the same request_id after expiry makes a new request; a retry then replays`,
      `${A}/approvals/approvals.test.ts > a request_id that names a waiting request cannot name a call that runs alone`,
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
      `${callbacks} > an approver whose roleOf returns undefined`,
      `${callbacks} > an approver whose roleOf returns 'ALLOW'`,
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
    id: 'C1-follow-up-outlives-run',
    guards: 'C1',
    file: 'packages/functions/src/functions.ts',
    find: '!options.followUp && (run.status',
    replace: '(run.status',
    // Approved work's follow-ups finish when the in-app run ends first (Matthias, 2026-10-07).
    kills: [
      `${A}/approvals/approvals.test.ts > a follow-up of an in-app request runs after its run ends, not after the agent is turned off: 'run ended'`,
    ],
    projects: ['agents'],
  },
  {
    id: 'S9-in-app-ended-run',
    guards: 'C1',
    file: 'packages/functions/src/functions.ts',
    find: "(run.status === 'done' || run.status === 'failed')",
    replace: 'false',
    // The turn check refuses an ended run's step too, with another message. Approved work skips
    // that check, so only this guard stops it.
    kills: [
      `${inApp}: 'run done'`,
      `${inApp}: 'run failed'`,
      `${A}/approvals/approvals.test.ts > approving a request of an in-app run that has ended changes nothing: run done`,
      `${A}/approvals/approvals.test.ts > approving a request of an in-app run that has ended changes nothing: run failed`,
    ],
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
    find: '              actor: shown(who),',
    replace: '              actor: who,',
    kills: [
      `${A}/approvals/approvals.test.ts > work an approved request scheduled runs under the approval, for an hour`,
      `${callbacks} > internal action, follow-up of an approved request receives exactly these keys`,
    ],
    projects: ['agents'],
  },
  {
    id: 'C10-shown-operation',
    guards: 'C10',
    file: 'packages/functions/src/functions.ts',
    find: '        actor: shown(actor),\n      },',
    replace: '        actor,\n      },',
    kills: [
      `${A}/approvals/approvals.test.ts > work an approved request scheduled runs under the approval, for an hour`,
      `${callbacks} > mutation handler, agent acting under a person’s approval receives exactly these keys`,
      `${callbacks} > internal mutation, follow-up of an approved request receives exactly these keys`,
    ],
    projects: ['agents'],
  },
  // shown() itself, and the other callbacks (classes 2, 4, 10): packages/agents/test/callbacks.
  {
    id: 'C10-shown-approval-id',
    guards: 'C10',
    file: 'packages/functions/src/functions.ts',
    find: '    approvalId: _approval,\n',
    replace: '',
    kills: [
      `${callbacks} > mutation handler, agent acting under a person’s approval receives exactly these keys`,
      `${callbacks} > internal query run under a person’s approval receives exactly these keys`,
    ],
    projects: ['agents'],
  },
  // The release-gate review, 2026-10-07.
  {
    id: 'C4-public-read-true',
    guards: 'C4',
    file: 'packages/functions/src/rules.ts',
    find: 'rule.where(frozen(row) as never) === true',
    replace: 'rule.where(frozen(row) as never)',
    kills: [
      `${callbacks} > a publicRead condition that returns 1`,
      `${callbacks} > a publicRead condition that returns a Promise of undefined`,
    ],
    projects: ['agents'],
  },
  {
    id: 'S16-request-id-reserved',
    guards: 'S16',
    file: 'packages/agents/src/tools.ts',
    find: "if ('request_id' in op.args) {",
    replace: 'if (false) {',
    kills: [
      `${A}/door/door.test.ts > a tool argument named request_id fails at definition, for queries too`,
    ],
    projects: ['agents'],
  },
  {
    id: 'C9-session-expiry',
    guards: 'C9',
    file: 'src/runtime/convex-auth/test.ts',
    find: 'if (!own || own.expiresAt <= now) {',
    replace: 'if (!own) {',
    kills: [
      'test/convex/auth-component-limits.test.ts > auth component limits > signs in with a fresh session after the old one expired',
    ],
    projects: ['convex'],
  },
  {
    id: 'C9-session-pages',
    guards: 'C9',
    file: 'src/runtime/convex-auth/test.ts',
    find: 'done = result.isDone',
    replace: 'done = true',
    kills: [
      'test/convex/auth-component-limits.test.ts > auth component limits > shares one live session after more than 100 expired ones',
    ],
    projects: ['convex'],
  },
  {
    id: 'C9-fresh-consent',
    guards: 'C9',
    file: 'src/runtime/convex-auth/test.ts',
    find: '`${subject}-${clientId}-consent-${crypto.randomUUID()}`',
    replace: '`${subject}-${clientId}-consent`',
    kills: [
      'test/convex/auth-component-limits.test.ts > auth component limits > keeps a principal from before a revoke refused after grantMcp connects again',
    ],
    projects: ['convex'],
  },
  // The callback tables, 2026-10-07: four fixes, each with its row.
  {
    id: 'C4-custom-rule-true',
    guards: 'C4',
    file: 'packages/functions/src/rules.ts',
    find: "=== true ? 'ok' : 'hidden'",
    replace: "? 'ok' : 'hidden'",
    kills: [
      `${callbacks} > a custom rule that returns 'ALLOW'`,
      `${callbacks} > a custom rule in anyOf that returns 1`,
      `${callbacks} > a custom rule in allOf that returns {}`,
    ],
    projects: ['agents'],
  },
  {
    id: 'C4-agent-rule-null',
    guards: 'C4',
    file: 'packages/functions/src/policy.ts',
    find: "const rule = stated === undefined ? 'allow' : stated",
    replace: "const rule = stated ?? 'allow'",
    kills: [`${F}/policy.test.ts > an agent rule that is null asks a person`],
    projects: ['functions'],
  },
  {
    id: 'C10-rule-actor-shown',
    guards: 'C10',
    file: 'packages/functions/src/functions.ts',
    find: 'actor: shown(actor),\n      action: op.action,',
    replace: 'actor,\n      action: op.action,',
    kills: [
      `${callbacks} > custom row rule, actor of an agent acting under a person’s approval receives exactly these keys`,
      `${callbacks} > custom row rule, actor of a follow-up of an approved request receives exactly these keys`,
    ],
    projects: ['agents'],
  },
  {
    id: 'C2-rule-db',
    guards: 'C2',
    file: 'packages/functions/src/rules.ts',
    find: 'db: readerOf(raw),',
    replace: 'db: raw,',
    kills: [`${callbacks} > custom row rule, person at the web door receives exactly these keys`],
    projects: ['agents'],
  },
  {
    id: 'C2-role-of-reads',
    guards: 'C2',
    file: 'packages/functions/src/functions.ts',
    find: 'config.roleOf(readOnly(ctx), actor.user',
    replace: 'config.roleOf(ctx, actor.user',
    kills: [`${callbacks} > roleOf during a mutation receives exactly these keys`],
    projects: ['agents'],
  },
  {
    id: 'C10-shown-follow-up',
    guards: 'C10',
    file: 'packages/functions/src/functions.ts',
    find: '    followUp: _followUp,\n',
    replace: '',
    kills: [
      `${callbacks} > internal mutation, follow-up of an approved request receives exactly these keys`,
      `${callbacks} > internal action, follow-up of an approved request receives exactly these keys`,
    ],
    projects: ['agents'],
  },
  {
    id: 'C2-summary-db',
    guards: 'C2',
    file: 'packages/functions/src/rules.ts',
    find: 'db: db && readerOf(db),',
    replace: 'db,',
    // The plan reads through its own reader (planReader), which has only read methods.
    kills: [
      `${callbacks} > roleOf during a mutation receives exactly these keys`,
      `${callbacks} > user lookup during a mutation receives exactly these keys`,
    ],
    projects: ['agents'],
  },
  {
    id: 'C2-summary-scheduler',
    guards: 'C2',
    file: 'packages/functions/src/rules.ts',
    find: 'scheduler: _scheduler,',
    replace: '',
    kills: [`${callbacks} > approval summary, agent at the MCP door receives exactly these keys`],
    projects: ['agents'],
  },
  {
    id: 'C2-summary-run-query',
    guards: 'C2',
    file: 'packages/functions/src/rules.ts',
    find: 'const { runQuery: _query, db, ...rest } = readOnly(ctx)',
    replace: 'const { db, ...rest } = readOnly(ctx)',
    kills: [`${callbacks} > approval summary, agent at the MCP door receives exactly these keys`],
    projects: ['agents'],
  },

  {
    id: 'C4-agent-rule-decision',
    guards: 'C4',
    file: 'packages/functions/src/policy.ts',
    find: "return decisions.includes(decision) ? (decision as Decision) : 'approve'",
    replace: "return (decision ?? 'approve') as Decision",
    kills: [
      `${agentRule} returns no decision asks a person: 'ALLOW'`,
      `${agentRule} returns no decision asks a person: 'allow '`,
      `${agentRule} returns no decision asks a person: 1`,
      `${agentRule} returns no decision asks a person: {}`,
      `${agentRule} returns no decision asks a person: a Promise of undefined`,
      `${agentRule} is no decision asks a person: 'ALLOW'`,
    ],
    projects: ['functions'],
  },
  {
    id: 'C4-agent-rule-throws',
    guards: 'C4',
    file: 'packages/functions/src/policy.ts',
    find: "    } catch {\n      return 'approve'\n    }",
    replace: "    } catch {\n      return 'allow'\n    }",
    kills: [`${agentRule} throws asks a person`],
    projects: ['functions'],
  },
  {
    // A "lenient" role lookup that accepts one pattern for a list turns `owner: '*'` into a grant.
    id: 'C4-role-patterns-list',
    guards: 'C4',
    file: 'packages/functions/src/policy.ts',
    find: 'return matches(own(policy.roles as Record<string, readonly string[]>, role) ?? [], action)',
    replace:
      'return matches([own(policy.roles as Record<string, readonly string[]>, role) ?? []].flat(), action)',
    kills: [`${F}/policy.test.ts > a role whose patterns are '*' grants nothing: throws`],
    projects: ['functions'],
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
      sequences,
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
      sequences,
    ],
    projects: ['agents'],
  },
  // Guards the sequence fuzz kills: other work naming an approval, and a declined call again.
  {
    id: 'C1-follow-up-token',
    guards: 'C1',
    file: 'packages/functions/src/functions.ts',
    find: 'who.followUp === row.followUp)',
    replace: 'true)',
    // Forged tokens in the fuzz now also meet the plan's write limit; this test names the refusal.
    kills: [
      `${A}/approvals/approvals.test.ts > work an approved request scheduled runs under the approval, for an hour`,
    ],
    projects: ['agents'],
  },
  {
    id: 'C1-acting-as-requester',
    guards: 'C1',
    file: 'packages/functions/src/functions.ts',
    find: 'if (!row || row.requester.key !== actorRecord(actor).key || !standing) {',
    replace: 'if (!row || !standing) {',
    kills: [sequences],
    projects: ['agents'],
  },
  {
    id: 'C5-decline-replay',
    guards: 'C5',
    file: 'packages/agents/src/tools.ts',
    find: "if (declined) fail('APPROVAL_DECLINED', 'A person declined this request.')",
    replace: "if (false) fail('APPROVAL_DECLINED', 'A person declined this request.')",
    kills: [
      `${A}/approvals/approvals.test.ts > a retry after a decline is told it was declined`,
      `${A}/approvals/approvals.test.ts > a declined call is found among more than 20 declines`,
      sequences,
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
    find: '!path.startsWith(`${root}_generated/`) &&',
    replace: 'true &&',
    kills: [
      `${F}/no-bypass.test.ts > raw functions are found in any module, router routes included`,
    ],
    projects: ['functions'],
  },
  {
    // Convex skips only `_generated/` at the functions root; a nested one deploys.
    id: 'S1-unguarded-generated-root-only',
    guards: 'S1',
    file: 'packages/functions/src/guard.ts',
    find: '!path.startsWith(`${root}_generated/`)',
    replace: "!path.includes('_generated/')",
    kills: [
      `${F}/no-bypass.test.ts > raw functions are found in any module, router routes included`,
    ],
    projects: ['functions'],
  },
  {
    // The root is the shortest prefix before `_generated/`, not the first key that has one.
    id: 'S1-unguarded-root-shortest',
    guards: 'S1',
    file: 'packages/functions/src/guard.ts',
    find: '.sort((a, b) => a.length - b.length)[0]',
    replace: '[0]',
    kills: [
      `${F}/no-bypass.test.ts > raw functions are found in any module, router routes included`,
    ],
    projects: ['functions'],
  },
  {
    // Convex skips a directory with its own convex.config.ts (a local component).
    id: 'S1-unguarded-skip-components',
    guards: 'S1',
    file: 'packages/functions/src/guard.ts',
    find: '!components.some((dir) => path.startsWith(dir)) &&',
    replace: 'true &&',
    kills: [
      `${F}/no-bypass.test.ts > raw functions are found in any module, router routes included`,
    ],
    projects: ['functions'],
  },
  {
    // The root convex.config.ts is the app, not a component: skipping it would skip every module.
    id: 'S1-unguarded-root-config',
    guards: 'S1',
    file: 'packages/functions/src/guard.ts',
    find: '.filter((dir) => dir !== root)',
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
  // Package tests may import another package's public entry, and only that (check-boundaries).
  {
    id: 'boundary-test-import-public-entry',
    guards: 'boundaries',
    file: 'scripts/check-boundaries.mjs',
    find: 'Object.hasOwn(exports, subpath)',
    replace: 'true',
    kills: [
      'test/unit/convex-auth-boundaries.test.ts > workspace package dependency direction > lets a package test import another package’s public entry, and nothing else',
    ],
    projects: ['unit'],
  },
  {
    id: 'boundary-test-import-tests',
    guards: 'boundaries',
    file: 'scripts/check-boundaries.mjs',
    find: "inDir(edge.resolvedAbsPath, join(target.directory, 'test'))",
    replace: 'true',
    kills: [
      'test/unit/convex-auth-boundaries.test.ts > workspace package dependency direction > lets a package test import another package’s tests by path, and nothing else',
    ],
    projects: ['unit'],
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
    find: 'if (bytes > maximumMcpRequestBytes) {',
    replace: 'if (false) {',
    kills: [
      `${A}/mcp/transport.test.ts > MCP transport bounds > accepts the exact request limit and rejects declared or streamed overflow`,
    ],
    projects: ['agents'],
  },
  // Cloud smoke, 2026-10-07: Convex's edge answers 520 for a 413 sent while the client uploads.
  {
    id: 'S12-refused-upload-declared-drain',
    guards: 'S12',
    file: 'packages/agents/src/transport.ts',
    find: 'await discard(request.body.getReader(), signal)',
    replace: 'void 0',
    kills: [
      `${A}/mcp/transport.test.ts > MCP transport bounds > reads a refused upload to its end only up to 4 MiB: 'declared, 1 MiB'`,
    ],
    projects: ['agents'],
  },
  {
    id: 'S12-refused-upload-streamed-drain',
    guards: 'S12',
    file: 'packages/agents/src/transport.ts',
    find: 'if (failureStatus === 413) await discard(reader, signal)',
    replace: 'if (false) await discard(reader, signal)',
    kills: [
      `${A}/mcp/transport.test.ts > MCP transport bounds > reads a refused upload to its end only up to 4 MiB: 'streamed, 1 MiB'`,
    ],
    projects: ['agents'],
  },
  {
    id: 'S12-refused-upload-cap',
    guards: 'S12',
    file: 'packages/agents/src/transport.ts',
    find: 'while (total <= maximumMcpRefusedUploadBytes && ',
    replace: 'while (',
    kills: [
      `${A}/mcp/transport.test.ts > MCP transport bounds > reads a refused upload to its end only up to 4 MiB: 'streamed, 5 MiB'`,
    ],
    projects: ['agents'],
  },
  {
    id: 'S12-refused-upload-declared-cap',
    guards: 'S12',
    file: 'packages/agents/src/transport.ts',
    find: ' && bytes <= maximumMcpRefusedUploadBytes',
    replace: '',
    kills: [
      `${A}/mcp/transport.test.ts > MCP transport bounds > reads a refused upload to its end only up to 4 MiB: 'declared, 5 MiB'`,
    ],
    projects: ['agents'],
  },
  {
    // Kept on purpose (open question 2): most hosts still speak the 2025 era.
    id: 'mcp-legacy-to-modern-transport',
    guards: 'transport',
    file: 'packages/agents/src/handler.ts',
    find: 'if (await isServedLegacyRequest(boundedRequest)) {',
    replace: 'if (false) {',
    kills: [
      `${A}/mcp/header-contract.test.ts > a 2025-era request without the 2026 headers > is served statelessly as JSON, initialize and tools/call alike`,
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
  // The starter's own configuration: each break keeps every package test green and must fail a
  // starter test (B4 in internal/functions-and-agents/testing-strategy.md).
  {
    id: 'starter-projects-unchecked',
    guards: 'S3',
    file: 'starters/mcp-oauth-agent/convex/functions.ts',
    find: "projects: tenant('organizationId'),",
    replace: "projects: { kind: 'unchecked' as const, reason: 'mutant' },",
    kills: [
      `${leaks} > a stranger: rename fails with NOT_FOUND`,
      `${leaks} > a stranger: archive_project fails with NOT_FOUND`,
      `${leaks} > a viewer: rename fails with FORBIDDEN`,
    ],
    projects: ['mcp'],
  },
  {
    id: 'starter-roleOf-owner',
    guards: 'S3',
    file: 'starters/mcp-oauth-agent/convex/functions.ts',
    find: "if (tenant.table !== 'organizations') return null",
    replace: "return 'owner'",
    kills: [
      `${leaks} > a stranger: search fails with NOT_FOUND`,
      `${leaks} > a stranger: archive_project fails with NOT_FOUND`,
      `${leaks} > a viewer: create fails with FORBIDDEN`,
      `${starter}/agents.test.ts > a member who approves gets APPROVAL_NOT_FOUND`,
    ],
    projects: ['mcp'],
  },
  {
    id: 'starter-roleOf-status',
    guards: 'S3',
    file: 'starters/mcp-oauth-agent/convex/functions.ts',
    find: "return membership?.status === 'active' ? membership.role : null",
    replace: 'return membership?.role ?? null',
    kills: [
      `${leaks} > a former member: search fails with NOT_FOUND`,
      `${leaks} > a former member: archive_project fails with NOT_FOUND`,
      `${starter}/agents.test.ts > a former admin who approves gets APPROVAL_NOT_FOUND`,
      `${starter}/authorization.test.ts > MCP starter authorization > denies the next call after the membership is removed`,
    ],
    projects: ['mcp'],
  },
  {
    id: 'starter-archive-approval',
    guards: 'S10',
    file: 'starters/mcp-oauth-agent/convex/policy.ts',
    find: "agents: { 'projects.archive': 'approve' },",
    replace: 'agents: {},',
    kills: [
      `${starter}/agents.test.ts > gives agents these tools, with these scopes and approvals`,
      `${starter}/authorization.test.ts > MCP starter authorization > runs a tool for a live grant and a current membership; archiving waits for a person`,
    ],
    projects: ['mcp'],
  },
  {
    id: 'starter-approvers-widened',
    guards: 'S18',
    file: 'starters/mcp-oauth-agent/convex/policy.ts',
    find: "approvers: { 'projects.archive': ['owner', 'admin'] },",
    replace: "approvers: { 'projects.archive': ['owner', 'admin', 'member', 'viewer'] },",
    kills: [
      `${starter}/agents.test.ts > a member who approves gets APPROVAL_NOT_FOUND`,
      `${starter}/agents.test.ts > a viewer who approves gets APPROVAL_NOT_FOUND`,
    ],
    projects: ['mcp'],
  },
  {
    id: 'starter-read-scope-archive',
    guards: 'S9',
    file: 'starters/mcp-oauth-agent/convex/policy.ts',
    find: "actions: ['organizations.list', 'projects.search'],",
    replace: "actions: ['organizations.list', 'projects.search', 'projects.archive'],",
    kills: [
      `${starter}/agents.test.ts > gives agents these tools, with these scopes and approvals`,
    ],
    projects: ['mcp'],
  },
  // The consumer apps' own configuration (test/fixtures/consumers, A6 in
  // internal/functions-and-agents/testing-strategy.md): each break keeps every package test
  // green and must fail a leak row or the journey of that app.
  {
    id: 'consumer-agency-role-any-agency',
    guards: 'S3',
    file: `${agency}/functions.ts`,
    find: ".withIndex('by_agency_user', (q) => q.eq('agencyId', agencyId).eq('userId', userId))\n    .unique()",
    replace: ".filter((q) => q.eq(q.field('userId'), userId))\n    .first()",
    kills: [
      `${agencyLeaks} > sam: clients.list fails with NOT_FOUND`,
      `${agencyLeaks} > sam: list_projects fails with NOT_FOUND`,
      `${agencyLeaks} > sam: acknowledge_findings fails with NOT_FOUND`,
    ],
    projects: ['mcp'],
  },
  {
    id: 'consumer-agency-client-any-client',
    guards: 'S3',
    file: `${agency}/functions.ts`,
    find: ".withIndex('by_client_user', (q) => q.eq('clientId', clientId).eq('userId', userId))\n    .unique()",
    replace: ".filter((q) => q.eq(q.field('userId'), userId))\n    .first()",
    kills: [
      `${agencyLeaks} > cara: projects.list fails with NOT_FOUND`,
      `${agencyLeaks} > cara: get_fix_brief fails with NOT_FOUND`,
    ],
    projects: ['mcp'],
  },
  {
    id: 'consumer-agency-findings-unchecked',
    guards: 'S3',
    file: `${agency}/functions.ts`,
    find: "findings: tenant('projectId'),",
    replace: "findings: { kind: 'unchecked' as const, reason: 'mutant' },",
    kills: [
      `${agencyLeaks} > sam: findings.acknowledge fails with NOT_FOUND`,
      `${agencyLeaks} > sam: acknowledge_findings fails with NOT_FOUND`,
    ],
    projects: ['mcp'],
  },
  {
    id: 'consumer-agency-approvers',
    guards: 'S18',
    file: `${agency}/policy.ts`,
    find: "approvers: { 'findings.acknowledge': ['owner'] },",
    replace: 'approvers: {},',
    kills: [
      `${agency}/agency.test.ts > a client reads the brief; a staff agent's acknowledge waits for the agency owner`,
    ],
    projects: ['mcp'],
  },
  {
    id: 'consumer-content-pages-tenant',
    guards: 'S3',
    file: `${content}/functions.ts`,
    find: "      allOf(\n        tenant('siteId'),",
    replace: '      allOf(\n        custom(() => true),',
    kills: [
      `${contentLeaks} > B's pages under A: pages.read fails with NOT_FOUND`,
      `${contentLeaks} > B's pages under A: pages.edit fails with NOT_FOUND`,
      `${contentLeaks} > B's pages under A: read_page fails with NOT_FOUND`,
      `${contentLeaks} > B's pages under A: edit_page fails with NOT_FOUND`,
    ],
    projects: ['mcp'],
  },
  {
    id: 'consumer-content-approval-site',
    guards: 'S18',
    file: `${content}/pages.ts`,
    find: 'if (current?.siteId !== siteId) fail(',
    replace: 'if (!current) fail(',
    kills: [`${contentLeaks} > B's pages under A: edit_live_page fails with NOT_FOUND`],
    projects: ['mcp'],
  },
  {
    id: 'consumer-content-live-approval',
    guards: 'S10',
    file: `${content}/policy.ts`,
    find: "agents: { 'pages.editLive': 'approve' },",
    replace: 'agents: {},',
    kills: [
      `${content}/content.test.ts > an agent edits a draft at once; its edit of the live page waits for the owner's yes`,
    ],
    projects: ['mcp'],
  },
  {
    id: 'consumer-marketplace-party-side',
    guards: 'S3',
    file: `${marketplace}/functions.ts`,
    find: 'writes.includes(ctx.action) && ctx.tenant?.id === order[side]',
    replace: 'writes.includes(ctx.action)',
    kills: [
      `${marketplaceLeaks} > Duo shipping for the buyer: orders.ship fails with FORBIDDEN`,
      `${marketplaceLeaks} > Duo shipping for the buyer: ship_order fails with FORBIDDEN`,
    ],
    projects: ['mcp'],
  },
  {
    id: 'consumer-marketplace-party-allows',
    guards: 'S3',
    file: `${marketplace}/functions.ts`,
    find: " &&\n      ctx.allows({ table: 'orgs', id: order[side] }),",
    replace: ',',
    kills: [
      `${marketplaceLeaks} > Rival's rows under Acme: orders.cancel fails with NOT_FOUND`,
      `${marketplaceLeaks} > Bazaar's order under Shop: ship_order fails with NOT_FOUND`,
    ],
    projects: ['mcp'],
  },
  {
    id: 'consumer-marketplace-drafts-public',
    guards: 'S3',
    file: `${marketplace}/functions.ts`,
    find: "publicRead((listing: Doc<'listings'>) => listing.active)",
    replace: 'publicRead(() => true)',
    kills: [
      `${marketplaceLeaks} > Rival's rows under Acme: orders.place fails with NOT_FOUND`,
      `${marketplaceLeaks} > Rival's rows under Acme: place_order fails with NOT_FOUND`,
    ],
    projects: ['mcp'],
  },
  {
    id: 'consumer-sites-unchecked',
    guards: 'S3',
    file: `${sites}/functions.ts`,
    find: "sites: tenant('organizationId'),",
    replace: "sites: { kind: 'unchecked' as const, reason: 'mutant' },",
    kills: [
      `${sitesLeaks} > listChecks at the canary site fails with NOT_FOUND`,
      `${sitesLeaks} > trigger_site_check at the canary site fails with NOT_FOUND`,
      `${sitesLeaks} > list_site_checks at the canary site fails with NOT_FOUND`,
    ],
    projects: ['mcp'],
  },
  {
    id: 'consumer-sites-check-approval',
    guards: 'S10',
    file: `${sites}/policy.ts`,
    find: "agents: { 'sites.check': 'approve' },",
    replace: 'agents: {},',
    kills: [`${sites}/sites.test.ts > an agent's check waits for approval, then the job runs it`],
    projects: ['mcp'],
  },
  // The approval link page every app copies. The journey runs the starter with `nuxt dev` on the
  // local backend, as `pnpm test:integration` does, so each of these rows takes minutes.
  {
    id: 'approval-page-approve-calls-decline',
    guards: 'approval-page',
    file: 'starters/mcp-oauth-agent/app/pages/approvals/[id].vue',
    find: 'const approve = useConvexMutation(api.agents.approve)',
    replace: 'const approve = useConvexMutation(api.agents.decline)',
    kills: [journey],
    projects: ['integration'],
  },
  {
    id: 'approval-page-decline-calls-approve',
    guards: 'approval-page',
    file: 'starters/mcp-oauth-agent/app/pages/approvals/[id].vue',
    find: 'const decline = useConvexMutation(api.agents.decline)',
    replace: 'const decline = useConvexMutation(api.agents.approve)',
    kills: [journey],
    projects: ['integration'],
  },
  {
    id: 'approval-page-sign-in-link-loses-return',
    guards: 'approval-page',
    file: 'starters/mcp-oauth-agent/app/pages/approvals/[id].vue',
    find: 'encodeURIComponent(route.fullPath)',
    replace: "encodeURIComponent('/')",
    kills: [journey],
    projects: ['integration'],
  },
  {
    id: 'starter-sign-in-ignores-return',
    guards: 'approval-page',
    file: 'starters/mcp-oauth-agent/app/pages/index.vue',
    find: 'else if (returnTo.value) await navigateTo(returnTo.value)',
    replace: 'else if (false) await navigateTo(returnTo.value)',
    kills: [journey],
    projects: ['integration'],
  },
  // Housekeeping reads a bounded amount per transaction, so old data cannot fail it forever.
  {
    id: 'P-housekeeping-bounded-cleanup',
    guards: 'housekeeping',
    file: 'packages/agents/src/budget.ts',
    find: 'export const sweep = { rows: 100, bytes: 4 * 1024 * 1024 }',
    replace: 'const sweep = { rows: 1_000_000, bytes: 2 ** 40 }',
    kills: [
      `${A}/approvals/approvals.test.ts > housekeeping ends a stalled run in its first call, then works through 'a long finished conversation'`,
      `${A}/approvals/approvals.test.ts > housekeeping ends a stalled run in its first call, then works through 'many decided requests with large plans'`,
      `${A}/approvals/approvals.test.ts > housekeeping ends a stalled run in its first call, then works through 'a request that created 17,000 rows'`,
    ],
    projects: ['agents'],
  },
  // A finished run cancels its own requests, not the first 500 of its agent.
  {
    id: 'P-housekeeping-run-requests',
    guards: 'housekeeping',
    file: 'packages/agents/src/runs.ts',
    find: 'return await cancelOpen(db, run._id, budget)',
    replace:
      "await cancelRequests(db, 'app:' + run.userId + ':' + run.agent, (row) => row.caller.door === 'app' && row.caller.runId === run._id); return true",
    kills: [
      `${A}/approvals/approvals.test.ts > a finished run cancels its own open request behind other runs' requests`,
    ],
    projects: ['agents'],
  },
  // A step may run 30 minutes in Convex's runtime before it counts as stalled.
  {
    id: 'P-housekeeping-stall-threshold',
    guards: 'housekeeping',
    file: 'packages/agents/src/runs.ts',
    find: 'export const stallAfter = 35 * 60_000',
    replace: 'export const stallAfter = 15 * 60_000',
    kills: [`${A}/approvals/approvals.test.ts > a step that works for 31 minutes has not stalled`],
    projects: ['agents'],
  },
  {
    // D1: a request_id of another type was dropped, so a retry ran the write again.
    id: 'P-agents-small-request-id-type',
    guards: 'D1',
    file: 'packages/agents/src/tools.ts',
    find: "fail('INVALID_INPUT', 'request_id must be a string or number. Fix it, or leave it out.')",
    replace: 'void 0',
    kills: [`${A}/door/door.test.ts > request_id {"a":1} is refused, not dropped`],
    projects: ['agents'],
  },
  {
    // D2: an app tool in no scope was listed for every grant.
    id: 'P-agents-small-unscoped-tool',
    guards: 'D2',
    file: 'packages/agents/src/tools.ts',
    find: 'if (scopes.length === 0) {',
    replace: 'if (false) {',
    kills: [`${A}/door/door.test.ts > a tool whose action is in no scope fails at definition`],
    projects: ['agents'],
  },
  {
    // C3: a plan that copies large rows made the stored request exceed Convex's document limit.
    id: 'P-agents-small-approval-size',
    guards: 'C3',
    file: 'packages/agents/src/tools.ts',
    find: 'if (getConvexSize(approval as unknown as Value) > maxApprovalBytes) {',
    replace: 'if (false) {',
    kills: [
      `${A}/approvals/approvals.test.ts > a plan too large to store fails as TOO_LARGE and stores nothing`,
    ],
    projects: ['agents'],
  },
  {
    // C4: a committed write with a large result got HTTP 502 on its first response.
    id: 'P-agents-small-first-result-size',
    guards: 'C4',
    file: 'packages/agents/src/door.ts',
    find: 'bytes <= maximumMcpResponseBytes - 16 * 1024',
    replace: 'true',
    kills: [
      `${A}/door/door.test.ts > a large first result is cut short like a replay, not refused`,
    ],
    projects: ['agents'],
  },
  // The cloud smoke deploys operator-only test functions; a production key must never reach it.
  {
    id: 'live-refuses-production-key',
    guards: 'live',
    file: 'test/live/target.ts',
    find: "if (!deployKey.startsWith('preview:')) {",
    replace: 'if (false) {',
    kills: [
      'test/unit/live-target.test.ts > the live smoke target > refuses the deploy key prod:happy-animal-123|secret, and never prints its secret',
    ],
    projects: ['unit'],
  },
  // Release polish, rules group (2026-10-08).
  {
    id: 'P-rules-allof-empty',
    guards: 'C4',
    file: 'packages/functions/src/rules.ts',
    find: "rules: atLeastOne('allOf', rules)",
    replace: 'rules',
    kills: [`${F}/rules.test.ts > allOf() without rules fails at definition`],
    projects: ['functions'],
  },
  {
    id: 'P-rules-anyof-empty',
    guards: 'C4',
    file: 'packages/functions/src/rules.ts',
    find: "rules: atLeastOne('anyOf', rules)",
    replace: 'rules',
    kills: [`${F}/rules.test.ts > anyOf() without rules fails at definition`],
    projects: ['functions'],
  },
  {
    id: 'P-rules-internal-query-action',
    guards: 'C12',
    file: 'packages/functions/src/functions.ts',
    find: '  >(spec: InternalSpec<QueryCtx, A, Args, Returns>) {\n    assertAction(spec)\n',
    replace: '  >(spec: InternalSpec<QueryCtx, A, Args, Returns>) {\n',
    kills: [
      `${F}/rules.test.ts > internalQuery with action undefined fails at definition`,
      `${F}/rules.test.ts > internalQuery with action "projects.reed" fails at definition`,
    ],
    projects: ['functions'],
  },
  {
    id: 'P-rules-internal-mutation-action',
    guards: 'C12',
    file: 'packages/functions/src/functions.ts',
    find: '  >(spec: InternalSpec<MutationCtx, A, Args, Returns>) {\n    assertAction(spec)\n',
    replace: '  >(spec: InternalSpec<MutationCtx, A, Args, Returns>) {\n',
    kills: [
      `${F}/rules.test.ts > internalMutation with action undefined fails at definition`,
      `${F}/rules.test.ts > internalMutation with action "projects.archve" fails at definition`,
    ],
    projects: ['functions'],
  },
  {
    id: 'P-rules-custom-row-copy',
    guards: 'C3',
    file: 'packages/functions/src/rules.ts',
    find: 'rule.check(ctx, frozen(row))',
    replace: 'rule.check(ctx, row)',
    kills: [`${F}/rules.test.ts > a rule cannot change the stored row that later checks read`],
    projects: ['functions'],
  },
  {
    id: 'P-rules-union-member',
    guards: 'tenant-discovery',
    file: 'packages/functions/src/functions.ts',
    find: 'if (matches(member, value, isId)) await visit(member, value, true)',
    replace: 'await visit(member, value, true)',
    kills: [`${F}/rules.test.ts > only the union member the value is names a tenant`],
    projects: ['functions'],
  },
  {
    id: 'P-rules-error-code-list',
    guards: 'C4',
    file: 'packages/functions/src/actor.ts',
    find: '!isErrorCode(data.code)',
    replace: "typeof data.code !== 'string'",
    kills: [
      `${A}/door/door.test.ts > a tool error with data {"code":"UPSTREAM_INTERNAL","message":"private-api-key"} reaches the agent as {"code":"FAILED","message":"The tool failed. Try again later."}`,
      `${A}/door/door.test.ts > a tool error with data {"code":"toString","message":"x"} reaches the agent as {"code":"FAILED","message":"The tool failed. Try again later."}`,
    ],
    projects: ['agents'],
  },
  // A sliding renewal of the presented session still gets a Convex token.
  {
    id: 'P-session-renewed-session-token',
    guards: 'session',
    file: 'src/runtime/convex-auth/plugin.ts',
    find: 'if (!authenticated) unauthorized()',
    replace: 'if (!authenticated || ctx.context.newSession) unauthorized()',
    kills: [
      'test/security/convex-auth-internal-session.test.ts > internal Better Auth session bridge > signs a token while Better Auth renews the presented session',
    ],
    projects: ['security'],
  },
  // The renewal cookie of a server token exchange reaches the browser.
  {
    id: 'P-session-ssr-renewal-cookie',
    guards: 'session',
    file: 'src/runtime/server/utils/auth-snapshot.ts',
    find: 'renewsRequestSession: true,',
    replace: 'renewsRequestSession: false,',
    kills: [
      'test/security/convex-auth-internal-session.test.ts > server session renewal > carries the renewal cookie of a server token exchange to the browser',
    ],
    projects: ['security'],
  },
  // An unusable refreshed token signs the browser out instead of reusing the old one.
  {
    id: 'P-session-unusable-token-definitive',
    guards: 'session',
    file: 'src/runtime/auth/token-fetcher.ts',
    find: "authError: 'Convex authentication token is expired or missing a valid expiry',\n            definitive: true,",
    replace:
      "authError: 'Convex authentication token is expired or missing a valid expiry',\n            definitive: false,",
    kills: [
      'test/unit/better-auth-browser-adapter.test.ts > Better Auth browser adapter > drops the cached token when every refresh returns an unusable (malformed) token',
      'test/unit/better-auth-browser-adapter.test.ts > Better Auth browser adapter > drops the cached token when every refresh returns an unusable (expired) token',
    ],
    projects: ['unit'],
  },
  // Housekeeping's first transaction ends stalled runs within its read budget, cancelling their requests included.
  {
    id: 'P-r2-housekeeping-repair-budget',
    guards: 'housekeeping',
    file: 'packages/agents/src/tools.ts',
    find: "if (!(await finish(db, run, { status: 'failed', error }, budget))) left.push(run._id)",
    replace: "if (!(await finish(db, run, { status: 'failed', error }))) left.push(run._id)",
    kills: [
      `${A}/approvals/approvals.test.ts > housekeeping ends a stalled run in its first call, then works through '20 stalled runs, 900 KB requests'`,
      `${A}/approvals/approvals.test.ts > housekeeping ends a stalled run in its first call, then works through 'a stalled run, 20 900 KB requests'`,
    ],
    projects: ['agents'],
  },
  // Expiring requests stops when the budget is spent and continues in a new transaction.
  {
    id: 'P-r2-housekeeping-expire-budget',
    guards: 'housekeeping',
    file: 'packages/agents/src/tools.ts',
    find: 'while (more && !budget.spent) {',
    replace: 'while (more) {',
    kills: [
      `${A}/approvals/approvals.test.ts > housekeeping ends a stalled run in its first call, then works through '20 waiting runs, expired 900 KB'`,
    ],
    projects: ['agents'],
  },
  // Waking a waiting run reads its requests within the budget.
  {
    id: 'P-r2-housekeeping-wake-budget',
    guards: 'housekeeping',
    file: 'packages/agents/src/tools.ts',
    find: 'if (!(await wake(db, scheduler, runs[0]!, budget, known))) break',
    replace: 'if (!(await wake(db, scheduler, runs[0]!))) break',
    kills: [
      `${A}/approvals/approvals.test.ts > housekeeping ends a stalled run in its first call, then works through 'a waiting run, 20 decided 900 KB'`,
    ],
    projects: ['agents'],
  },
  // A run with more requests than one budget holds still goes on: the requests found decided carry over.
  {
    id: 'P-r2-housekeeping-wake-progress',
    guards: 'housekeeping',
    file: 'packages/agents/src/tools.ts',
    find: 'await next({ runs, decided: [...known], cutoff, ...after })',
    replace: 'await next({ runs, decided: [], cutoff, ...after })',
    kills: [
      `${A}/approvals/approvals.test.ts > housekeeping ends a stalled run in its first call, then works through 'a waiting run, 20 decided 900 KB'`,
    ],
    projects: ['agents'],
  },
]

export const equivalents: Equivalent[] = [
  {
    id: 'S14-live-grant-id',
    file: 'src/runtime/convex-auth/mcp-principal.ts',
    find: 'if (!grant || grant.grantId !== principal.grantId) throw accessDenied()',
    replace: 'if (!grant) throw accessDenied()',
    reason:
      'queryOAuthLiveGrant returns null unless the consent ID equals principal.grantId, and returns that ID: the second check is defence in depth.',
  },
]

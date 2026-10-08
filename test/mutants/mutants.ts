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
    find: "await assertWritable(table, next, 'write')\n      await assertParent(table, row, next)\n      wrote(id)\n      call.written?.(id)\n      return (raw.patch",
    replace:
      'await assertParent(table, row, next)\n      wrote(id)\n      call.written?.(id)\n      return (raw.patch',
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
    find: '      isComponent(ref)\n        ? args\n        : {',
    replace: '      true\n        ? args\n        : {',
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
    find: 'if (wait !== null) {',
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
    find: "  for (const row of open) if (which(row)) await db.patch(row._id, { status: 'cancelled' })",
    replace:
      "  for (const row of open) if (false) await db.patch(row._id, { status: 'cancelled' })",
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
    replace: 'export const sweep = { rows: 1_000_000, bytes: 2 ** 40 }',
    kills: [
      `${A}/approvals/approvals.test.ts > housekeeping commits from its first call, then works through 'a long finished conversation'`,
      `${A}/approvals/approvals.test.ts > housekeeping commits from its first call, then works through 'many decided requests with large plans'`,
      `${A}/approvals/approvals.test.ts > housekeeping commits from its first call, then works through 'a request that created 17,000 rows'`,
    ],
    projects: ['agents'],
  },
  // A finished run cancels its own requests, not the first 500 of its agent.
  {
    id: 'P-housekeeping-run-requests',
    guards: 'housekeeping',
    file: 'packages/agents/src/runs.ts',
    find: 'if (!(await cancelOpen(db, run._id, budget))) return false',
    replace:
      "await cancelRequests(db, 'app:' + run.userId + ':' + run.agent, (row) => row.caller.door === 'app' && row.caller.runId === run._id)",
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
  // A request that nearly fills 1 MiB still stores its approved result, as a marker if needed.
  {
    id: 'P-r2-approval-result-room',
    guards: 'r2-approval',
    file: 'packages/agents/src/tools.ts',
    find: 'storable(ran.output.result, Math.min(64 * 1024, room))',
    replace: 'storable(ran.output.result)',
    kills: [
      `${A}/approvals/approvals.test.ts > a request that nearly fills the size limit stores a marker for a result that no longer fits`,
    ],
    projects: ['agents'],
  },
  // A storage ID in a union is checked with the system-table lookup, which does not throw.
  {
    id: 'P-r2-small-system-id',
    guards: 'r2-small',
    file: 'packages/functions/src/values.ts',
    find: "const normalize = table.startsWith('_') ? db.system : db",
    replace: 'const normalize = db',
    kills: [
      `${F}/rules.test.ts > a union that holds a storage ID works with an ID and with null`,
      `${A}/door/door.test.ts > a tool with a nullable storage ID argument accepts an ID and null`,
    ],
    projects: ['functions', 'agents'],
  },
  // A bigint or non-finite float literal member matches its own value.
  {
    id: 'P-r2-small-literal',
    guards: 'r2-small',
    file: 'packages/functions/src/values.ts',
    find: 'return sameLiteral(value, json.value)',
    replace: 'return value === json.value',
    kills: [
      `${F}/values.test.ts > literal 1n matches 1n`,
      `${F}/values.test.ts > literal Infinity matches Infinity`,
    ],
    projects: ['functions'],
  },
  // The response size counts the text escaped a second time, with a small envelope allowance.
  {
    id: 'P-r2-small-response-size',
    guards: 'r2-small',
    file: 'packages/agents/src/door.ts',
    find: 'return new TextEncoder().encode(JSON.stringify(message)).byteLength',
    replace: 'return 2 * new TextEncoder().encode(text).byteLength + 16 * 1024',
    kills: [
      `${A}/door/door.test.ts > a result of quote-heavy text gets a marker or arrives whole, never HTTP 502`,
      `${A}/door/door.test.ts > a result of 520,000 characters of text gets a marker or arrives whole, never HTTP 502`,
    ],
    projects: ['agents'],
  },
  // A cursor refused as a Convex system error is named like a plain error.
  {
    id: 'P-r2-small-cursor-system-error',
    guards: 'r2-small',
    file: 'packages/agents/src/tools.ts',
    find: 'hasCursor && isCursorFailure(error)',
    replace: 'hasCursor && (error as { data?: unknown } | null)?.data === undefined',
    kills: [
      `${A}/door/door.test.ts > an invalid cursor reported as a ConvexError system error is named`,
    ],
    projects: ['agents'],
  },
  // Housekeeping's first transaction ends stalled runs within its read budget, cancelling their requests included.
  {
    id: 'P-r2-housekeeping-repair-budget',
    guards: 'housekeeping',
    file: 'packages/agents/src/tools.ts',
    find: "return await finish(db, run, { status: 'failed', error: shown.error! }, budget)",
    replace: "return await finish(db, run, { status: 'failed', error: shown.error! })",
    kills: [
      `${A}/approvals/approvals.test.ts > housekeeping commits from its first call, then works through '20 stalled runs, 900 KB requests'`,
      `${A}/approvals/approvals.test.ts > housekeeping commits from its first call, then works through 'a stalled run, 20 900 KB requests'`,
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
      `${A}/approvals/approvals.test.ts > housekeeping commits from its first call, then works through '20 waiting runs, expired 900 KB'`,
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
      `${A}/approvals/approvals.test.ts > housekeeping commits from its first call, then works through 'a waiting run, 20 decided 900 KB'`,
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
      `${A}/approvals/approvals.test.ts > housekeeping commits from its first call, then works through 'a waiting run, 20 decided 900 KB'`,
    ],
    projects: ['agents'],
  },
  // Release polish round 3, r3-lifecycle group (2026-10-08).
  // An agent's 20 open requests, at the largest size stored, fit one transaction's reads.
  {
    id: 'P-r3-lifecycle-approval-size',
    guards: 'r3-lifecycle',
    file: 'packages/agents/src/tools.ts',
    find: 'const maxApprovalBytes = 256 * 1024',
    replace: 'const maxApprovalBytes = 1024 * 1024 - 8 * 1024',
    kills: [
      `${A}/approvals/approvals.test.ts > a run's 20 requests of the largest size stay within Convex's read limit: wait`,
      `${A}/approvals/approvals.test.ts > a run's 20 requests of the largest size stay within Convex's read limit: decide`,
      `${A}/approvals/approvals.test.ts > a run's 20 requests of the largest size stay within Convex's read limit: finish`,
    ],
    projects: ['agents'],
  },
  // A run waits only on its own open requests, so waking it reads at most 20.
  {
    id: 'P-r3-lifecycle-wait-open',
    guards: 'r3-lifecycle',
    file: 'packages/agents/src/runs.ts',
    find: 'const open = (await openOf(db, run._id).take(100)).filter((row) => asked.has(row._id))',
    replace:
      "const open = (await Promise.all(approvalIds.map((id) => db.get(id)))).filter((row) => row !== null && row.status === 'pending' && row.expiresAt > Date.now()) as never[]",
    kills: [
      `${A}/approvals/approvals.test.ts > a run waits only on its own requests that are still open`,
    ],
    projects: ['agents'],
  },
  // The scan of waiting runs reads a page within bytes, not only within a count of runs.
  {
    id: 'P-r3-lifecycle-scan-bytes',
    guards: 'r3-lifecycle',
    file: 'packages/agents/src/tools.ts',
    find: '.paginate({ numItems: sweep.rows / 2, cursor, maximumBytesRead: sweep.bytes / 2 })',
    replace: '.paginate({ numItems: sweep.rows / 2, cursor })',
    kills: [
      `${A}/approvals/approvals.test.ts > housekeeping wakes every waiting run, however large their tasks`,
    ],
    projects: ['agents'],
  },
  // Expiring a run's requests wakes the run once per step, not once per request.
  {
    id: 'P-r3-lifecycle-expire-once',
    guards: 'r3-lifecycle',
    file: 'packages/agents/src/tools.ts',
    find: "if (row.caller.door === 'app' && !woken.has(row.caller.runId)) {",
    replace: "if (row.caller.door === 'app') {",
    kills: [
      `${A}/approvals/approvals.test.ts > housekeeping expires a run's requests and wakes the run once, in one step`,
    ],
    projects: ['agents'],
  },
  // A run ends only after its open requests are cancelled, so no request of an ended run stays open.
  {
    id: 'P-r3-lifecycle-cancel-first',
    guards: 'r3-lifecycle',
    file: 'packages/agents/src/runs.ts',
    find: 'if (!(await cancelOpen(db, run._id, budget))) return false',
    replace:
      'await db.patch(run._id, { ...outcome, approvalIds: undefined, stepAt: Date.now() }); if (!(await cancelOpen(db, run._id, budget))) return false',
    kills: [
      `${A}/approvals/approvals.test.ts > housekeeping cancels a stalled run's requests before it ends the run`,
    ],
    projects: ['agents'],
  },
  // Disconnecting reads only the open requests, which the cap of 20 bounds; housekeeping expires the rest.
  {
    id: 'P-r3-lifecycle-disconnect-open',
    guards: 'r3-lifecycle',
    file: 'packages/agents/src/runs.ts',
    find: "q.eq('requester.key', requesterKey).eq('status', 'pending').gt('expiresAt', Date.now()),",
    replace: "q.eq('requester.key', requesterKey).eq('status', 'pending'),",
    kills: [
      `${A}/approvals/approvals.test.ts > disconnecting cancels the open requests, however many expired ones wait for housekeeping`,
    ],
    projects: ['agents'],
  },
  // The size check counts the request id as sent, not a fixed allowance.
  {
    id: 'P-r3-door-id-bytes',
    guards: 'door response size',
    file: 'packages/agents/src/door.ts',
    find: "const message = { jsonrpc: '2.0', id: envelope.id, result }",
    replace: "const message = { jsonrpc: '2.0', id: 1, result }",
    kills: [
      `${A}/door/door.test.ts > the largest result that fits is sent whole (2025, string id of 1,000 characters)`,
    ],
    projects: ['agents'],
  },
  // The 2026 era adds `resultType` and the server identity; the check counts them.
  {
    id: 'P-r3-door-modern-bytes',
    guards: 'door response size',
    file: 'packages/agents/src/door.ts',
    find: '...(envelope.modern && {',
    replace: '...(false && {',
    kills: [`${A}/door/door.test.ts > the largest result that fits is sent whole (2026)`],
    projects: ['agents'],
  },
  // A failure message is cut to a fixed ceiling.
  {
    id: 'P-r3-approve-error-ceiling',
    guards: 'approve failure size',
    file: 'packages/agents/src/tools.ts',
    find: 'if (message.length > maxErrorMessageChars) message = cut(maxErrorMessageChars)',
    replace: 'if (false) message = cut(maxErrorMessageChars)',
    kills: [
      `${A}/approvals/approvals.test.ts > a failure with a small request and a 200,000-character message is stored with a bounded message`,
    ],
    projects: ['agents'],
  },
  // ...and to the room the decided request leaves.
  {
    id: 'P-r3-approve-error-room',
    guards: 'approve failure size',
    file: 'packages/agents/src/tools.ts',
    find: 'while (message.length > 1 && getConvexSize(message) > roomBytes) {',
    replace: 'while (false) {',
    kills: [
      `${A}/approvals/approvals.test.ts > a failure with a request that leaves little room and a 40,000-character message is stored with a bounded message`,
    ],
    projects: ['agents'],
  },
  // The approval list reads within one budget, so many large requests cannot fail it.
  {
    id: 'P-r3-approval-list-budget',
    guards: 'r3-lifecycle',
    file: 'packages/agents/src/tools.ts',
    find: 'const listBudget = readBudget()',
    replace: 'const listBudget = { count() {}, spent: false }',
    kills: [
      `${A}/approvals/approvals.test.ts > the approval list stays within the read limit when many large requests wait`,
    ],
    projects: ['agents'],
  },
  {
    id: 'S-A-take-token',
    guards: 'saas-a',
    file: 'packages/functions/src/functions.ts',
    find: 'await spend(ctx, actor, op.action, tenant, limit)',
    replace: 'void 0',
    kills: [
      `${F}/limits-audit.test.ts > a call over the limit fails with RATE_LIMITED and the seconds to wait`,
    ],
  },
  {
    id: 'S-A-bucket-empty',
    guards: 'saas-a',
    file: 'packages/functions/src/limits.ts',
    find: 'if (refilled < 1) return',
    replace: 'if (false) return',
    kills: [
      `${F}/limits-audit.test.ts > a call over the limit fails with RATE_LIMITED and the seconds to wait`,
    ],
  },
  {
    id: 'S-A-refill',
    guards: 'saas-a',
    file: 'packages/functions/src/limits.ts',
    find: 'row.tokens + (Math.max(0, now - row.at) / period) * limit.max',
    replace: 'row.tokens',
    kills: [`${F}/limits-audit.test.ts > tokens refill over time`],
  },
  {
    id: 'S-A-key-user',
    guards: 'saas-a',
    file: 'packages/functions/src/functions.ts',
    find: '`${actorRecord(actor).key}|limit:${action}`',
    replace: '`user|limit:${action}`',
    kills: [`${F}/limits-audit.test.ts > user, tenant and everyone limits keep separate buckets`],
  },
  {
    id: 'S-A-key-tenant',
    guards: 'saas-a',
    file: 'packages/functions/src/functions.ts',
    find: "limit.per === 'tenant' && tenant",
    replace: 'false',
    kills: [`${F}/limits-audit.test.ts > user, tenant and everyone limits keep separate buckets`],
  },
  {
    id: 'S-A-visitor-everyone',
    guards: 'saas-a',
    file: 'packages/functions/src/functions.ts',
    find: "actor.kind !== 'visitor' && limit.per !== 'everyone'",
    replace: "limit.per !== 'everyone'",
    kills: [`${F}/limits-audit.test.ts > a visitor on a public action uses the everyone bucket`],
  },
  {
    id: 'S-A-mutations-only',
    guards: 'saas-a',
    file: 'packages/functions/src/functions.ts',
    find: "op.kind === 'mutation' || op.writes ? limitOf",
    replace: "op.kind === 'none' || op.writes ? limitOf",
    kills: [
      `${F}/limits-audit.test.ts > a call over the limit fails with RATE_LIMITED and the seconds to wait`,
    ],
  },
  {
    id: 'S-A-query-limit-error',
    guards: 'saas-a',
    file: 'packages/functions/src/functions.ts',
    find: 'if (limitOf(policy, spec.action))\n      throw new Error(\n        `${spec.action} is limited',
    replace: 'if (false)\n      throw new Error(\n        `${spec.action} is limited',
    kills: [`${F}/limits-audit.test.ts > a query cannot use a limited action`],
  },
  {
    id: 'S-A-def-unknown-action',
    guards: 'saas-a',
    file: 'packages/functions/src/policy.ts',
    find: 'if (!actions.includes(action))',
    replace: 'if (false)',
    kills: [
      `${F}/limits-audit.test.ts > wrong limit or audit definitions fail when the policy is defined`,
    ],
  },
  {
    id: 'S-A-def-max',
    guards: 'saas-a',
    file: 'packages/functions/src/policy.ts',
    find: '!Number.isInteger(limit.max) || limit.max < 1',
    replace: 'false',
    kills: [
      `${F}/limits-audit.test.ts > wrong limit or audit definitions fail when the policy is defined`,
    ],
  },
  {
    id: 'S-A-def-every',
    guards: 'saas-a',
    file: 'packages/functions/src/policy.ts',
    find: '!Object.hasOwn(everyMs, limit.every)',
    replace: 'false',
    kills: [
      `${F}/limits-audit.test.ts > wrong limit or audit definitions fail when the policy is defined`,
    ],
  },
  {
    id: 'S-A-def-per',
    guards: 'saas-a',
    file: 'packages/functions/src/policy.ts',
    find: "limit.per !== undefined && !['user', 'tenant', 'everyone'].includes(limit.per)",
    replace: 'false',
    kills: [
      `${F}/limits-audit.test.ts > wrong limit or audit definitions fail when the policy is defined`,
    ],
  },
  {
    id: 'S-A-def-audit-pattern',
    guards: 'saas-a',
    file: 'packages/functions/src/policy.ts',
    find: '!actions.some((action) => matches([pattern], action))',
    replace: 'false',
    kills: [
      `${F}/limits-audit.test.ts > wrong limit or audit definitions fail when the policy is defined`,
    ],
  },
  {
    id: 'S-A-audit-written',
    guards: 'saas-a',
    file: 'packages/functions/src/functions.ts',
    find: 'if (!audits) return',
    replace: 'if (true) return',
    kills: [
      `${F}/limits-audit.test.ts > an audited mutation writes one row with actor, action, tenant and written ids`,
    ],
  },
  {
    id: 'S-A-audit-only-listed',
    guards: 'saas-a',
    file: 'packages/functions/src/functions.ts',
    find: '      isAudited(policy, op.action)\n    const nested',
    replace: '      true\n    const nested',
    kills: [`${F}/limits-audit.test.ts > unaudited writes and failed calls leave no audit row`],
  },
  {
    id: 'S-A-audit-cap',
    guards: 'saas-a',
    file: 'packages/functions/src/functions.ts',
    find: 'rows: ids.slice(0, auditRows),',
    replace: 'rows: ids,',
    kills: [`${F}/limits-audit.test.ts > an audit row holds at most 50 ids and counts the rest`],
  },
  {
    id: 'S-A-written-insert',
    guards: 'saas-a',
    file: 'packages/functions/src/rules.ts',
    find: 'call.written?.(String(id))',
    replace: '',
    kills: [
      `${F}/limits-audit.test.ts > the audit row lists every id the call inserted, replaced, patched or deleted`,
    ],
  },
  {
    id: 'S-A-written-patch',
    guards: 'saas-a',
    file: 'packages/functions/src/rules.ts',
    find: 'call.written?.(id)\n      return (raw.patch as',
    replace: 'return (raw.patch as',
    kills: [
      `${F}/limits-audit.test.ts > the audit row lists every id the call inserted, replaced, patched or deleted`,
    ],
  },
  {
    id: 'S-A-written-replace',
    guards: 'saas-a',
    file: 'packages/functions/src/rules.ts',
    find: 'call.written?.(id)\n      return (raw.replace as',
    replace: 'return (raw.replace as',
    kills: [
      `${F}/limits-audit.test.ts > the audit row lists every id the call inserted, replaced, patched or deleted`,
    ],
  },
  {
    id: 'S-A-written-delete',
    guards: 'saas-a',
    file: 'packages/functions/src/rules.ts',
    find: 'call.written?.(id)\n      return (raw.delete as',
    replace: 'return (raw.delete as',
    kills: [
      `${F}/limits-audit.test.ts > the audit row lists every id the call inserted, replaced, patched or deleted`,
    ],
  },
  {
    id: 'S-A-trail-order',
    guards: 'saas-a',
    file: 'packages/functions/src/functions.ts',
    find: ".order('desc')",
    replace: '',
    kills: [
      `${F}/limits-audit.test.ts > auditTrail returns a tenant newest first, a page at a time`,
    ],
  },
  {
    id: 'S-A-trail-tenant',
    guards: 'saas-a',
    file: 'packages/functions/src/functions.ts',
    find: ".withIndex('by_tenant', (q) => q.eq('tenantId', options.tenantId))",
    replace: ".withIndex('by_tenant')",
    kills: [
      `${F}/limits-audit.test.ts > auditTrail returns a tenant newest first, a page at a time`,
    ],
  },
  {
    id: 'S-A-agents-bucket-period',
    guards: 'saas-a',
    file: 'packages/agents/src/tools.ts',
    find: "{ max: perMinute, every: 'minute' }",
    replace: "{ max: perMinute, every: 'hour' }",
    kills: [`${A}/approvals/approvals.test.ts > an agent may make 60 writes a minute, then waits`],
    projects: ['agents'],
  },
  {
    id: 'S-A-agents-idle-buckets',
    guards: 'saas-a',
    file: 'packages/agents/src/tools.ts',
    find: "q.lt('at', now - day)",
    replace: "q.lt('at', 0)",
    kills: [
      `${A}/approvals/approvals.test.ts > housekeeping deletes rate-limit buckets idle for more than a day`,
    ],
    projects: ['agents'],
  },
  {
    id: 'S-A-audit-no-system',
    guards: 'saas-a',
    file: 'packages/functions/src/functions.ts',
    find: "(op.kind === 'mutation' || op.writes === true) &&\n      actor.kind !== 'system' &&",
    replace: "(op.kind === 'mutation' || op.writes === true) &&",
    kills: [`${F}/limits-audit.test.ts > a system job writes no audit row`],
  },
  {
    id: 'S-A-audit-nested-collect',
    guards: 'saas-a',
    file: 'packages/functions/src/functions.ts',
    find: 'collect: audits || op.nested ? (ids) => ids.forEach((id) => written.add(id)) : undefined,',
    replace: 'collect: audits || op.nested ? () => {} : undefined,',
    kills: [
      `${F}/limits-audit.test.ts > a public mutation that runs an internal operation writes one row with both calls ids`,
    ],
  },
  {
    id: 'S-F1-internal-limit',
    guards: 'saas-f1',
    file: 'packages/functions/src/functions.ts',
    find: "op.kind === 'mutation' || op.writes ? limitOf",
    replace: "op.kind === 'mutation' ? limitOf",
    kills: [
      `${F}/limits-audit.test.ts > an unlimited public mutation that runs a limited internal action is limited`,
      `${F}/limits-audit.test.ts > a scheduled internal mutation on a limited action is limited`,
    ],
  },
  {
    id: 'S-F1-spent-skip',
    guards: 'saas-f1',
    file: 'packages/functions/src/functions.ts',
    find: '      !spent.includes(op.action)\n',
    replace: '      true\n',
    kills: [
      `${F}/limits-audit.test.ts > a limited public mutation that runs the same limited internal action takes one token`,
    ],
  },
  {
    id: 'S-F1-spent-pass',
    guards: 'saas-f1',
    file: 'packages/functions/src/functions.ts',
    find: 'spent: limit ? [...spent, op.action] : spent,',
    replace: 'spent: [],',
    kills: [
      `${F}/limits-audit.test.ts > a limited public mutation that runs the same limited internal action takes one token`,
    ],
  },
  {
    id: 'S-F1-approved-free',
    guards: 'saas-f1',
    file: 'packages/functions/src/functions.ts',
    find: "decision === 'allow' &&\n      !(actor.kind === 'agent' && actor.approvalId !== undefined) &&",
    replace: "decision === 'allow' &&",
    kills: [
      `${A}/approvals/approvals.test.ts > an approved run takes no token, so an empty bucket does not fail it`,
    ],
    projects: ['agents'],
  },
  {
    id: 'S-F1-request-free',
    guards: 'saas-f1',
    file: 'packages/functions/src/functions.ts',
    find: "      decision === 'allow' &&\n      !(actor.kind",
    replace: "      decision !== 'deny' &&\n      !(actor.kind",
    kills: [
      `${A}/approvals/approvals.test.ts > an approved run takes no token, so an empty bucket does not fail it`,
    ],
    projects: ['agents'],
  },
  {
    id: 'S-F1-own-row',
    guards: 'saas-f1',
    file: 'packages/functions/src/functions.ts',
    find: 'collect: audits || op.nested ?',
    replace: 'collect: true ?',
    kills: [
      `${F}/limits-audit.test.ts > an audited internal mutation under an unaudited call writes its own row`,
    ],
  },
  {
    id: 'S-F1-one-row',
    guards: 'saas-f1',
    file: 'packages/functions/src/functions.ts',
    find: 'collect: audits || op.nested ?',
    replace: 'collect: undefined ?',
    kills: [
      `${F}/limits-audit.test.ts > a public mutation that runs an internal operation writes one row with both calls ids`,
    ],
  },
  {
    id: 'S-A-audit-nested-no-row',
    guards: 'saas-a',
    file: 'packages/functions/src/functions.ts',
    find: 'if (nested) return { operation: operationMark, result, written: [...written] }',
    replace: 'if (false) return { operation: operationMark, result, written: [...written] }',
    kills: [
      `${F}/limits-audit.test.ts > a public mutation that runs an internal operation writes one row with both calls ids`,
    ],
  },
  {
    id: 'S-A-audit-agent-door',
    guards: 'saas-a',
    file: 'packages/agents/src/tools.ts',
    find: 'await record()\n',
    replace: '',
    kills: [
      `${A}/approvals/approvals.test.ts > an agent write of an audited action appears in the audit log with the agent as actor`,
    ],
    projects: ['agents'],
  },
  {
    id: 'S-B-delete-user-default-off',
    guards: 'deleteUser stays off unless the app enables it',
    file: 'src/runtime/convex-auth/create-better-convex-auth.ts',
    find: 'user: options.deleteUser?.enabled',
    replace: 'user: true',
    kills: [
      'test/convex/auth-delete-user.test.ts > account deletion with real Better Auth > is off unless the app enables it',
    ],
    projects: ['convex'],
  },
  {
    id: 'S-B-delete-user-enabled-flag',
    guards: 'deleteUser: { enabled: false } stays off',
    file: 'src/runtime/convex-auth/create-better-convex-auth.ts',
    find: 'user: options.deleteUser?.enabled',
    replace: 'user: options.deleteUser',
    kills: [
      'test/convex/auth-delete-user.test.ts > account deletion with real Better Auth > also stays off for deleteUser: { enabled: false }',
    ],
    projects: ['convex'],
  },
  {
    id: 'S-B-delete-user-before-delete-runs',
    guards: 'beforeDelete runs before the account is deleted',
    file: 'src/runtime/convex-auth/create-better-convex-auth.ts',
    find: 'await callback(ctx, emailUser(user))',
    replace: 'void callback',
    kills: [
      'test/convex/auth-delete-user.test.ts > account deletion with real Better Auth > deletes the auth user for a fresh session after beforeDelete allowed it',
      'test/convex/auth-delete-user.test.ts > account deletion with real Better Auth > beforeDelete throwing refuses and deletes nothing: the app message reaches the person',
      'test/convex/auth-delete-user.test.ts > account deletion with real Better Auth > beforeDelete throwing refuses and deletes nothing: any other error is a generic refusal',
    ],
    projects: ['convex'],
  },
  {
    id: 'S-B-delete-user-refusal-propagates',
    guards: 'a throwing beforeDelete refuses the deletion',
    file: 'src/runtime/convex-auth/create-better-convex-auth.ts',
    find: "throw new APIError('FORBIDDEN', { message: message ?? 'AUTH_USER_DELETE_REFUSED' })",
    replace: 'return',
    kills: [
      'test/convex/auth-delete-user.test.ts > account deletion with real Better Auth > beforeDelete throwing refuses and deletes nothing: the app message reaches the person',
      'test/convex/auth-delete-user.test.ts > account deletion with real Better Auth > beforeDelete throwing refuses and deletes nothing: any other error is a generic refusal',
    ],
    projects: ['convex'],
  },
  {
    id: 'S-B-delete-user-refusal-hides-detail',
    guards: 'an internal beforeDelete error is not shown to the person',
    file: 'src/runtime/convex-auth/create-better-convex-auth.ts',
    find: "message: message ?? 'AUTH_USER_DELETE_REFUSED'",
    replace: 'message: message ?? String((error as Error).message)',
    kills: [
      'test/convex/auth-delete-user.test.ts > account deletion with real Better Auth > beforeDelete throwing refuses and deletes nothing: any other error is a generic refusal',
    ],
    projects: ['convex'],
  },
  {
    id: 'S-B-delete-user-fresh-session',
    guards: 'a stale session cannot delete the account',
    file: 'src/runtime/convex-auth/create-better-convex-auth.ts',
    find: 'session: { ...sessionPolicy },',
    replace: 'session: { ...sessionPolicy, freshAge: 0 },',
    kills: [
      'test/convex/auth-delete-user.test.ts > account deletion with real Better Auth > refuses a stale session and deletes nothing',
    ],
    projects: ['convex'],
  },
  {
    id: 'S-B-delete-user-email-kind',
    guards: 'the delete-account email carries its own kind',
    file: 'src/runtime/convex-auth/create-better-convex-auth.ts',
    find: "type: 'delete-account',",
    replace: "type: 'reset-password',",
    kills: [
      'test/convex/auth-delete-user.test.ts > account deletion with real Better Auth > with an email sender, mails a delete-account link and deletes when it is opened',
    ],
    projects: ['convex'],
  },
  {
    id: 'S-B-delete-user-email-confirmation',
    guards: 'with an email sender, deletion waits for the link',
    file: 'src/runtime/convex-auth/create-better-convex-auth.ts',
    find: 'sendDeleteAccountVerification: async ({ user, url, token }) =>',
    replace: 'sendDeleteAccountVerificationOff: async ({ user, url, token }) =>',
    kills: [
      'test/convex/auth-delete-user.test.ts > account deletion with real Better Auth > with an email sender, mails a delete-account link and deletes when it is opened',
    ],
    projects: ['convex'],
  },
  {
    id: 'S-B-delete-user-reviewed-shape',
    guards: 'deleteUser admits only enabled and beforeDelete',
    file: 'src/runtime/convex-auth/create-better-convex-auth.ts',
    find: "assertOnlyKeys(record.deleteUser, ['enabled', 'beforeDelete'], 'deleteUser')",
    replace: 'void 0',
    kills: [
      'test/unit/create-better-convex-auth.test.ts > createBetterConvexAuth > rejects deleteUser with afterDelete outside the reviewed shape',
    ],
    projects: ['unit'],
  },
  {
    id: 'S-B-projection-erase-hook',
    guards: 'the projection erases the person before deleting the row',
    file: 'src/runtime/convex-auth/user-projection.ts',
    find: 'await options.erase?.({ ctx, user, existing: row })',
    replace: 'void 0',
    kills: [
      'test/unit/create-user-projection-triggers.test.ts > createUserProjectionTriggers > runs the erase hook for each projection row before deleting it, and only when configured',
    ],
    projects: ['unit'],
  },
  {
    id: 'S-B-erase-batch-budget',
    guards: 'one erasure step reads a bounded number of rows',
    file: 'packages/functions/src/budget.ts',
    find: 'rows: 100,',
    replace: 'rows: 100000,',
    kills: [
      `${F}/erasure.test.ts > erasure deletes, anonymizes and keeps across batches, and leaves other people alone`,
    ],
    projects: ['functions'],
  },
  {
    id: 'S-B-erase-delete',
    guards: 'delete entries delete the rows',
    file: 'packages/functions/src/erasure.ts',
    find: "if (kind === 'delete') await db.delete(row._id)",
    replace: "if (kind === 'delete') void 0",
    kills: [
      `${F}/erasure.test.ts > erasure deletes, anonymizes and keeps across batches, and leaves other people alone`,
    ],
    projects: ['functions'],
  },
  {
    id: 'S-B-erase-anonymize',
    guards: 'anonymize entries remove the field',
    file: 'packages/functions/src/erasure.ts',
    find: 'else await db.patch(row._id, { [field]: undefined })',
    replace: 'else void 0',
    kills: [
      `${F}/erasure.test.ts > erasure deletes, anonymizes and keeps across batches, and leaves other people alone`,
    ],
    projects: ['functions'],
  },
  {
    id: 'S-B-erase-only-this-user',
    guards: 'app erasure touches only the erased person',
    file: 'packages/functions/src/erasure.ts',
    find: 'db.query(table).withIndex(index.indexDescriptor, (q) => q.eq(field, userId)),',
    replace: "db.query(table).withIndex(index.indexDescriptor, (q) => q.gte(field, '')),",
    kills: [
      `${F}/erasure.test.ts > erasure deletes, anonymizes and keeps across batches, and leaves other people alone`,
    ],
    projects: ['functions'],
  },
  {
    id: 'S-B-erase-continues',
    guards: 'a step schedules the next one under its own name',
    file: 'packages/functions/src/erasure.ts',
    find: 'self: getFunctionName(step)',
    replace: "self: 'fns:wrong'",
    kills: [
      `${F}/erasure.test.ts > erasure deletes, anonymizes and keeps across batches, and leaves other people alone`,
    ],
    projects: ['functions'],
  },
  {
    id: 'S-B-erase-library-grants',
    guards: 'agent grants of the person are deleted',
    file: 'packages/functions/src/erasure.ts',
    find: "db.query('agentGrants').withIndex('by_user_agent', (q) => q.eq('userId', userId)),",
    replace: "db.query('agentGrants').withIndex('by_user_agent', (q) => q.eq('userId', 'nobody')),",
    kills: [
      `${F}/erasure.test.ts > library tables: own rows go or lose the ID, other people keep theirs`,
    ],
    projects: ['functions'],
  },
  {
    id: 'S-B-erase-library-cancel-pending',
    guards: 'the pending requests of the person are cancelled',
    file: 'packages/functions/src/erasure.ts',
    find: "...(row.status === 'pending' ? { status: 'cancelled' } : {}),",
    replace: '',
    kills: [
      `${F}/erasure.test.ts > library tables: own rows go or lose the ID, other people keep theirs`,
    ],
    projects: ['functions'],
  },
  {
    id: 'S-B-erase-library-requester',
    guards: 'a request keeps its row and loses the requester id',
    file: 'packages/functions/src/erasure.ts',
    find: 'requester: withoutPerson(row.requester),',
    replace: 'requester: row.requester,',
    kills: [
      `${F}/erasure.test.ts > library tables: own rows go or lose the ID, other people keep theirs`,
    ],
    projects: ['functions'],
  },
  {
    id: 'S-B-erase-library-actor-key',
    guards: 'the actor key names the person, so it is replaced',
    file: 'packages/functions/src/erasure.ts',
    find: "return { ...rest, key: 'erased' }",
    replace: 'return { ...rest }',
    kills: [
      `${F}/erasure.test.ts > library tables: own rows go or lose the ID, other people keep theirs`,
    ],
    projects: ['functions'],
  },
  {
    id: 'S-B-erase-library-other-requesters',
    guards: 'erasure never changes the request of another requester',
    file: 'packages/functions/src/erasure.ts',
    find: "db.query('approvals').withIndex('by_user_status', (q) => q.eq('requester.userId', userId)),",
    replace:
      "db.query('approvals').withIndex('by_user_status', (q) => q.gte('requester.userId', '')),",
    kills: [
      `${F}/erasure.test.ts > library tables: own rows go or lose the ID, other people keep theirs`,
    ],
    projects: ['functions'],
  },
  {
    id: 'S-B-erase-library-activity',
    guards: 'activity rows lose the person and keep their row',
    file: 'packages/functions/src/erasure.ts',
    find: "db.query(table).withIndex('by_user', (q) => q.eq('actor.userId', userId)),",
    replace: "db.query(table).withIndex('by_user', (q) => q.eq('actor.userId', 'nobody')),",
    kills: [
      `${F}/erasure.test.ts > library tables: own rows go or lose the ID, other people keep theirs`,
    ],
    projects: ['functions'],
  },
  {
    id: 'S-B-erase-library-messages',
    guards: 'a run goes only with its last message',
    file: 'packages/functions/src/erasure.ts',
    find: 'if (messages.more) return true',
    replace: 'if (false) return true',
    kills: [
      `${F}/erasure.test.ts > library tables: own rows go or lose the ID, other people keep theirs`,
    ],
    projects: ['functions'],
  },
  {
    id: 'S-B-erase-library-limits',
    guards: 'rate limit counters of the person are deleted',
    file: 'packages/functions/src/erasure.ts',
    find: '`person:${userId}|`, `mcp:${userId}:`, `app:${userId}:`',
    replace: '`person:${userId}|`, `app:${userId}:`',
    kills: [
      `${F}/erasure.test.ts > library tables: own rows go or lose the ID, other people keep theirs`,
    ],
    projects: ['functions'],
  },
  {
    id: 'S-B-erase-def-index',
    guards: 'a delete entry needs an index that starts with its field',
    file: 'packages/functions/src/erasure.ts',
    find: 'if (!index)',
    replace: 'if (false)',
    kills: [`${F}/erasure.test.ts > erasure definition error: {"notes":{"delete":"editorId"}}`],
    projects: ['functions'],
  },
  {
    id: 'S-B-erase-def-optional',
    guards: 'anonymize needs an optional field',
    file: 'packages/functions/src/erasure.ts',
    find: "if (kind === 'anonymize' && fieldValidator.isOptional !== 'optional')",
    replace: 'if (false)',
    kills: [`${F}/erasure.test.ts > erasure definition error: {"notes":{"anonymize":"authorId"}}`],
    projects: ['functions'],
  },
  {
    id: 'S-B-erase-def-keep-reason',
    guards: 'keep needs a reason',
    file: 'packages/functions/src/erasure.ts',
    find: "entry.keep.trim() === ''",
    replace: 'false',
    kills: [`${F}/erasure.test.ts > erasure definition error: {"notes":{"keep":" "}}`],
    projects: ['functions'],
  },
  {
    id: 'S-B-erase-def-one-kind',
    guards: 'an entry is exactly one of delete, anonymize or keep',
    file: 'packages/functions/src/erasure.ts',
    find: 'if (kinds.length !== 1)',
    replace: 'if (kinds.length === 0)',
    kills: [
      `${F}/erasure.test.ts > erasure definition error: {"notes":{"delete":"authorId","keep":"both"}}`,
    ],
    projects: ['functions'],
  },
  {
    id: 'S-B-erase-def-field',
    guards: 'the named field must exist',
    file: 'packages/functions/src/erasure.ts',
    find: 'if (!fieldValidator) definitionError',
    replace: 'if (false) definitionError',
    kills: [`${F}/erasure.test.ts > erasure definition error: {"notes":{"delete":"missing"}}`],
    projects: ['functions'],
  },
  {
    id: 'S-B-erase-def-table',
    guards: 'the named table must exist',
    file: 'packages/functions/src/erasure.ts',
    find: "if (!definition) definitionError(table, 'the schema has no such table.')",
    replace: 'if (false) void 0',
    kills: [`${F}/erasure.test.ts > erasure definition error: {"posts":{"delete":"authorId"}}`],
    projects: ['functions'],
  },
  {
    id: 'S-B-erase-def-library',
    guards: 'library tables are not in the map',
    file: 'packages/functions/src/erasure.ts',
    find: 'if (libraryTableNames.has(table))',
    replace: 'if (false)',
    kills: [`${F}/erasure.test.ts > erasure definition error: {"activity":{"delete":"actor"}}`],
    projects: ['functions'],
  },
  {
    id: 'S-B-erase-def-schema',
    guards: 'erasure needs the schema',
    file: 'packages/functions/src/erasure.ts',
    find: 'if (!schema)',
    replace: 'if (false)',
    kills: [`${F}/erasure.test.ts > erasure needs the schema`],
    projects: ['functions'],
  },
  {
    id: 'S-B-erase-opt-in',
    guards: 'no erasure code exists unless the app configures it',
    file: 'packages/functions/src/functions.ts',
    find: 'if (config.erasure === undefined) return fns as Result',
    replace: 'if (false) return fns as Result',
    kills: [`${F}/erasure.test.ts > without erasure there is no erasure code`],
    projects: ['functions'],
  },
  {
    id: 'T-3-unknown-rule-hidden',
    guards: 'a rule of an unknown kind grants nothing',
    file: 'packages/functions/src/rules.ts',
    find: "anyOf.\n        return 'hidden'",
    replace: "anyOf.\n        return 'ok'",
    kills: [
      `${F}/rules.test.ts > a rule of an unknown kind refuses the row, alone and inside allOf`,
    ],
    projects: ['functions'],
  },
  {
    id: 'S-F2-runs-progress',
    guards: 'a long run cannot use the whole budget before its messages',
    file: 'packages/functions/src/erasure.ts',
    find: 'budget.count(run)',
    replace: 'while (!budget.spent) budget.count(run)',
    kills: [
      `${F}/erasure.test.ts > a person with many runs and messages is erased in a bounded number of steps`,
    ],
    projects: ['functions'],
  },
  {
    id: 'S-F2-array-entries',
    guards: 'every entry of a table is erased',
    file: 'packages/functions/src/erasure.ts',
    find: 'const entries = Array.isArray(value) ? (value as object[]) : [value as object]',
    replace:
      'const entries = (Array.isArray(value) ? (value as object[]) : [value as object]).slice(0, 1)',
    kills: [`${F}/erasure.test.ts > an array of entries erases every field of a table`],
    projects: ['functions'],
  },
  {
    id: 'S-F2-keep-alone',
    guards: 'keep cannot be combined with other entries',
    file: 'packages/functions/src/erasure.ts',
    find: 'entries.length > 1 && entries.some',
    replace: 'false && entries.some',
    kills: [
      `${F}/erasure.test.ts > erasure definition error: {"notes":[{"delete":"authorId"},{"keep":"why"}]}`,
    ],
    projects: ['functions'],
  },
  {
    id: 'S-F2-launch-fields',
    guards: 'every user ID field of a table needs an entry',
    file: 'packages/functions/src/test.ts',
    find: 'if (covered.has(top)) continue',
    replace: 'if (covered.size > 0) continue',
    kills: [
      `${F}/launch.test.ts > check 2: a table is checked field by field, and keep covers all of it`,
    ],
  },
  {
    id: 'S-F2-launch-keep',
    guards: 'keep covers the whole table in the launch check',
    file: 'packages/functions/src/test.ts',
    find: "if (entries.some((entry) => 'keep' in entry)) continue",
    replace: 'if (false) continue',
    kills: [
      `${F}/launch.test.ts > check 2: a table is checked field by field, and keep covers all of it`,
    ],
  },
  {
    id: 'S-F2-launch-record-key',
    guards: 'a user ID as a record key counts',
    file: 'packages/functions/src/test.ts',
    find: "...userIdFields(node.key, path || '(the whole document)'),",
    replace: '',
    kills: [`${F}/launch.test.ts > check 2: a user ID as a record key counts`],
  },
  {
    id: 'S-F2-launch-step-export',
    guards: 'launch check wants the erasure step exported',
    file: 'packages/functions/src/test.ts',
    find: '!scan.exports.some(',
    replace: 'false && !scan.exports.some(',
    kills: [
      `${F}/launch.test.ts > check 2: erasure without an exported eraseStep is named, with the fix`,
    ],
  },
  {
    id: 'S-F2-step-marker',
    guards: 'the erasure step carries the marker the launch check looks for',
    file: 'packages/functions/src/guard.ts',
    find: 'ERASURE_STEP, { value: true, enumerable: false }',
    replace: 'ERASURE_STEP, { value: false, enumerable: false }',
    kills: [`${F}/launch.test.ts > a fully set up app has no launch problems`],
  },
  // Slice C: `launchProblems` and the starter's safeguards.
  {
    id: 'S-C-raw-functions',
    guards: 'saas-c',
    file: 'packages/functions/src/test.ts',
    find: 'for (const id of await unguardedFunctions(modules, { trustedRoutes })) {',
    replace: 'for (const id of [] as string[]) {',
    kills: [
      `${F}/launch.test.ts > check 1: a function built with Convex builders is named, with the fix`,
    ],
  },
  {
    id: 'S-C-erasure-table-missing',
    guards: 'saas-c',
    file: 'packages/functions/src/test.ts',
    find: 'if (covered.has(top)) continue',
    replace: 'if (true) continue',
    kills: [
      `${F}/launch.test.ts > check 2: tables with a user ID that are not in erasure are named with their field`,
    ],
  },
  {
    id: 'S-C-erasure-none',
    guards: 'saas-c',
    file: 'packages/functions/src/test.ts',
    find: 'if (holders.length > 0)',
    replace: 'if (false)',
    kills: [`${F}/launch.test.ts > check 2: no erasure at all says account deletion is not set up`],
  },
  {
    id: 'S-C-erasure-users-exempt',
    guards: 'saas-c',
    file: 'packages/functions/src/test.ts',
    find: "table !== 'users' && !Object.hasOwn(libraryTables, table)",
    replace: '!Object.hasOwn(libraryTables, table)',
    kills: [`${F}/launch.test.ts > check 2: the users table and the library tables need no entry`],
  },
  {
    id: 'S-C-erasure-array',
    guards: 'saas-c',
    file: 'packages/functions/src/test.ts',
    find: 'return userIdFields(node.element, `${path}[]`)',
    replace: 'return []',
    kills: [
      `${F}/launch.test.ts > check 2: tables with a user ID that are not in erasure are named with their field`,
    ],
  },
  {
    id: 'S-C-erasure-record',
    guards: 'saas-c',
    file: 'packages/functions/src/test.ts',
    find: '...userIdFields(node.value, `${path}[]`),',
    replace: '',
    kills: [
      `${F}/launch.test.ts > check 2: tables with a user ID that are not in erasure are named with their field`,
    ],
  },
  {
    id: 'S-C-erasure-union',
    guards: 'saas-c',
    file: 'packages/functions/src/test.ts',
    find: '(node.members ?? []).flatMap((member) => userIdFields(member, path))',
    replace: '[]',
    kills: [
      `${F}/launch.test.ts > check 2: tables with a user ID that are not in erasure are named with their field`,
    ],
  },
  {
    id: 'S-C-housekeeping-cron',
    guards: 'saas-c',
    file: 'packages/functions/src/test.ts',
    find: 'if (!called.has(functionName))',
    replace: 'if (false)',
    kills: [`${F}/launch.test.ts > check 3: the agents housekeeping function needs a cron`],
  },
  {
    id: 'S-C-housekeeping-detected',
    guards: 'saas-c',
    file: 'packages/functions/src/test.ts',
    find: 'if (!(value as { [HOUSEKEEPING]?: unknown } | null)?.[HOUSEKEEPING]) continue',
    replace: 'continue',
    kills: [`${F}/launch.test.ts > check 3: the agents housekeeping function needs a cron`],
  },
  {
    id: 'S-C-housekeeping-marked',
    guards: 'saas-c',
    file: 'packages/agents/src/tools.ts',
    find: 'const housekeeping = markHousekeeping(',
    replace: 'const housekeeping = ((registered: unknown) => registered)(',
    kills: [
      `${A}/approvals/approvals.test.ts > launchProblems finds the housekeeping function this package builds`,
    ],
    projects: ['agents'],
  },
  {
    id: 'S-C-public-limit',
    guards: 'saas-c',
    file: 'packages/functions/src/test.ts',
    find: '|| limitOf(fns.policy, op.action) ',
    replace: '',
    kills: [`${F}/launch.test.ts > a fully set up app has no launch problems`],
  },
  {
    id: 'S-C-public-mutations-only',
    guards: 'saas-c',
    file: 'packages/functions/src/test.ts',
    find: "op.kind !== 'mutation' || ",
    replace: '',
    kills: [
      `${F}/launch.test.ts > a fully set up app has no launch problems`,
      `${F}/launch.test.ts > check 4: a public mutation without a limit is named, with the limit to add`,
    ],
  },
  {
    id: 'S-C-starter-erasure',
    guards: 'saas-c',
    file: 'starters/mcp-oauth-agent/convex/functions.ts',
    find: "memberships: { delete: 'userId' },",
    replace: '',
    kills: [
      `${starter}/launch.test.ts > the app has no launch problems`,
      `${starter}/account.test.ts > account safeguards > erases the memberships and the profile of a deleted account, and keeps the team data`,
    ],
    projects: ['mcp'],
  },
  {
    id: 'S-C-starter-erase-wired',
    guards: 'saas-c',
    file: 'starters/mcp-oauth-agent/convex/accountDeletion.ts',
    find: 'if (page.isDone) await eraseUser(ctx, userId, internal.erasure.eraseStep)',
    replace: 'if (page.isDone) void 0',
    kills: [
      `${starter}/account.test.ts > account safeguards > erases the memberships and the profile of a deleted account, and keeps the team data`,
    ],
    projects: ['mcp'],
  },
  {
    id: 'S-E-erase-caller',
    guards: 'saas-e',
    file: 'packages/functions/src/erasure.ts',
    find: 'caller: withoutPersonCaller(row.caller),',
    replace: '',
    kills: [
      `${F}/erasure.test.ts > library tables: own rows go or lose the ID, other people keep theirs`,
    ],
  },
  {
    id: 'S-E-erase-grant',
    guards: 'saas-e',
    file: 'packages/functions/src/erasure.ts',
    find: "userId: 'erased', sessionId: 'erased', grantId: 'erased' },",
    replace: "userId: 'erased', sessionId: 'erased' },",
    kills: [
      `${F}/erasure.test.ts > library tables: own rows go or lose the ID, other people keep theirs`,
    ],
  },
  {
    id: 'S-E-solo-wired',
    guards: 'saas-e',
    file: 'starters/mcp-oauth-agent/convex/auth.ts',
    find: `        await ctx.scheduler.runAfter(0, internal.accountDeletion.scanOrganizations, {
          userId: user._id,
          cursor: null,
        })
`,
    replace: '',
    kills: [
      `${starter}/account.test.ts > account safeguards > deletes the organizations only the person used, in batches, and keeps shared ones`,
    ],
    projects: ['mcp'],
  },
  {
    id: 'S-E-solo-shared',
    guards: 'saas-e',
    file: 'starters/mcp-oauth-agent/convex/accountDeletion.ts',
    find: 'if (member.userId !== userId) return true',
    replace: 'if (member.userId === userId) return true',
    kills: [
      `${starter}/account.test.ts > account safeguards > deletes the organizations only the person used, in batches, and keeps shared ones`,
    ],
    projects: ['mcp'],
  },
  {
    id: 'S-E-solo-batch',
    guards: 'saas-e',
    file: 'starters/mcp-oauth-agent/convex/accountDeletion.ts',
    find: 'if (left > 0) await ctx.db.delete(organizationId)',
    replace: 'await ctx.db.delete(organizationId)',
    kills: [
      `${starter}/account.test.ts > account safeguards > deletes the organizations only the person used, in batches, and keeps shared ones`,
    ],
    projects: ['mcp'],
  },
  {
    id: 'S-E-solo-recheck',
    guards: 'saas-e',
    file: 'starters/mcp-oauth-agent/convex/accountDeletion.ts',
    find: 'if (await hasOtherMember(ctx.db, organizationId, userId)) continue',
    replace: '',
    kills: [
      `${starter}/account.test.ts > account safeguards > deletes the organizations only the person used, in batches, and keeps shared ones`,
    ],
    projects: ['mcp'],
  },
  {
    id: 'S-C-starter-last-owner',
    guards: 'saas-c',
    file: 'starters/mcp-oauth-agent/convex/accountDeletion.ts',
    find: "if (others.length > 0) return 'last-owner' as const",
    replace: '',
    kills: [
      `${starter}/account.test.ts > account safeguards > refuses to delete the last owner of an organization that has other members`,
    ],
    projects: ['mcp'],
  },
  {
    id: 'S-F3-owner-index',
    guards: 'saas-f3',
    file: 'starters/mcp-oauth-agent/convex/accountDeletion.ts',
    find: ".eq('status', 'active').eq('role', 'owner'),\n        )\n        .take(OWNED_TEAMS_CHECKED + 1)",
    replace: ".eq('status', 'active'))\n        .take(100)",
    kills: [
      `${starter}/account.test.ts > account safeguards > still refuses the last owner after 150 removed and 150 other memberships`,
    ],
    projects: ['mcp'],
  },
  {
    id: 'S-F3-too-many-teams',
    guards: 'saas-f3',
    file: 'starters/mcp-oauth-agent/convex/accountDeletion.ts',
    find: "if (owned.length > OWNED_TEAMS_CHECKED) return 'too-many-teams' as const",
    replace: '',
    kills: [
      `${starter}/account.test.ts > account safeguards > refuses when the person owns more organizations than one check can read`,
    ],
    projects: ['mcp'],
  },
  {
    id: 'S-F3-scan-all-pages',
    guards: 'saas-f3',
    file: 'starters/mcp-oauth-agent/convex/accountDeletion.ts',
    find: 'if (page.isDone) await eraseUser',
    replace: 'if (true) await eraseUser',
    kills: [
      `${starter}/account.test.ts > account safeguards > erases all 150 organizations the person was alone in`,
    ],
    projects: ['mcp'],
  },
  {
    id: 'S-F3-removed-row-counts',
    guards: 'saas-f3',
    file: 'starters/mcp-oauth-agent/convex/accountDeletion.ts',
    find: 'if (member.userId !== userId) return true',
    replace: "if (member.userId !== userId && member.status === 'active') return true",
    kills: [
      `${starter}/account.test.ts > account safeguards > keeps an organization where someone else has a removed membership`,
    ],
    projects: ['mcp'],
  },
  {
    id: 'S-C-starter-limit',
    guards: 'saas-c',
    file: 'starters/mcp-oauth-agent/convex/policy.ts',
    find: "limits: { 'projects.create': { max: 30, every: 'minute' } },",
    replace: '',
    kills: [
      `${starter}/account.test.ts > account safeguards > limits project creation to 30 a minute per person`,
    ],
    projects: ['mcp'],
  },
  {
    id: 'S-C-starter-audit',
    guards: 'saas-c',
    file: 'starters/mcp-oauth-agent/convex/policy.ts',
    find: "audit: ['projects.archive'],",
    replace: '',
    kills: [
      `${starter}/account.test.ts > account safeguards > records who archived a project in the audit log`,
    ],
    projects: ['mcp'],
  },
  {
    id: 'T-T1-internal-deny',
    guards: 'doors',
    file: 'packages/functions/src/functions.ts',
    find: "if (decision === 'deny') {",
    replace: "if (decision === 'deny' && op.kind !== undefined) {",
    kills: [
      `${F}/doors.test.ts > policy deny on internal mutation run by an action: FORBIDDEN, nothing written`,
      `${F}/doors.test.ts > policy deny on internal mutation scheduled: FORBIDDEN, nothing written`,
      `${F}/doors.test.ts > policy deny on nested under an audited outer: FORBIDDEN, nothing written`,
      `${F}/doors.test.ts > policy deny on nested under an unaudited outer: FORBIDDEN, nothing written`,
    ],
    projects: ['functions'],
  },
  {
    id: 'T-T1-internal-rules',
    guards: 'doors',
    file: 'packages/functions/src/functions.ts',
    find: "db: db as Ctx['db'],",
    replace: "db: (op.kind ? db : ctx.db) as Ctx['db'],",
    kills: [
      `${F}/doors.test.ts > row rules on internal mutation run by an action: a foreign row is refused, the call rolls back`,
      `${F}/doors.test.ts > row rules on internal mutation scheduled: a foreign row is refused, the call rolls back`,
      `${F}/doors.test.ts > row rules on nested under an audited outer: a foreign row is refused, the call rolls back`,
      `${F}/doors.test.ts > row rules on nested under an unaudited outer: a foreign row is refused, the call rolls back`,
      `${F}/doors.test.ts > row rules on nested under a limited outer of the same action: a foreign row is refused, the call rolls back`,
    ],
    projects: ['functions'],
  },
  {
    id: 'T-T1-internal-audit',
    guards: 'doors',
    file: 'packages/functions/src/functions.ts',
    find: "(op.kind === 'mutation' || op.writes === true) &&",
    replace: "op.kind === 'mutation' &&",
    kills: [
      `${F}/doors.test.ts > audit on internal mutation run by an action: one row with the person, the outer action and the ids`,
      `${F}/doors.test.ts > audit on internal mutation scheduled: one row with the person, the outer action and the ids`,
      `${F}/doors.test.ts > audit on nested under an unaudited outer: one row with the person, the outer action and the ids`,
    ],
    projects: ['functions'],
  },
  {
    id: 'T-T1-visitor-audit',
    guards: 'doors',
    file: 'packages/functions/src/functions.ts',
    find: "      actor.kind !== 'visitor' &&\n      isAudited",
    replace: '      isAudited',
    kills: [
      `${F}/doors.test.ts > a visitor on an audited public action writes no audit row; a person does`,
    ],
    projects: ['functions'],
  },
  {
    id: 'T-T1-job-limit',
    guards: 'doors',
    file: 'packages/functions/src/functions.ts',
    find: "      limit &&\n      actor.kind !== 'system' &&",
    replace: '      limit &&',
    kills: [
      `${F}/doors.test.ts > a job runs the guarded mutation unlimited, without an audit row, with one activity row each`,
    ],
    projects: ['functions'],
  },
  {
    id: 'T-T1-job-rules',
    guards: 'doors',
    file: 'packages/functions/src/rules.ts',
    find: "if (call.actor.kind === 'system') return raw",
    replace: "if (call.actor.kind === 'system' && false) return raw",
    kills: [`${F}/doors.test.ts > a job may write a row of any place`],
    projects: ['functions'],
  },
  {
    id: 'T-T1-agent-deny',
    guards: 'doors',
    file: 'packages/functions/src/functions.ts',
    find: "if (decision === 'deny') {",
    replace: "if (decision === 'deny' && actor.kind !== 'agent') {",
    kills: [
      `${A}/doors.test.ts > deny on the door path: FORBIDDEN, nothing written`,
      `${A}/doors.test.ts > deny on the derived path: FORBIDDEN, nothing written`,
      `${A}/doors.test.ts > deny on the inApp path: FORBIDDEN, nothing written`,
    ],
    projects: ['agents'],
  },
  {
    id: 'T-T1-agent-rules',
    guards: 'doors',
    file: 'packages/functions/src/functions.ts',
    find: "db: db as Ctx['db'],",
    replace: "db: (actor.kind === 'agent' ? ctx.db : db) as Ctx['db'],",
    kills: [
      `${A}/doors.test.ts > row rules on the door path: a foreign project is NOT_FOUND`,
      `${A}/doors.test.ts > row rules on the derived path: a foreign project is NOT_FOUND`,
      `${A}/doors.test.ts > row rules on the inApp path: a foreign project is NOT_FOUND`,
    ],
    projects: ['agents'],
  },
  {
    id: 'T-T1-agent-limit',
    guards: 'doors',
    file: 'packages/functions/src/functions.ts',
    find: "      limit &&\n      actor.kind !== 'system' &&",
    replace: "      limit &&\n      actor.kind === 'person' &&",
    kills: [
      `${A}/doors.test.ts > limit on the door path: 2 calls pass, the 3rd is RATE_LIMITED`,
      `${A}/doors.test.ts > limit on the derived path: 2 calls pass, the 3rd is RATE_LIMITED`,
      `${A}/doors.test.ts > limit on the inApp path: 2 calls pass, the 3rd is RATE_LIMITED`,
    ],
    projects: ['agents'],
  },
  {
    id: 'T-T1-writes-budget',
    guards: 'doors',
    file: 'packages/agents/src/tools.ts',
    find: 'if (!renew) await rateLimit(ctx, `${requester.key}|writes`, agentWritesPerMinute)',
    replace: 'void 0',
    kills: [
      `${A}/doors.test.ts > write budget on the door path: 60 writes pass, the 61st is RATE_LIMITED`,
      `${A}/doors.test.ts > write budget on the derived path: 60 writes pass, the 61st is RATE_LIMITED`,
      `${A}/doors.test.ts > write budget on the inApp path: 60 writes pass, the 61st is RATE_LIMITED`,
      `${A}/doors.test.ts > the approved path takes no limit token and no write: only the request counts a write`,
    ],
    projects: ['agents'],
  },
  {
    id: 'T-T1-door-leak',
    guards: 'doors',
    file: 'packages/agents/src/door.ts',
    find: 'return failure(toolFailure(error))',
    replace:
      "return failure({ code: 'FAILED', message: String((error as Error).message ?? error) })",
    kills: [
      `${A}/doors.test.ts > upstream error on the door path (code): the host sees only the static failure`,
      `${A}/doors.test.ts > upstream error on the door path (text): the host sees only the static failure`,
      `${A}/doors.test.ts > upstream error on the door path (plain): the host sees only the static failure`,
      `${A}/doors.test.ts > upstream error on the doorModern path (code): the host sees only the static failure`,
      `${A}/doors.test.ts > upstream error on the doorModern path (text): the host sees only the static failure`,
      `${A}/doors.test.ts > upstream error on the doorModern path (plain): the host sees only the static failure`,
    ],
    projects: ['agents'],
  },
  {
    id: 'T-T1-approve-leak',
    guards: 'doors',
    file: 'packages/agents/src/tools.ts',
    find: 'const failure = toolFailure(ran.error)',
    replace:
      "const failure = { code: 'FAILED', message: String((ran.error as Error).message ?? ran.error) }",
    kills: [
      `${A}/doors.test.ts > upstream error on the approved path (code): the host sees only the static failure`,
      `${A}/doors.test.ts > upstream error on the approved path (text): the host sees only the static failure`,
      `${A}/doors.test.ts > upstream error on the approved path (plain): the host sees only the static failure`,
    ],
    projects: ['agents'],
  },
  {
    id: 'T-T1-runtool-leak',
    guards: 'doors',
    file: 'packages/agents/src/errors.ts',
    find: "content: [{ type: 'text', text: 'Tool execution failed' }],\n        isError: true,\n      }\n    )",
    replace:
      "content: [{ type: 'text', text: String((error as Error).message) }],\n        isError: true,\n      }\n    )",
    kills: [
      `${A}/doors.test.ts > upstream error on the runTool path (code): the host sees only the static failure`,
      `${A}/doors.test.ts > upstream error on the runTool path (text): the host sees only the static failure`,
      `${A}/doors.test.ts > upstream error on the runTool path (plain): the host sees only the static failure`,
      `${A}/doors.test.ts > a hand-written server on transport 2026-07-28: runTool hides the message, the rest does not`,
      `${A}/doors.test.ts > a hand-written server on transport 2025-06-18: runTool hides the message, the rest does not`,
    ],
    projects: ['agents'],
  },
  {
    id: 'T-T1-failureof-any',
    guards: 'doors',
    file: 'packages/functions/src/actor.ts',
    find: '(errorCodes as readonly unknown[]).includes(code)',
    replace: "typeof code === 'string'",
    kills: [
      `${A}/doors.test.ts > upstream error on the door path (code): the host sees only the static failure`,
      `${A}/doors.test.ts > upstream error on the doorModern path (code): the host sees only the static failure`,
      `${A}/doors.test.ts > upstream error on the derived path (code): the host sees only the static failure`,
      `${A}/doors.test.ts > upstream error on the inApp path (code): the host sees only the static failure`,
      `${A}/doors.test.ts > upstream error on the approved path (code): the host sees only the static failure`,
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
  {
    id: 'S-A-denied-takes-token',
    file: 'packages/functions/src/functions.ts',
    find: "decision === 'allow' &&",
    replace: "decision !== 'approve' &&",
    reason:
      'A denied call fails after the token is taken, and Convex rolls the whole mutation back: the bucket is unchanged either way. The test pins the visible result (no bucket row).',
  },
  {
    id: 'S-B-delete-user-fresh-age-invariant',
    file: 'src/runtime/convex-auth/create-better-convex-auth.ts',
    find: '(options.user?.deleteUser?.enabled === true && options.session.freshAge === 0)',
    replace: 'false',
    reason:
      'The factory never sets session.freshAge and rejects every other session option, so the final options cannot hold freshAge 0: the invariant is defence in depth against a later change.',
  },
  {
    id: 'S-C-erasure-library-exempt',
    file: 'packages/functions/src/test.ts',
    find: "table !== 'users' && !Object.hasOwn(libraryTables, table)",
    replace: "table !== 'users'",
    reason:
      "No library table holds v.id('users') (they store the user ID as a string), so the exemption cannot change a result today: it keeps the check right if a library table ever gains such a field.",
  },
]

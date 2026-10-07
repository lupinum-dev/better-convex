/**
 * The public surface of `@lupinum/better-convex-functions`. Everything else in
 * `src/` is the library's own; test helpers are in `./test`.
 */
export { defineFunctions, type Auth, type JobDone, type Plan, type TenantOf } from './functions'
export {
  definePolicy,
  can,
  consentScopes,
  type Policy,
  type ActionOf,
  type RoleOf,
  type ScopeOf,
  type PublicActionOf,
  type AgentRule,
  type Approvers,
} from './policy'
export {
  tenant,
  owner,
  publicRead,
  anyOf,
  allOf,
  custom,
  unchecked,
  type Rule,
  type RuleCtx,
  type TenantRef,
} from './rules'
export { libraryTables, docValidator } from './schema'
export { trusted } from './guard'
export { fail, type ErrorCode, type Actor, type Visitor, type SystemActor } from './actor'
export { oneLine } from './values'

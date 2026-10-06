/**
 * The public surface of `@lupinum/better-convex-functions`. Everything else in
 * `src/` is the library's own; test helpers are in `./test`.
 */
export { defineFunctions, type Auth, type TenantOf } from './functions'
export {
  definePolicy,
  can,
  consentScopes,
  type Policy,
  type ActionOf,
  type RoleOf,
  type ScopeOf,
  type AgentRule,
} from './policy'
export {
  tenant,
  owner,
  publicRead,
  anyOf,
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

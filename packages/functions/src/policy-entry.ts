/**
 * `@lupinum/better-convex-functions/policy`: the policy without any server
 * code, for the browser (`can` to hide a button, `consentScopes` on a consent
 * page) and for the `convex/policy.ts` that both sides import. The root entry
 * exports the same functions.
 */
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

/**
 * What `@lupinum/better-convex-agents` and the in-app agent runtime need from
 * this package, and nothing else: the internals `defineFunctions` hands to
 * `defineTools`, the operation and guard markers, and the actor and value
 * helpers. Not an application API and not under semver: it changes with the
 * agents package, in any release.
 */
export { internalsOf, type LibraryDataModel, type Operation, type ToolSpec } from './functions'
export { guarded, OPERATION } from './guard'
export { guardQuery, readOnly } from './rules'
export { actorRecord, agentCallerValidator, failureOf, type AgentCaller } from './actor'
export { approversFor, scopesFor } from './policy'
export {
  callKey,
  checkInput,
  fingerprint,
  idsIn,
  inertMarkdown,
  jsonOf,
  storable,
  toJsonSchema,
  toolNamePattern,
  unsendable,
} from './values'

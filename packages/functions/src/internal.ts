/**
 * What `@lupinum/better-convex-agents` and the in-app agent runtime need from
 * this package: the kit `defineFunctions` hands to `defineTools`, the
 * operation and guard markers, and the actor and value helpers. Not an
 * application API: it changes with the agents package, without notice.
 */
export { KIT, type LibraryDataModel, type Operation, type ToolSpec } from './functions'
export { guarded, OPERATION } from './guard'
export { actorRecord, agentCallerValidator, failureOf, type AgentCaller } from './actor'
export { roleAllows, scopesFor } from './policy'
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

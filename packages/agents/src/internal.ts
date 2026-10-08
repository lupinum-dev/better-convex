/**
 * What the in-app agent runtime needs, while it lives outside this package (P5 in the plan):
 * how a tool failure reaches a model, and where a run stands. Not an application API and not
 * under semver: it changes in any release.
 */
export { toolFailure } from './tools'
export { cancelRequests, finish, nextTurn, shownStatus, stallAfter, wait, wake } from './runs'

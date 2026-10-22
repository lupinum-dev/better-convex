import { makeFunctionReference, type FunctionReference } from 'convex/server'

/** The settings document, or `null` when the project has none yet. */
export interface ProjectSettings {
  _id: string
  projectId: string
  name: string
  notifyByEmail: boolean
}

/** Stands in for `api.projectSettings.get` in the forms recipe. */
export const getProjectSettings = makeFunctionReference<'query'>(
  'projectSettings:get',
) as FunctionReference<'query', 'public', { projectId: string }, ProjectSettings | null>

/** Stands in for `api.projectSettings.save` in the forms recipe. */
export const saveProjectSettings = makeFunctionReference<'mutation'>(
  'projectSettings:save',
) as FunctionReference<
  'mutation',
  'public',
  { projectId: string; name: string; notifyByEmail: boolean },
  null
>

# @lupinum/better-convex-vue

## 1.0.0-rc.1

### Patch Changes

- [#163](https://github.com/lupinum-dev/better-convex/pull/163) [`9d41154`](https://github.com/lupinum-dev/better-convex/commit/9d41154bb453e507ff2830708ed368531592beef) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Fix `reactive(useConvexQuery(...))` and `reactive()` around every other composable: results are no longer frozen, so `reactive()` unwraps their refs.

- [#163](https://github.com/lupinum-dev/better-convex/pull/163) [`9d41154`](https://github.com/lupinum-dev/better-convex/commit/9d41154bb453e507ff2830708ed368531592beef) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Add refs as individual query arguments: `useConvexQuery(api.projects.get, { projectId })` with `projectId` from `toRefs(props)` now type-checks, also in `useConvexPaginatedQuery`.

## 1.0.0-rc.0

- First 1.0 release candidate, released together with
  `@lupinum/better-convex-nuxt` `1.0.0-rc.0`. The full notes are in the
  repository
  [CHANGELOG.md](https://github.com/lupinum-dev/better-convex/blob/main/CHANGELOG.md#v100-rc0).

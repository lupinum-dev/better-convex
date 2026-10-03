# @lupinum/better-convex-vue

## 1.0.0-rc.2

### Patch Changes

- [#179](https://github.com/lupinum-dev/better-convex/pull/179) [`5b43a1f`](https://github.com/lupinum-dev/better-convex/commit/5b43a1ffec2337476b1f287a4a8732ea6cb5e342) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Change the packaged agent documentation (`<package>/agent-docs`): it now starts with a task table and the rules agents most often get wrong, lists pages in navigation order, and its links work inside the package.

- [#171](https://github.com/lupinum-dev/better-convex/pull/171) [`d84df98`](https://github.com/lupinum-dev/better-convex/commit/d84df9899bb4a2bfd7a71c09076f43095aa5806c) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Fix optimistic updates showing values that were never sent when a reactive object is passed to `mutate()`.

## 1.0.0-rc.1

### Patch Changes

- [#163](https://github.com/lupinum-dev/better-convex/pull/163) [`9d41154`](https://github.com/lupinum-dev/better-convex/commit/9d41154bb453e507ff2830708ed368531592beef) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Fix `reactive(useConvexQuery(...))` and `reactive()` around every other composable: results are no longer frozen, so `reactive()` unwraps their refs.

- [#163](https://github.com/lupinum-dev/better-convex/pull/163) [`9d41154`](https://github.com/lupinum-dev/better-convex/commit/9d41154bb453e507ff2830708ed368531592beef) Thanks [@Mat4m0](https://github.com/Mat4m0)! - Add refs as individual query arguments: `useConvexQuery(api.projects.get, { projectId })` with `projectId` from `toRefs(props)` now type-checks, also in `useConvexPaginatedQuery`.

## 1.0.0-rc.0

- First 1.0 release candidate, released together with
  `@lupinum/better-convex-nuxt` `1.0.0-rc.0`. The full notes are in the
  repository
  [CHANGELOG.md](https://github.com/lupinum-dev/better-convex/blob/main/CHANGELOG.md#v100-rc0).

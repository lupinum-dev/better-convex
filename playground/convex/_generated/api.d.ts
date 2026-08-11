/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as authConcurrency from "../authConcurrency.js";
import type * as files from "../files.js";
import type * as http from "../http.js";
import type * as lib_permissions from "../lib/permissions.js";
import type * as notes from "../notes.js";
import type * as posts from "../posts.js";
import type * as tasks from "../tasks.js";
import type * as testing from "../testing.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  authConcurrency: typeof authConcurrency;
  files: typeof files;
  http: typeof http;
  "lib/permissions": typeof lib_permissions;
  notes: typeof notes;
  posts: typeof posts;
  tasks: typeof tasks;
  testing: typeof testing;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("better-convex-nuxt/convex-auth/_generated/component.js").ComponentApi<"betterAuth">;
};

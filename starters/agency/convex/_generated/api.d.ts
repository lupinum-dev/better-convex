/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as access from "../access.js";
import type * as audit from "../audit.js";
import type * as auth from "../auth.js";
import type * as clientProjects from "../clientProjects.js";
import type * as http from "../http.js";
import type * as organizationLinks from "../organizationLinks.js";
import type * as organizations from "../organizations.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  access: typeof access;
  audit: typeof audit;
  auth: typeof auth;
  clientProjects: typeof clientProjects;
  http: typeof http;
  organizationLinks: typeof organizationLinks;
  organizations: typeof organizations;
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

/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as approvals from "../approvals.js";
import type * as auth from "../auth.js";
import type * as http from "../http.js";
import type * as mcp from "../mcp.js";
import type * as mcp_policy from "../mcp/policy.js";
import type * as mcpAdmin from "../mcpAdmin.js";
import type * as mcpOAuthAdmin from "../mcpOAuthAdmin.js";
import type * as mcpOAuthEvidence from "../mcpOAuthEvidence.js";
import type * as mcpTools from "../mcpTools.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  approvals: typeof approvals;
  auth: typeof auth;
  http: typeof http;
  mcp: typeof mcp;
  "mcp/policy": typeof mcp_policy;
  mcpAdmin: typeof mcpAdmin;
  mcpOAuthAdmin: typeof mcpOAuthAdmin;
  mcpOAuthEvidence: typeof mcpOAuthEvidence;
  mcpTools: typeof mcpTools;
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

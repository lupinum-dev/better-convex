/* eslint-disable */
/**
 * Generated `ComponentApi` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type { FunctionReference } from "convex/server";

/**
 * A utility for referencing a Convex component's exposed API.
 *
 * Useful when expecting a parameter like `components.myComponent`.
 * Usage:
 * ```ts
 * async function myFunction(ctx: QueryCtx, component: ComponentApi) {
 *   return ctx.runQuery(component.someFile.someQuery, { ...args });
 * }
 * ```
 */
export type ComponentApi<Name extends string | undefined = string | undefined> =
  {
    adapter: {
      assertProfile: FunctionReference<
        "query",
        "internal",
        { workforce: boolean },
        null,
        Name
      >;
      consumeOne: FunctionReference<
        "mutation",
        "internal",
        {
          model: string;
          onDeleteHandle?: string;
          onDeleteModels?: Array<string>;
          onUpdateHandle?: string;
          onUpdateModels?: Array<string>;
          where: Array<{
            connector?: "AND" | "OR";
            field: string;
            mode?: "sensitive" | "insensitive";
            operator?:
              | "lt"
              | "lte"
              | "gt"
              | "gte"
              | "eq"
              | "in"
              | "not_in"
              | "ne"
              | "contains"
              | "starts_with"
              | "ends_with";
            value:
              string | number | boolean | Array<string> | Array<number> | null;
          }>;
        },
        Record<
          string,
          string | number | boolean | Array<string> | Array<number> | null
        > | null,
        Name
      >;
      count: FunctionReference<
        "query",
        "internal",
        {
          model: string;
          where?: Array<{
            connector?: "AND" | "OR";
            field: string;
            mode?: "sensitive" | "insensitive";
            operator?:
              | "lt"
              | "lte"
              | "gt"
              | "gte"
              | "eq"
              | "in"
              | "not_in"
              | "ne"
              | "contains"
              | "starts_with"
              | "ends_with";
            value:
              string | number | boolean | Array<string> | Array<number> | null;
          }>;
        },
        number,
        Name
      >;
      create: FunctionReference<
        "mutation",
        "internal",
        {
          data: any;
          model: string;
          onCreateHandle?: string;
          workforce?:
            | {
                expectedGeneration: number;
                operation:
                  | "begin-enrollment"
                  | "confirm-enrollment"
                  | "regenerate-backup-codes"
                  | "change-password";
                replay?: {
                  digest: string;
                  factorFingerprint: string;
                  factorId: string;
                  matchingCounters: Array<number>;
                  userId: string;
                };
                sessionId: string;
                userId: string;
              }
            | {
                expectedGeneration: number;
                operation: "password-sign-in";
                userId: string;
              }
            | {
                challengeId: string;
                expectedGeneration: number;
                operation: "password-challenge";
                userId: string;
              }
            | {
                challengeId: string;
                expectedGeneration: number;
                operation: "totp-sign-in" | "recovery-sign-in";
                replay?: {
                  digest: string;
                  factorFingerprint: string;
                  factorId: string;
                  matchingCounters: Array<number>;
                  userId: string;
                };
                userId: string;
              };
          workforceConsumedChallenge?: {
            challengeId: string;
            expectedGeneration: number;
            expiresAt: number;
            operation: "totp-sign-in" | "recovery-sign-in";
            userId: string;
          };
        },
        Record<
          string,
          string | number | boolean | Array<string> | Array<number> | null
        >,
        Name
      >;
      deleteMany: FunctionReference<
        "mutation",
        "internal",
        {
          model: string;
          onDeleteHandle?: string;
          onDeleteModels?: Array<string>;
          onUpdateHandle?: string;
          onUpdateModels?: Array<string>;
          where: Array<{
            connector?: "AND" | "OR";
            field: string;
            mode?: "sensitive" | "insensitive";
            operator?:
              | "lt"
              | "lte"
              | "gt"
              | "gte"
              | "eq"
              | "in"
              | "not_in"
              | "ne"
              | "contains"
              | "starts_with"
              | "ends_with";
            value:
              string | number | boolean | Array<string> | Array<number> | null;
          }>;
        },
        number,
        Name
      >;
      deleteOne: FunctionReference<
        "mutation",
        "internal",
        {
          model: string;
          onDeleteHandle?: string;
          onDeleteModels?: Array<string>;
          onUpdateHandle?: string;
          onUpdateModels?: Array<string>;
          where: Array<{
            connector?: "AND" | "OR";
            field: string;
            mode?: "sensitive" | "insensitive";
            operator?:
              | "lt"
              | "lte"
              | "gt"
              | "gte"
              | "eq"
              | "in"
              | "not_in"
              | "ne"
              | "contains"
              | "starts_with"
              | "ends_with";
            value:
              string | number | boolean | Array<string> | Array<number> | null;
          }>;
        },
        Record<
          string,
          string | number | boolean | Array<string> | Array<number> | null
        > | null,
        Name
      >;
      findMany: FunctionReference<
        "query",
        "internal",
        {
          join?: any;
          limit?: number;
          model: string;
          offset?: number;
          paginationOpts: {
            cursor: string | null;
            endCursor?: string | null;
            id?: number;
            maximumBytesRead?: number;
            maximumRowsRead?: number;
            numItems: number;
          };
          select?: Array<string>;
          sortBy?: { direction: "asc" | "desc"; field: string };
          where?: Array<{
            connector?: "AND" | "OR";
            field: string;
            mode?: "sensitive" | "insensitive";
            operator?:
              | "lt"
              | "lte"
              | "gt"
              | "gte"
              | "eq"
              | "in"
              | "not_in"
              | "ne"
              | "contains"
              | "starts_with"
              | "ends_with";
            value:
              string | number | boolean | Array<string> | Array<number> | null;
          }>;
        },
        {
          continueCursor: string;
          isDone: boolean;
          page: Array<
            Record<
              string,
              string | number | boolean | Array<string> | Array<number> | null
            >
          >;
          pageStatus?: "SplitRecommended" | "SplitRequired" | null;
          splitCursor?: string | null;
        },
        Name
      >;
      findOne: FunctionReference<
        "query",
        "internal",
        {
          join?: any;
          model: string;
          offset?: number;
          select?: Array<string>;
          sortBy?: { direction: "asc" | "desc"; field: string };
          where?: Array<{
            connector?: "AND" | "OR";
            field: string;
            mode?: "sensitive" | "insensitive";
            operator?:
              | "lt"
              | "lte"
              | "gt"
              | "gte"
              | "eq"
              | "in"
              | "not_in"
              | "ne"
              | "contains"
              | "starts_with"
              | "ends_with";
            value:
              string | number | boolean | Array<string> | Array<number> | null;
          }>;
          workforce?:
            | {
                expectedGeneration: number;
                operation:
                  | "begin-enrollment"
                  | "confirm-enrollment"
                  | "regenerate-backup-codes"
                  | "change-password";
                replay?: {
                  digest: string;
                  factorFingerprint: string;
                  factorId: string;
                  matchingCounters: Array<number>;
                  userId: string;
                };
                sessionId: string;
                userId: string;
              }
            | {
                expectedGeneration: number;
                operation: "password-sign-in";
                userId: string;
              }
            | {
                challengeId: string;
                expectedGeneration: number;
                operation: "password-challenge";
                userId: string;
              }
            | {
                challengeId: string;
                expectedGeneration: number;
                operation: "totp-sign-in" | "recovery-sign-in";
                replay?: {
                  digest: string;
                  factorFingerprint: string;
                  factorId: string;
                  matchingCounters: Array<number>;
                  userId: string;
                };
                userId: string;
              };
        },
        Record<
          string,
          string | number | boolean | Array<string> | Array<number> | null
        > | null,
        Name
      >;
      incrementOne: FunctionReference<
        "mutation",
        "internal",
        {
          increment: any;
          model: string;
          onUpdateHandle?: string;
          set?: any;
          where: Array<{
            connector?: "AND" | "OR";
            field: string;
            mode?: "sensitive" | "insensitive";
            operator?:
              | "lt"
              | "lte"
              | "gt"
              | "gte"
              | "eq"
              | "in"
              | "not_in"
              | "ne"
              | "contains"
              | "starts_with"
              | "ends_with";
            value:
              string | number | boolean | Array<string> | Array<number> | null;
          }>;
          workforce?:
            | {
                expectedGeneration: number;
                operation:
                  | "begin-enrollment"
                  | "confirm-enrollment"
                  | "regenerate-backup-codes"
                  | "change-password";
                replay?: {
                  digest: string;
                  factorFingerprint: string;
                  factorId: string;
                  matchingCounters: Array<number>;
                  userId: string;
                };
                sessionId: string;
                userId: string;
              }
            | {
                expectedGeneration: number;
                operation: "password-sign-in";
                userId: string;
              }
            | {
                challengeId: string;
                expectedGeneration: number;
                operation: "password-challenge";
                userId: string;
              }
            | {
                challengeId: string;
                expectedGeneration: number;
                operation: "totp-sign-in" | "recovery-sign-in";
                replay?: {
                  digest: string;
                  factorFingerprint: string;
                  factorId: string;
                  matchingCounters: Array<number>;
                  userId: string;
                };
                userId: string;
              };
        },
        Record<
          string,
          string | number | boolean | Array<string> | Array<number> | null
        > | null,
        Name
      >;
      listWorkforceSessions: FunctionReference<
        "query",
        "internal",
        {
          actor: { sessionId: string; userId: string };
          paginationOpts: { cursor: string | null; numItems: number };
        },
        {
          continueCursor: string;
          isDone: boolean;
          page: Array<{
            authenticatedAt: number;
            expiresAt: number;
            isCurrent: boolean;
            method:
              | "password-only"
              | "totp-enrollment"
              | "password-totp"
              | "password-recovery";
            sessionId: string;
            sessionStartedAt: number;
          }>;
        },
        Name
      >;
      revokeAllWorkforceSessions: FunctionReference<
        "mutation",
        "internal",
        { actor: { sessionId: string; userId: string } },
        null,
        Name
      >;
      revokeWorkforceSession: FunctionReference<
        "mutation",
        "internal",
        { actor: { sessionId: string; userId: string }; sessionId: string },
        null,
        Name
      >;
      rotateSigningKey: FunctionReference<
        "mutation",
        "internal",
        {
          next: {
            alg: "RS256";
            crv: null;
            id: string;
            privateKey: string;
            publicKey: string;
          };
          onlyIfEmpty?: boolean;
        },
        {
          created?: boolean;
          createdAt: number;
          newKid: string;
          previousKids: Array<string>;
          previousVerifyUntil: number;
          rotatedAt: number;
        },
        Name
      >;
      sessionAdmission: FunctionReference<
        "query",
        "internal",
        { sessionId: string; userId?: string },
        {
          session: Record<
            string,
            string | number | boolean | Array<string> | Array<number> | null
          >;
          user: Record<
            string,
            string | number | boolean | Array<string> | Array<number> | null
          >;
        } | null,
        Name
      >;
      touchWorkforceSession: FunctionReference<
        "mutation",
        "internal",
        { actor: { sessionId: string; userId: string } },
        { expiresAt: number },
        Name
      >;
      updateMany: FunctionReference<
        "mutation",
        "internal",
        {
          model: string;
          onUpdateHandle?: string;
          update: any;
          where: Array<{
            connector?: "AND" | "OR";
            field: string;
            mode?: "sensitive" | "insensitive";
            operator?:
              | "lt"
              | "lte"
              | "gt"
              | "gte"
              | "eq"
              | "in"
              | "not_in"
              | "ne"
              | "contains"
              | "starts_with"
              | "ends_with";
            value:
              string | number | boolean | Array<string> | Array<number> | null;
          }>;
        },
        number,
        Name
      >;
      updateOne: FunctionReference<
        "mutation",
        "internal",
        {
          model: string;
          onUpdateHandle?: string;
          update: any;
          where: Array<{
            connector?: "AND" | "OR";
            field: string;
            mode?: "sensitive" | "insensitive";
            operator?:
              | "lt"
              | "lte"
              | "gt"
              | "gte"
              | "eq"
              | "in"
              | "not_in"
              | "ne"
              | "contains"
              | "starts_with"
              | "ends_with";
            value:
              string | number | boolean | Array<string> | Array<number> | null;
          }>;
          workforce?:
            | {
                expectedGeneration: number;
                operation:
                  | "begin-enrollment"
                  | "confirm-enrollment"
                  | "regenerate-backup-codes"
                  | "change-password";
                replay?: {
                  digest: string;
                  factorFingerprint: string;
                  factorId: string;
                  matchingCounters: Array<number>;
                  userId: string;
                };
                sessionId: string;
                userId: string;
              }
            | {
                expectedGeneration: number;
                operation: "password-sign-in";
                userId: string;
              }
            | {
                challengeId: string;
                expectedGeneration: number;
                operation: "password-challenge";
                userId: string;
              }
            | {
                challengeId: string;
                expectedGeneration: number;
                operation: "totp-sign-in" | "recovery-sign-in";
                replay?: {
                  digest: string;
                  factorFingerprint: string;
                  factorId: string;
                  matchingCounters: Array<number>;
                  userId: string;
                };
                userId: string;
              };
        },
        Record<
          string,
          string | number | boolean | Array<string> | Array<number> | null
        > | null,
        Name
      >;
    };
  };

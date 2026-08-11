import type { ConvexAuthMode } from '../utils/auth-status'
import type { ConvexUser } from '../utils/types'
/**
 * DevTools types and interfaces.
 */

export type { ConvexUser } from '../utils/types'

export type QueryStatus = 'pending' | 'success' | 'error' | 'idle'

export interface QueryRegistryEntry {
  id: string
  name: string
  args: unknown
  status: QueryStatus
  data: unknown
  error?: string
  lastUpdated: number
  options?: {
    immediate: boolean
    server: boolean
    subscribe: boolean
    auth: ConvexAuthMode
  }
}

// ============================================================================
// Mutation Types
// ============================================================================

export type MutationState = 'optimistic' | 'pending' | 'success' | 'error'

export interface MutationEntry {
  /** Unique identifier (generated UUID) */
  id: string
  /** Function name (e.g., "api.notes.create") */
  name: string
  /** Operation type */
  type: 'mutation' | 'action'
  /** Operation arguments */
  args: unknown
  /** Current state in lifecycle */
  state: MutationState
  /** Whether this mutation has an optimistic update */
  hasOptimisticUpdate: boolean
  /** Timestamp when mutation was initiated */
  startedAt: number
  /** Timestamp when mutation settled (success/error) */
  settledAt?: number
  /** Duration in ms (settledAt - startedAt) */
  duration?: number
  /** Result data on success */
  result?: unknown
  /** Error message on failure */
  error?: string
}

// ============================================================================
// JWT and Auth Types
// ============================================================================

export interface JWTClaims {
  /** Subject (user ID) */
  sub?: string
  /** Issued at timestamp (seconds) */
  iat?: number
  /** Expiration timestamp (seconds) */
  exp?: number
  /** Issuer */
  iss?: string
  /** Audience */
  aud?: string | string[]
  /** Any additional claims */
  [key: string]: unknown
}

// ============================================================================
// User and Auth State Types
// ============================================================================

export interface AuthState {
  isAuthenticated: boolean
  isPending: boolean
  user: ConvexUser | null
  tokenStatus: 'valid' | 'expired' | 'none' | 'unknown'
}

export interface EnhancedAuthState extends AuthState {
  /** Decoded JWT claims */
  claims?: JWTClaims
  /** Token issued at timestamp (ms) */
  issuedAt?: number
  /** Token expiration timestamp (ms) */
  expiresAt?: number
  /** Seconds until token expires */
  expiresInSeconds?: number
}

// ============================================================================
// Connection State Types
// ============================================================================

export interface ConnectionState {
  isConnected: boolean
  hasEverConnected: boolean
  connectionRetries: number
  inflightRequests: number
}

// ============================================================================
// Auth Waterfall Types (SSR Performance Debugging)
// ============================================================================

export type WaterfallPhaseResult = 'hit' | 'miss' | 'success' | 'error' | 'skipped'

export interface AuthWaterfallPhase {
  /** Phase name (e.g., "session-check", "cache-lookup", "token-exchange") */
  name: string
  /** Start time relative to waterfall start (ms) */
  start: number
  /** End time relative to waterfall start (ms) */
  end: number
  /** Duration in ms */
  duration: number
  /** Result of this phase */
  result: WaterfallPhaseResult
  /** Optional details (e.g., cache key, status code) */
  details?: string
}

export interface AuthWaterfall {
  /** Unique request identifier */
  requestId: string
  /** Timestamp when this waterfall was captured */
  timestamp: number
  /** Ordered list of phases in the auth flow */
  phases: AuthWaterfallPhase[]
  /** Total duration of all phases (ms) */
  totalDuration: number
  /** Final outcome of the auth check */
  outcome: 'authenticated' | 'unauthenticated' | 'error'
  /** Whether the auth token was served from cache */
  cacheHit: boolean
  /** Error message if outcome is 'error' */
  error?: string
}

// ============================================================================
// Auth Proxy Types (Dev Mode Debugging)
// ============================================================================

export interface AuthProxyRequest {
  /** Unique request ID */
  id: string
  /** Target path (e.g., "/convex/token", "/get-session") */
  path: string
  /** HTTP method */
  method: string
  /** Request timestamp */
  timestamp: number
  /** Response status code */
  status?: number
  /** Duration in ms */
  duration?: number
  /** Whether request succeeded */
  success?: boolean
}

export interface AuthProxyStats {
  /** Total requests made */
  totalRequests: number
  /** Successful requests */
  successCount: number
  /** Failed requests */
  errorCount: number
  /** Average response time (ms) */
  avgDuration: number
  /** Recent requests (last 20) */
  recentRequests: AuthProxyRequest[]
}

// ============================================================================
// DevTools Bridge Interface
// ============================================================================

export interface ConvexDevToolsBridge {
  /** Get all active queries */
  getQueries: () => QueryRegistryEntry[]
  /** Get a specific query by ID for detail view */
  getQueryDetail: (id: string) => QueryRegistryEntry | undefined
  /** Subscribe to query updates */
  subscribeToQueries: (callback: (queries: QueryRegistryEntry[]) => void) => () => void
  /** Get all mutation entries */
  getMutations: () => MutationEntry[]
  /** Subscribe to mutation updates */
  subscribeToMutations: (callback: (mutations: MutationEntry[]) => void) => () => void
  /** Get auth state */
  getAuthState: () => AuthState
  /** Get enhanced auth state with JWT claims */
  getEnhancedAuthState: () => EnhancedAuthState
  /** Get connection state */
  getConnectionState: () => ConnectionState
  /** Get the most recent auth waterfall (SSR timing data) */
  getAuthWaterfall: () => AuthWaterfall | null
  /** Get auth proxy stats (dev mode only) */
  getAuthProxyStats: () => Promise<AuthProxyStats | null>
  /** Version of the bridge API */
  version: string
}

export {}

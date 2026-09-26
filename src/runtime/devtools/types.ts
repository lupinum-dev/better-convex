import type { ConvexAuthMode } from '../utils/auth-status'
import type { ConvexUser } from '../utils/types'
/**
 * DevTools types and interfaces.
 */

export type { ConvexUser } from '../utils/types'

export type QueryStatus = 'pending' | 'success' | 'error' | 'idle'

export interface QueryRegistryEntry {
  /** Unique controller instance. Identical subscriptions still have different IDs. */
  id: string
  /** Stable query/cache identity shared by equivalent controller instances. */
  logicalKey: string
  name: string
  args: unknown
  status: QueryStatus
  data: unknown
  error?: string
  lastUpdated: number
  options?: {
    immediate: boolean
    lazy: boolean
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
// User and Auth State Types
// ============================================================================

export interface AuthState {
  isAuthenticated: boolean
  pending: boolean
  user: ConvexUser | null
  tokenStatus: 'valid' | 'expired' | 'none' | 'unknown'
}

export interface EnhancedAuthState extends AuthState {
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

export type WaterfallPhaseResult = 'miss' | 'success' | 'error'

export interface AuthWaterfallPhase {
  /** Phase name (e.g., "session-check", "token-exchange", "jwt-decode") */
  name: string
  /** Start time relative to waterfall start (ms) */
  start: number
  /** End time relative to waterfall start (ms) */
  end: number
  /** Duration in ms */
  duration: number
  /** Result of this phase */
  result: WaterfallPhaseResult
  /** Optional details (e.g., status code) */
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

/** Methods the DevTools UI can call on the app through the bridge transport. */
export interface ConvexDevToolsBridge {
  /** Get all active queries */
  getQueries: () => QueryRegistryEntry[]
  /** Get all mutation entries */
  getMutations: () => MutationEntry[]
  /** Get auth state with bounded token timing */
  getEnhancedAuthState: () => EnhancedAuthState
  /** Get connection state */
  getConnectionState: () => ConnectionState
  /** Get the most recent auth waterfall (SSR timing data) */
  getAuthWaterfall: () => AuthWaterfall | null
}

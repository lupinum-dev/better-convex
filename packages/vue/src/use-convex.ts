import { useBetterConvexRuntime } from './runtime-context'

export function useConvex() {
  return useBetterConvexRuntime().browser.handle
}

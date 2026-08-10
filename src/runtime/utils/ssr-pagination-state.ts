export function isIncompletePaginationPage(
  page: { pageStatus?: 'SplitRecommended' | 'SplitRequired' | null } | null | undefined,
): boolean {
  return page?.pageStatus === 'SplitRequired'
}

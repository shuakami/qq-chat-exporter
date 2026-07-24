export function canLoadNextMessagePage(
  currentPage: number,
  totalPages: number,
  hasNext: boolean,
): boolean {
  return currentPage < totalPages || hasNext
}

export const LOCAL_USER_SEARCH_MAX_CODE_POINTS = 200;

export function isLocalUserSearchTermTooLong(term: string): boolean {
  let codePoints = 0;
  for (const _character of term) {
    codePoints += 1;
    if (codePoints > LOCAL_USER_SEARCH_MAX_CODE_POINTS) return true;
  }
  return false;
}

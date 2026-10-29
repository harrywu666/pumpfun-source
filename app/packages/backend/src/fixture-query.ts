export function hasValidQueryEncoding(query: string): boolean {
  try {
    // URLSearchParams repairs malformed UTF-8 and preserves malformed percent
    // escapes, which makes distinct wire inputs alias valid fixtures.
    decodeURIComponent(query);
    return true;
  } catch {
    return false;
  }
}

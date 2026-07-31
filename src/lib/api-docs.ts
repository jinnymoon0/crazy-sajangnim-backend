/*
 * The API reference describes an authenticated internal service, so it
 * is served only where it is useful: in development, or in production
 * when ENABLE_API_DOCS is set. Both the viewer and the spec itself
 * honour this.
 */
export function apiDocsEnabled(): boolean {
  if (process.env.NODE_ENV !== "production") {
    return true;
  }

  return process.env.ENABLE_API_DOCS === "true";
}

/*
 * The API reference is served at the service root, so that opening the
 * backend shows what it can do.
 *
 * It describes the shape of the API, not its data: every endpoint it
 * lists still needs the service token, and the document itself carries
 * no secrets. Set ENABLE_API_DOCS=false on a deployment that should
 * keep its API surface private — the viewer and the document both stop
 * answering.
 */
export function apiDocsEnabled(): boolean {
  return process.env.ENABLE_API_DOCS !== "false";
}

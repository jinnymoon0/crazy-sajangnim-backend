import { NextResponse } from "next/server";

/*
 * The service is called server-to-server by the frontend, never by a
 * browser, so a shared bearer token is enough. When BACKEND_API_TOKEN
 * is unset the check is skipped, which keeps local development simple.
 */
export function isAuthorizedService(request: Request): boolean {
  const expected = process.env.BACKEND_API_TOKEN?.trim();

  if (!expected) {
    return true;
  }

  const header = request.headers.get("authorization") ?? "";

  return header === `Bearer ${expected}`;
}

export function unauthorizedResponse(): NextResponse {
  return NextResponse.json(
    { error: "Unauthorized." },
    { status: 401 },
  );
}

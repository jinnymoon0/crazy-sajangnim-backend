import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

/*
 * The service is called server-to-server by the frontend and the admin,
 * never by a browser, so a shared bearer token is enough.
 *
 * With no token configured the check is skipped — but only when running
 * locally. It used to be skipped everywhere, which meant a deployment
 * that lost BACKEND_API_TOKEN, through a typo or a cleared variable,
 * served every endpoint to anyone who asked: the catalog writes, the
 * brand deletion, all of it. Authentication that switches itself off
 * when its configuration goes missing is worse than none, because
 * nothing looks wrong from the outside.
 */
function isDeployed(): boolean {
  return Boolean(process.env.VERCEL) || process.env.NODE_ENV === "production";
}

/*
 * Compare without leaking, through timing, how much of the token was
 * right. A plain === returns as soon as two bytes differ, so the time
 * taken says where the first mistake was, and a token can be recovered
 * a byte at a time.
 *
 * Lengths are handled separately because timingSafeEqual throws when
 * they differ; a wrong-length token still pays for a comparison so it
 * cannot be told apart by returning sooner.
 */
function tokensMatch(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);

  if (a.length !== b.length) {
    timingSafeEqual(a, a);

    return false;
  }

  return timingSafeEqual(a, b);
}

export function isAuthorizedService(request: Request): boolean {
  const expected = process.env.BACKEND_API_TOKEN?.trim();

  if (!expected) {
    if (isDeployed()) {
      console.error(
        "BACKEND_API_TOKEN is not set: refusing every request rather than serving the API unauthenticated.",
      );

      return false;
    }

    return true;
  }

  const header = request.headers.get("authorization") ?? "";

  if (!header.startsWith("Bearer ")) {
    return false;
  }

  return tokensMatch(header.slice("Bearer ".length), expected);
}

export function unauthorizedResponse(): NextResponse {
  return NextResponse.json(
    { error: "Unauthorized." },
    { status: 401 },
  );
}

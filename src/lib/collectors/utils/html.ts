export async function fetchPublicHtml(
  url: string,
): Promise<string> {
  const response = await fetch(url, {
    headers: {
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.7",
      "User-Agent":
        process.env.COLLECTOR_USER_AGENT ??
        "CrazySajangnimBot/1.0",
    },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(
      `${url} returned HTTP ${response.status}`,
    );
  }

  return response.text();
}

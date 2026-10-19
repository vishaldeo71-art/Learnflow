const RETRY_DELAYS = [350, 1100];

export class ConnectionError extends Error {
  constructor() {
    super("The connection was interrupted. Your saved lesson is still available. Please try again in a moment.");
    this.name = "ConnectionError";
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method || "GET").toUpperCase();
  // Reads and cached video imports can recover automatically. Never replay a question,
  // upload, interview turn, or other write after an ambiguous network failure.
  const canRetry = method === "GET" || (method === "POST" && path === "v1/videos/youtube/import");
  const attempts = canRetry ? RETRY_DELAYS.length + 1 : 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    let response: Response;
    let text: string;
    try {
      response = await fetch(`/api/${path.replace(/^\//, "")}`, { ...init, credentials: "same-origin", cache: "no-store" });
      text = await response.text();
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw error;
      if (attempt + 1 < attempts) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS[attempt]));
        continue;
      }
      throw new ConnectionError();
    }
    if (canRetry && [502, 503, 504].includes(response.status) && attempt + 1 < attempts) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS[attempt]));
      continue;
    }
    let data: { detail?: string };
    try { data = JSON.parse(text); }
    catch { throw new Error("The server returned an unreadable response. Please try again."); }
    if (data === null || typeof data !== "object") throw new Error("The server returned an unreadable response. Please try again.");
    if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : `The request could not be completed (${response.status}).`);
    return data as T;
  }
  throw new ConnectionError();
}

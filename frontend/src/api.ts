export type ModelResponse = {
  id: string;
  model: string;
  text: string;
  error: string | null;
  latency_ms: number;
};
export type Comparison = {
  id: string;
  prompt: string;
  created_at: string;
  responses: ModelResponse[];
  voted_response_id: string | null;
};
export type Leaderboard = {
  total_votes: number;
  models: { model: string; wins: number; vote_percentage: number }[];
};
const base = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
export function browserId(): string {
  const saved = localStorage.getItem("llm-browser-id");
  if (
    saved &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      saved,
    )
  )
    return saved;
  const id = crypto.randomUUID();
  localStorage.setItem("llm-browser-id", id);
  return id;
}
export async function request<T>(path: string, body?: unknown): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 75000);
  try {
    const response = await fetch(`${base}/api${path}`, {
      signal: controller.signal,
      ...(body
        ? {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        : {}),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok)
      throw new Error(
        typeof data?.detail === "string"
          ? data.detail
          : "The server could not complete the request. Please try again shortly.",
      );
    if (data === null)
      throw new Error(
        "The server returned an invalid response. Please try again shortly.",
      );
    return data as T;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError")
      throw new Error(
        "Request timed out. Check history before submitting again.",
      );
    if (error instanceof TypeError)
      throw new Error("Cannot reach the server. Please try again shortly.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

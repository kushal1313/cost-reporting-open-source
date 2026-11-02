const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    // Only declare JSON when there is a body: Fastify rejects a request whose
    // Content-Type is application/json but whose body is empty (e.g. DELETE).
    headers: { ...(init?.body !== undefined && { "Content-Type": "application/json" }), ...init?.headers },
  });
  if (!res.ok) {
    const text = await res.text();
    // Routes answer failures with { error: "…" } meant for people; show just that when present.
    let message: unknown;
    try {
      message = (JSON.parse(text) as { error?: unknown }).error;
    } catch {
      // not JSON
    }
    throw new Error(
      typeof message === "string"
        ? message
        : `${init?.method ?? "GET"} ${path} failed: ${res.status} ${text}`,
    );
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) => request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  del: (path: string) => request<void>(path, { method: "DELETE" }),
};

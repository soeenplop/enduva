// Orval mutator: every generated call goes through here (base URL + auth on server and client).
const baseUrl = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:3001';

export async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set('Authorization', 'Bearer spike-token');
  const res = await fetch(new URL(url, baseUrl), { ...init, headers });
  const data: unknown = res.status === 204 ? undefined : await res.json();
  return { data, status: res.status, headers: res.headers } as T;
}

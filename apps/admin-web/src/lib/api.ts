const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";
const headers = { "Content-Type": "application/json", "x-role": "PLATFORM_ADMIN", "x-building-id": "bld_001" };
export async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(API_URL + path, { headers });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(API_URL + path, { method: "POST", headers, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

import { setTimeout } from "node:timers/promises";

export type Session = { accessToken: string; refreshToken: string; user: { id: string; role: string } };

/** Fixture setup obeys the real shared HTTP budget. Throttling assertions use
 * raw fetch/call instead, so a 429 is never hidden from the behavior under test. */
export async function login(url: string, email: string, password = "predioon123"): Promise<Session> {
  const response = await admittedFixtureLogin(() => fetch(`${url}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  }), email);
  return await response.json() as Session;
}

/** Preserve the admitted response and its cookie headers for web fixtures too. */
export async function admittedFixtureLogin(request: () => Promise<Response>, label: string): Promise<Response> {
  const deadline = Date.now() + 60_000;
  for (let attempt = 0; ; attempt++) {
    const response = await request();
    if (response.ok) return response;
    const retry = response.headers.get("retry-after") ?? "";
    const delay = /^[1-9][0-9]*$/.test(retry) ? Number(retry) * 1000 : Infinity;
    await response.body?.cancel();
    if (response.status !== 429 || attempt >= 3 || !Number.isSafeInteger(delay)
      || Date.now() + delay > deadline) {
      throw new Error(`Login falhou para ${label}: ${response.status}`);
    }
    await setTimeout(delay);
  }
}

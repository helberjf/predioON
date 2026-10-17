import assert from "node:assert/strict";
import test from "node:test";
import { acceptInvitation, ApiError, previewInvitation } from "../src/index.ts";

const preview = { email: "morador@example.test", name: "Morador", buildingName: "Residencial", accountExists: false, expiresAt: "2026-10-20T12:00:00.000Z" };
const json = (status: number, body: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

test("preview sends only the trimmed code, without credentials, and returns only the known fields", async () => {
  const cancel = new AbortController();
  const result = await previewInvitation({ baseUrl: "https://api.example.test/", fetch: async (url, init) => {
    assert.equal(url, "https://api.example.test/auth/invitations/preview");
    assert.equal(init?.method, "POST"); assert.equal(init?.credentials, "omit");
    assert.equal(init?.cache, "no-store"); assert.equal(init?.redirect, "error");
    assert.deepEqual(JSON.parse(String(init?.body)), { token: "abc123" });
    assert.equal(init?.signal, cancel.signal);
    return json(200, { ...preview, internalId: "never-exposed" });
  } }, "  abc123 ", cancel.signal);
  assert.deepEqual(result, preview);
});

test("accept sends code and password and requires 204", async () => {
  await acceptInvitation({ baseUrl: "https://api.example.test", fetch: async (url, init) => {
    assert.equal(url, "https://api.example.test/auth/invitations/accept");
    assert.deepEqual(JSON.parse(String(init?.body)), { token: "abc123", password: "uma senha bem longa" });
    return new Response(null, { status: 204 });
  } }, "abc123", "uma senha bem longa");
  await assert.rejects(acceptInvitation({ baseUrl: "https://api.example.test", fetch: async () => json(200, {}) }, "abc123", "x"),
    (error: unknown) => error instanceof ApiError && error.code === "INVALID_RESPONSE");
});

test("API messages are kept, throttling and network failures are explained, malformed previews refused", async () => {
  const reject = async (response: Response | Error, message: string, status: number) => assert.rejects(
    previewInvitation({ baseUrl: "https://api.example.test", fetch: async () => { if (response instanceof Error) throw response; return response; } }, "abc"),
    (error: unknown) => error instanceof ApiError && error.message === message && error.status === status);
  await reject(json(404, { error: "Convite inválido, expirado ou já utilizado" }), "Convite inválido, expirado ou já utilizado", 404);
  await reject(json(429, { error: "slow down" }), "Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.", 429);
  await reject(json(503, { error: "x".repeat(500) }), "Não foi possível concluir. Tente novamente.", 503);
  await reject(new Error("offline"), "Sem conexão com o servidor. Tente novamente.", 0);
  await reject(json(200, { ...preview, accountExists: "no" }), "A API retornou uma resposta inválida.", 200);
});

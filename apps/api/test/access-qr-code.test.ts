import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GATE_QR_GRACE_MS, GATE_QR_WINDOW_MS, formatGateQr, parseGateQr, GatePatchSchema, OpenGateByQrSchema, TotemPairSchema } from "../../../packages/shared/src/access.js";
import { gateQrContent, gateQrWindow, totemCodes, verifyGateQr } from "../src/modules/access/qr-code.js";
import { newPairingCode, pairingCodeHash } from "../src/modules/access/totem-pairing.js";

const secret = "predioon-test-only-gate-qr-secret-0123456789";
const gate = "03d72b85-895c-41df-b3d4-f91ae9ed7822";
const other = "c3a4615e-0770-4b7c-b0d6-e4343e11cc30";
// 14:20 UTC on a fixed day: well inside one hour window.
const now = Date.UTC(2026, 9, 25, 14, 20);
const hour = gateQrWindow(now);
const qr = (content: string) => parseGateQr(content)!;

describe("QR do totem sem banco", () => {
  it("lê só o formato do Prédio ON, que não é URL", () => {
    const content = gateQrContent(gate, 1, hour, secret);
    assert.match(content, /^predioon-portao:v1:/);
    assert.deepEqual(parseGateQr(` ${content}\n`), { gateId: gate, window: hour, mac: qr(content).mac });
    assert.equal(formatGateQr(qr(content)), content);
    for (const text of ["https://morador.example.com/portao#abc", "predioon-portao:v2:" + content.slice(19), content + "x",
      content.replace(gate, gate.toUpperCase()), "", "predioon-portao:v1:not-a-uuid.1.aaaaaaaaaaaaaaaaaaaaaa"])
      assert.equal(parseGateQr(text), null, text);
  });

  it("vale na hora atual e na anterior só nos primeiros 5 minutos", () => {
    const current = qr(gateQrContent(gate, 1, hour, secret));
    assert.equal(verifyGateQr(current, 1, now, secret), true);
    const previous = qr(gateQrContent(gate, 1, hour - 1, secret));
    const turn = hour * GATE_QR_WINDOW_MS;
    assert.equal(verifyGateQr(previous, 1, turn + GATE_QR_GRACE_MS - 1, secret), true);
    assert.equal(verifyGateQr(previous, 1, turn + GATE_QR_GRACE_MS, secret), false);
    assert.equal(verifyGateQr(qr(gateQrContent(gate, 1, hour - 2, secret)), 1, turn + 1, secret), false);
  });

  it("recusa a hora seguinte antes de ela começar", () => {
    const next = qr(gateQrContent(gate, 1, hour + 1, secret));
    assert.equal(verifyGateQr(next, 1, now, secret), false);
    assert.equal(verifyGateQr(next, 1, (hour + 1) * GATE_QR_WINDOW_MS, secret), true);
  });

  it("renovar a geração, trocar de portão ou de chave invalida o QR", () => {
    const content = qr(gateQrContent(gate, 1, hour, secret));
    assert.equal(verifyGateQr(content, 2, now, secret), false);
    assert.equal(verifyGateQr({ ...content, gateId: other }, 1, now, secret), false);
    assert.equal(verifyGateQr(content, 1, now, `${secret}-rotated`), false);
    const tampered = content.mac.startsWith("A") ? "B" + content.mac.slice(1) : "A" + content.mac.slice(1);
    assert.equal(verifyGateQr({ ...content, mac: tampered }, 1, now, secret), false);
  });

  it("o totem recebe a hora atual e a próxima com a fronteira certa", () => {
    const codes = totemCodes(gate, 3, now, secret);
    const boundary = new Date((hour + 1) * GATE_QR_WINDOW_MS).toISOString();
    assert.equal(codes.current.validUntil, boundary);
    assert.equal(codes.next.validFrom, boundary);
    assert.equal(codes.current.content, gateQrContent(gate, 3, hour, secret));
    assert.equal(codes.next.content, gateQrContent(gate, 3, hour + 1, secret));
  });

  it("valida o corpo das rotas de QR e do pareamento", () => {
    const content = gateQrContent(gate, 1, hour, secret);
    assert.equal(OpenGateByQrSchema.safeParse({ content, requestId: other }).success, true);
    assert.equal(OpenGateByQrSchema.safeParse({ content: "texto qualquer", requestId: other }).success, false);
    assert.equal(OpenGateByQrSchema.safeParse({ content, requestId: other, gateId: gate }).success, false);
    assert.equal(TotemPairSchema.safeParse({ pairingCode: "ABCDE-FGHIJ", label: "Tablet da garagem" }).success, true);
    assert.equal(TotemPairSchema.safeParse({ pairingCode: "ABCDE-FGHIJ", label: "x" }).success, false);
    assert.deepEqual(GatePatchSchema.parse({ name: "Garagem" }), { name: "Garagem" }, "PATCH não muda a exigência de QR sem pedir");
  });

  it("o código de pareamento tem 10 caracteres e tolera caixa, espaço e hífen", () => {
    const code = newPairingCode();
    assert.match(code, /^[A-Z2-7]{5}-[A-Z2-7]{5}$/);
    const hash = pairingCodeHash(code)!;
    assert.equal(hash.length, 32);
    assert.deepEqual(pairingCodeHash(` ${code.toLowerCase().replace("-", " ")} `), hash);
    for (const text of ["ABCDE-FGHI", "ABCDE-FGHIJK", "ABCDE-FGH1J", "ABCDE_FGHIJ"]) assert.equal(pairingCodeHash(text), null, text);
  });
});

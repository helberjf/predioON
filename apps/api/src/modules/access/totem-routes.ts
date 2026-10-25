// The totem tablet has no user session. It proves possession of a token issued
// once by pairing, and that token only lets it draw the QR of one gate; opening
// still needs a resident's own session in the app.
import { Router, type Request, type Response } from "express";
import { sql } from "drizzle-orm";
import { identityDb as db } from "@predioon/db/identity";
import { TotemPairSchema, type TotemDisplay } from "@predioon/shared";
import { takeLoginBudget } from "../../auth/login-budget.js";
import { createOpaqueToken, hashOpaqueToken } from "../../auth/opaque-token.js";
import { badRequest, HttpError, unauthorized } from "../../http/errors.js";
import { gateQrSecret, totemCodes } from "./qr-code.js";
import { pairingCodeHash } from "./totem-pairing.js";

export const totemRouter = Router();
totemRouter.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });

const unpaired = () => unauthorized("Tablet não pareado ou despareado pela administração");

async function admit(res: Response, req: Request): Promise<void> {
  // Its own bucket per network, so guessing codes never blocks other condominiums' pairings.
  const retryAfter = await takeLoginBudget(`totem-pair:${req.ip ?? "unknown"}`, req.ip);
  if (retryAfter <= 0) return;
  res.setHeader("Retry-After", String(retryAfter));
  throw new HttpError(429, "Muitas tentativas. Aguarde e tente novamente.");
}

totemRouter.post("/pair", async (req, res) => {
  const parsed = TotemPairSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest("Informe o código de pareamento e um nome para o tablet");
  await admit(res, req);
  const candidate = pairingCodeHash(parsed.data.pairingCode);
  if (!candidate) throw badRequest("Código de pareamento inválido, expirado ou já utilizado");
  const { token, hash } = createOpaqueToken();
  const [row] = await db.execute<{ totem_id: string | null }>(
    sql`select public.identity_totem_pair(${candidate},${hash},${parsed.data.label}) as totem_id`);
  if (!row?.totem_id) throw badRequest("Código de pareamento inválido, expirado ou já utilizado");
  res.status(201).json({ token });
});

totemRouter.get("/display", async (req, res) => {
  const header = req.header("authorization");
  const hash = header?.startsWith("Totem ") ? hashOpaqueToken(header.slice(6)) : null;
  if (!hash) throw unpaired();
  const secret = gateQrSecret();
  const rows = await db.execute<{ gate_id: string; gate_name: string; gate_kind: "GARAGE" | "PEDESTRIAN"; building_name: string; qr_generation: number; available: boolean }>(
    sql`select * from public.identity_totem_display(${hash})`);
  const totem = rows[0];
  if (!totem) throw unpaired();
  if (!totem.available) throw new HttpError(403, "Abertura por QR indisponível para este portão", { code: "TOTEM_UNAVAILABLE" });
  const now = Date.now();
  const body: TotemDisplay = {
    gate: { id: totem.gate_id, name: totem.gate_name, kind: totem.gate_kind },
    building: { name: totem.building_name },
    ...totemCodes(totem.gate_id, totem.qr_generation, now, secret),
    serverTime: new Date(now).toISOString(),
  };
  res.json(body);
});

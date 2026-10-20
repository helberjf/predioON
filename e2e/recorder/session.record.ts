import { test } from "../support/fixtures";
import { signIn } from "../support/helpers";
import { PORTALS } from "../support/routes";

// Started by scripts/e2e-record.mjs. The refresh token rotates and a reused one revokes the whole
// session family, so a saved storage state would work only once: each recording logs in fresh,
// with an isolated alias of the seed account (removed when the Inspector is closed).
const as = process.env.E2E_RECORD_AS ?? "sindico";
const portalKey = process.env.E2E_RECORD_PORTAL;
const accounts: Record<string, { email: string | null; portal: string }> = {
  admin: { email: "admin@predioon.local", portal: "admin" },
  sindico: { email: "sindico@predioon.local", portal: "building" },
  morador: { email: "morador@predioon.local", portal: "resident" },
  anonimo: { email: null, portal: "building" },
};

test("gravação", async ({ page }) => {
  const account = accounts[as];
  if (!account) throw new Error(`Perfil desconhecido: ${as}. Use admin, sindico, morador ou anonimo.`);
  const portal = PORTALS.find(item => item.key === (portalKey ?? account.portal));
  if (!portal) throw new Error(`Portal desconhecido: ${portalKey}. Use admin, building ou resident.`);
  await page.setViewportSize(portal.viewport);
  if (account.email) await signIn(page, portal.origin, account.email);
  else await page.goto(portal.origin);
  // Opens the Playwright Inspector: click "Record", use the portal, copy the generated code.
  await page.pause();
});

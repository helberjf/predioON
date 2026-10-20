import { expect, test } from "../../support/fixtures";
import { BUILDING_URL } from "../../support/environment";
import { signIn } from "../../support/helpers";

// Starting point of the Playwright test agents (.claude/agents/playwright-test-*.md): the
// planner and the generator begin from this page, already signed in with an isolated alias of
// the seed manager. It also proves, on its own, that the building portal opens after login.
test("seed: síndico entra no portal do condomínio", { tag: "@agent-seed" }, async ({ page }) => {
  await signIn(page, BUILDING_URL, "sindico@predioon.local");
  await expect(page.getByRole("heading", { level: 1, name: /^Olá, / })).toBeVisible();
});

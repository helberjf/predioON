import { execFileSync } from "node:child_process";
import { test } from "@playwright/test";
import { ADMIN_URL, BUILDING_URL, RESIDENT_URL } from "../../e2e/environment";

// The web servers of playwright.config.ts stay up while this runs the recorder.
test("grava os três portais", () => {
  const out = process.env.VIDEO_OUT ?? ".local/videos";
  execFileSync(process.execPath, ["scripts/record-portal-videos.mjs", out], {
    stdio: "inherit", env: { ...process.env, ADMIN_URL, BUILDING_URL, RESIDENT_URL },
  });
});

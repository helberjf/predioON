import type { Page } from "@playwright/test";
import { API_URL } from "./environment";

/** Collects what a user would not see but a broken page leaves behind: uncaught exceptions,
 * console errors and API answers >= 400. Navigation aborts (SSE, cancelled fetches) are normal. */
export function trackPageHealth(page: Page, options: { allowAnonymousRefresh?: boolean } = {}) {
  const problems: string[] = [];
  page.on("pageerror", error => problems.push(`exceção JS: ${error.message.split("\n")[0]}`));
  page.on("console", message => {
    // Network failures are reported once, below, with method and status.
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) problems.push(`console.error: ${message.text().slice(0, 200)}`);
  });
  page.on("response", response => {
    if (response.url().startsWith(API_URL) && response.status() >= 400) {
      // Public screens restore a cookie session on load; a browser without a
      // refresh cookie legitimately receives 401. Other failures remain errors.
      if (options.allowAnonymousRefresh && response.status() === 401 && response.request().method() === "POST"
        && new URL(response.url()).pathname === "/auth/web/refresh") return;
      problems.push(`HTTP ${response.status()} ${response.request().method()} ${new URL(response.url()).pathname}`);
    }
  });
  page.on("requestfailed", request => {
    const reason = request.failure()?.errorText ?? "";
    if (!/abort|cancel/i.test(reason)) problems.push(`falha de rede: ${request.method()} ${request.url()} (${reason})`);
  });
  return {
    /** Problems recorded from this point on. */
    mark: () => problems.length,
    since: (mark: number) => problems.slice(mark),
  };
}

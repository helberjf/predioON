import type { Page } from "@playwright/test";
import { API_URL } from "./environment";

/** Collects what a user would not see but a broken page leaves behind: uncaught exceptions,
 * console errors and API answers >= 400. Navigation aborts (SSE, cancelled fetches) are normal. */
export function trackPageHealth(page: Page) {
  const problems: string[] = [];
  page.on("pageerror", error => problems.push(`exceção JS: ${error.message.split("\n")[0]}`));
  page.on("console", message => {
    // Network failures are reported once, below, with method and status.
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) problems.push(`console.error: ${message.text().slice(0, 200)}`);
  });
  page.on("response", response => {
    if (response.url().startsWith(API_URL) && response.status() >= 400) {
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

type Environment = Record<string, string | undefined>;

/** Fixtures write data: local runs stay on loopback. The sole CI exception is
 * the explicitly named disposable service on the job's private Docker network. */
export function isDisposableDatabaseTarget(url: URL, environment: Environment = process.env): boolean {
  if (!["postgres:", "postgresql:"].includes(url.protocol) || url.search || url.hash) return false;
  if (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return true;
  return environment.GITHUB_ACTIONS === "true" && environment.E2E_DATABASE_SERVICE === "postgres"
    && url.hostname === "postgres" && (url.port || "5432") === "5432" && url.pathname === "/predioon";
}

export function sameDatabaseTarget(left: URL, right: URL): boolean {
  return left.hostname === right.hostname && (left.port || "5432") === (right.port || "5432") && left.pathname === right.pathname;
}

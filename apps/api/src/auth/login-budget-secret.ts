const developmentKey = "predioon-local-only-login-budget-key-do-not-use-in-production";

export function loginBudgetSecret(value: string | undefined, environment: string): string {
  if (value === undefined && environment !== "production") return developmentKey;
  if (!value || Buffer.byteLength(value, "utf8") < 32 || value.length > 512 || value.trim() !== value ||
      (environment === "production" && value === developmentKey)) {
    throw new Error("AUTH_RATE_LIMIT_KEY exige um segredo exclusivo de pelo menos 32 bytes (até 512 caracteres)");
  }
  return value;
}

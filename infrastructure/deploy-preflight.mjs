// Runs inside the built image, without opening a database connection.
// Never print raw errors: malformed configuration can contain secrets.
try {
  if (process.argv[2] === "api") {
    await import("../apps/api/src/auth/tokens.ts");
  } else if (process.argv[2] === "database") {
    const { runtimeRoleCredentials } = await import("../packages/db/src/runtime-role-credentials.ts");
    const credentials = runtimeRoleCredentials(process.env);
    const passwords = [new URL(process.env.DATABASE_URL).password, ...credentials.map(value => value.password)];
    if (passwords.some(value => !/^[A-Za-z0-9_-]{32,}$/.test(value)) || new Set(passwords).size !== passwords.length) {
      throw new Error("Use senhas distintas com pelo menos 32 caracteres base64url para os sete logins.");
    }
    if (process.argv[3] === "--seed" && (process.env.SEED_PASSWORD ?? "").length < 16) {
      throw new Error("--seed exige SEED_PASSWORD explícita com pelo menos 16 caracteres.");
    }
  } else throw new Error("Modo inválido.");
  console.log("Configuração validada sem acesso ao banco.");
} catch {
  console.error("Pré-validação recusada. Confira as chaves Ed25519/JSON, configuração da API e sete senhas distintas base64url (mínimo 32 caracteres); --seed exige SEED_PASSWORD (mínimo 16). Nenhum serviço foi parado.");
  process.exitCode = 1;
}

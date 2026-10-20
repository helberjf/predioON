// Abre um portal já logado, com o Inspector do Playwright pronto para gravar.
//
//   pnpm e2e:record                    síndico no portal do condomínio
//   pnpm e2e:record morador            morador no portal do morador
//   pnpm e2e:record admin              plataforma no portal da administração
//   pnpm e2e:record anonimo resident   sem login (login, convite, recuperação de senha)
//
// Sobe a API e os portais contra o banco descartável (pnpm e2e:db up antes). Tudo o que for
// feito durante a gravação fica só nesse banco.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const [as = "sindico", portal] = process.argv.slice(2).filter(arg => arg !== "--");
const cli = createRequire(import.meta.url).resolve("@playwright/test/cli");
const result = spawnSync(process.execPath, [cli, "test", "-c", "playwright.record.config.ts"], {
  stdio: "inherit",
  env: { ...process.env, E2E_RECORD_AS: as, ...(portal ? { E2E_RECORD_PORTAL: portal } : {}) },
});
process.exit(result.status ?? 1);

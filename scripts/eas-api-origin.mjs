#!/usr/bin/env node
// EAS Build hook (eas-build-post-install): writes the HTTPS API origin from the
// EAS environment variable PRODUCTION_API_URL into the app's config.ts before
// CocoaPods and Xcode run. Restricted to the disposable EAS checkout; the
// committed config.ts keeps an empty literal.
//
//   node ../../scripts/eas-api-origin.mjs --app resident-mobile
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const APPS = ["resident-mobile", "operations-mobile"];
// Same literal and single-occurrence guard as scripts/android-smoke/prepare.py.
const LITERAL = /const PRODUCTION_API_URL = "[^"\r\n]*";/g;

/** Accepts only a bare HTTPS origin; errors name the variable, never its value. */
export function apiOrigin(value) {
  const invalid = () => new Error("PRODUCTION_API_URL: use somente a origem HTTPS da API, por exemplo https://api.exemplo.com.br");
  let url;
  try { url = new URL(value ?? ""); } catch { throw invalid(); }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw invalid();
  if (value !== url.origin && value !== `${url.origin}/`) throw invalid();
  return url.origin;
}

/** Pure rewrite of the one PRODUCTION_API_URL literal. */
export function configureSource(source, origin) {
  if ((source.match(LITERAL) ?? []).length !== 1) throw new Error("config.ts deve ter exatamente um literal PRODUCTION_API_URL; revise o hook do EAS");
  return source.replace(LITERAL, `const PRODUCTION_API_URL = "${origin}";`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const option = name => { const index = process.argv.indexOf(name); return index > 0 ? process.argv[index + 1] : undefined; };
  try {
    const app = option("--app");
    if (!APPS.includes(app)) throw new Error(`--app deve ser ${APPS.join(" ou ")}`);
    if (process.env.EAS_BUILD !== "true") throw new Error("Este hook só altera o checkout descartável do EAS Build");
    const origin = apiOrigin(process.env.PRODUCTION_API_URL);
    const config = fileURLToPath(new URL(`../apps/${app}/config.ts`, import.meta.url));
    writeFileSync(config, configureSource(readFileSync(config, "utf8"), origin), "utf8");
    console.log(`${app}: API de produção configurada em ${origin}`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

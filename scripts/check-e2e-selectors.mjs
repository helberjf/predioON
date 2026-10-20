// Barra seletores e esperas frágeis nos testes de navegador. Prefira getByRole, getByLabel e
// getByText; data-testid só onde não houver papel ou rótulo acessível.
// Uma linha pode ser liberada com o comentário `e2e-selector-allow: <motivo>` na própria linha
// ou na anterior; o motivo é obrigatório.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["e2e/specs", "e2e/support", "e2e/recorder"];
const RULES = [
  [/\.waitForTimeout\(/, "espera fixa: aguarde um estado visível ou uma resposta (expect/waitForResponse)"],
  [/xpath=|locator\(\s*["'`]\/\//, "XPath depende da estrutura do HTML"],
  [/locator\(\s*["'`]\.\.["'`]/, "subir para o pai depende da estrutura do HTML"],
  [/\.nth\(/, "posição na lista muda com os dados: filtre pelo conteúdo"],
  [/locator\(\s*["'`][^"'`]*[.#][a-zA-Z_-][^"'`]*["'`]/, "seletor CSS por classe ou id: use papel, rótulo ou data-testid"],
  [/locator\(\s*["'`][^"'`]*\s>>\s/, "cadeia de seletores legada: encadeie locators"],
];

const files = ROOTS.flatMap(function walk(dir) {
  try { statSync(dir); } catch { return []; }
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : /\.(ts|mts)$/.test(name) ? [path] : [];
  });
});

const problems = [];
for (const file of files) {
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, index) => {
    const allowed = /e2e-selector-allow:\s*\S/.test(line) || /e2e-selector-allow:\s*\S/.test(lines[index - 1] ?? "");
    if (allowed) return;
    for (const [pattern, reason] of RULES) if (pattern.test(line)) problems.push(`${file}:${index + 1}  ${reason}\n    ${line.trim()}`);
  });
}

if (problems.length) {
  console.error(`Seletores frágeis em testes E2E (${problems.length}):\n\n${problems.join("\n")}`);
  process.exit(1);
}
console.log(`Seletores E2E conferidos em ${files.length} arquivos.`);

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createConnection } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Read-only: no installation, container startup, environment printing or database access.
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8"));
const pinnedPnpm = /^pnpm@(\d+\.\d+\.\d+)(?:\+.*)?$/.exec(manifest.packageManager ?? "")?.[1];
const requireAndroid = process.argv.includes("--android");
const unknownArguments = process.argv.slice(2).filter(arg => !["--android", "--help"].includes(arg));
if (process.argv.includes("--help")) {
  console.log("Uso: node scripts/check-environment.mjs [--android]\nSomente consulta o ambiente. Sem --android, JDK/SDK ausentes são avisos; com --android, impedem o aceite.\nSaída: 0 = requisitos atendidos (pode haver avisos); 1 = requisito ausente; 2 = argumento inválido.");
  process.exit(0);
}
if (unknownArguments.length) {
  console.error("Argumento desconhecido. Use --help para consultar as opções.");
  process.exit(2);
}

let failures = 0;
let warnings = 0;
function report(level, title, detail, help = "") {
  if (level === "FALHA") failures++;
  if (level === "AVISO") warnings++;
  console.log(`[${level}] ${title}: ${detail}`);
  if (help) console.log(`        ${help}`);
}
function probe(program, args) {
  // Only fixed command names/arguments enter the shell; Windows needs it for pnpm.cmd.
  const windowsPnpm = process.platform === "win32" && program === "pnpm";
  const result = spawnSync(windowsPnpm ? "pnpm --version" : program, windowsPnpm ? [] : args, {
    cwd: projectRoot,
    shell: windowsPnpm,
    encoding: "utf8",
    windowsHide: true,
    timeout: 10_000,
    maxBuffer: 256 * 1024,
    env: { ...process.env, COREPACK_ENABLE_NETWORK: "0" },
  });
  return { ok: !result.error && result.status === 0, text: `${result.stdout ?? ""}\n${result.stderr ?? ""}` };
}
function versionFrom(text) { return /\b\d+\.\d+\.\d+(?:[-+][\w.-]+)?\b/.exec(text)?.[0] ?? null; }
function listening(port) {
  return new Promise(resolvePort => {
    const socket = createConnection({ host: "127.0.0.1", port });
    let settled = false;
    const finish = open => { if (settled) return; settled = true; socket.destroy(); resolvePort(open); };
    socket.setTimeout(500);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.once("timeout", () => finish(false));
  });
}

console.log("Prédio ON — diagnóstico local (somente leitura)\n");
const [nodeMajor, nodeMinor] = process.versions.node.split(".").map(Number);
const nodeSupported = nodeMajor === 22 && nodeMinor >= 13 || nodeMajor === 24 && nodeMinor >= 3 || nodeMajor >= 26;
report(nodeSupported ? "OK" : "FALHA", "Node.js", process.versions.node, nodeSupported ? "" : "Instale Node 22.13+, 24.3+ ou 26+, conforme os requisitos dos aplicativos móveis.");

const pnpm = probe("pnpm", ["--version"]);
const currentPnpm = pnpm.ok ? versionFrom(pnpm.text) : null;
if (!pinnedPnpm) report("FALHA", "pnpm", "packageManager não declara uma versão exata.", "Corrija o package.json antes de instalar dependências.");
else if (currentPnpm === pinnedPnpm) report("OK", "pnpm", `${currentPnpm}, conforme packageManager.`);
else report("FALHA", "pnpm", currentPnpm ? `${currentPnpm} disponível; o projeto exige ${pinnedPnpm}.` : "Não encontrado ou indisponível.", `Instale/ative pnpm ${pinnedPnpm}: npm install --global pnpm@${pinnedPnpm}. Reabra o terminal e confira pnpm --version.`);

const git = probe("git", ["--version"]);
report(git.ok ? "OK" : "FALHA", "Git", git.ok ? versionFrom(git.text) ?? "Disponível." : "Não encontrado.", git.ok ? "" : "Instale Git for Windows e reabra o terminal para clonar e enviar commits.");
const docker = probe("docker", ["--version"]);
if (!docker.ok) report("FALHA", "Docker", "CLI não encontrada.", "Instale o Docker Desktop, habilite containers Linux e aguarde o engine iniciar.");
else {
  report("OK", "Docker CLI", versionFrom(docker.text) ?? "Disponível.");
  const compose = probe("docker", ["compose", "version", "--short"]);
  report(compose.ok ? "OK" : "FALHA", "Docker Compose", compose.ok ? versionFrom(compose.text) ?? "Disponível." : "Plugin indisponível.", compose.ok ? "" : "Atualize a instalação do Docker Desktop para incluir Docker Compose v2.");
  const engine = probe("docker", ["info", "--format", "{{.ServerVersion}} {{.OSType}}"]);
  const linux = engine.ok && /\blinux\b/.test(engine.text);
  report(linux ? "OK" : "FALHA", "Docker engine", linux ? `${versionFrom(engine.text) ?? "Ativo"}, containers Linux.` : engine.ok ? "Ativo, mas não está usando containers Linux." : "Não respondeu ou não está acessível.", linux ? "" : "Abra Docker Desktop, selecione containers Linux e aguarde ficar pronto. Confirme com docker info.");
}

const environmentPresent = existsSync(join(projectRoot, ".env"));
report(environmentPresent ? "OK" : "AVISO", ".env", environmentPresent ? "Arquivo presente; conteúdo não exibido." : "Arquivo ainda não criado.", environmentPresent ? "" : "Execute scripts/start-local.ps1 -Setup para copiar .env.example sem substituir arquivos existentes.");
const dependencies = existsSync(join(projectRoot, "node_modules", ".pnpm", "lock.yaml"));
report(dependencies ? "OK" : "FALHA", "Dependências", dependencies ? "Instalação pnpm encontrada." : "Instalação pnpm ausente.", dependencies ? "" : "Com a versão correta do pnpm, execute pnpm install --frozen-lockfile ou scripts/start-local.ps1 -Setup.");

const mobileLevel = requireAndroid ? "FALHA" : "AVISO";
const java = probe("java", ["-version"]);
const javac = probe("javac", ["-version"]);
const javaVersion = /(?:version\s+"?|javac\s+)(\d+(?:\.\d+){0,3})/.exec(java.text)?.[1];
const javaMajor = Number(javaVersion?.split(".")[0]);
const javaReady = java.ok && javac.ok && javaMajor >= 17;
report(javaReady ? "OK" : mobileLevel, "JDK (Android)", javaReady ? `Java ${javaVersion}, compilador disponível.` : "JDK 17+ com java e javac não encontrado no PATH.", javaReady ? "" : "Instale/configure JDK 17 (ou versão compatível com Gradle), ajuste JAVA_HOME e PATH. Dispensável para os painéis web.");

const sdkRoot = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || (process.platform === "win32" && process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Android", "Sdk") : "");
const sdkBuild = readFileSync(join(projectRoot, "apps", "resident-mobile", "android", "build.gradle"), "utf8");
const platformVersion = /compileSdkVersion\s*=\s*(\d+)/.exec(sdkBuild)?.[1];
const buildToolsVersion = /buildToolsVersion\s*=\s*"([\d.]+)"/.exec(sdkBuild)?.[1];
const ndkVersion = /ndkVersion\s*=\s*"([\d.]+)"/.exec(sdkBuild)?.[1];
const sdkMissing = [];
if (!sdkRoot || !existsSync(sdkRoot)) sdkMissing.push("diretório SDK");
else {
  if (!existsSync(join(sdkRoot, "platform-tools", process.platform === "win32" ? "adb.exe" : "adb"))) sdkMissing.push("platform-tools/adb");
  if (platformVersion && !existsSync(join(sdkRoot, "platforms", `android-${platformVersion}`, "android.jar"))) sdkMissing.push(`Android SDK Platform ${platformVersion}`);
  if (buildToolsVersion && !existsSync(join(sdkRoot, "build-tools", buildToolsVersion))) sdkMissing.push(`Build-Tools ${buildToolsVersion}`);
  if (ndkVersion && !existsSync(join(sdkRoot, "ndk", ndkVersion))) sdkMissing.push(`NDK ${ndkVersion}`);
}
report(sdkMissing.length ? mobileLevel : "OK", "Android SDK", sdkMissing.length ? `Ausente/incompleto: ${sdkMissing.join(", ")}.` : "Plataforma, ferramentas e NDK encontrados.", sdkMissing.length ? "Instale os componentes pelo SDK Manager do Android Studio e configure ANDROID_HOME. A presença dos arquivos não substitui um build Android." : "");
if (process.platform !== "darwin") report("AVISO", "iOS", "A compilação nativa exige macOS com Xcode.");

console.log("\nPortas locais padrão (uma conexão não identifica o processo responsável):");
const ports = [[3000, "API", "app"], [5173, "Administrador", "app"], [5174, "Condomínio", "app"], [5175, "Morador", "app"], [5434, "PostgreSQL", "infra"], [1883, "MQTT", "infra"], [8883, "MQTT TLS", "infra"], [18083, "EMQX", "infra"], [8081, "Metro mobile", "mobile"]];
const portResults = await Promise.all(ports.map(async ([port, label, kind]) => ({ port, label, kind, open: await listening(port) })));
for (const result of portResults) {
  if (result.open) report("AVISO", `${result.label} :${result.port}`, "Em uso; pode ser uma instância já iniciada.", "Confira o processo antes de iniciar outro serviço nesta porta.");
  else report("OK", `${result.label} :${result.port}`, result.kind === "infra" ? "Sem serviço TCP respondendo; inicie a infraestrutura para usar a plataforma." : "Sem serviço TCP respondendo.");
}
console.log(`\nResultado: ${failures} requisito(s) pendente(s), ${warnings} aviso(s).`);
console.log("Primeira preparação: .\\scripts\\start-local.ps1 -Setup");
console.log("Demonstração local com contas de exemplo: .\\scripts\\start-local.ps1 -Setup -SeedDemo");
console.log("Próximas execuções: .\\scripts\\start-local.ps1 (não executa seed nem migrations).\nEste diagnóstico não valida credenciais, dados do banco, hardware ou builds nativos.");
process.exitCode = failures ? 1 : 0;

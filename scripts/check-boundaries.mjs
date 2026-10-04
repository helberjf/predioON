import { readFile, readdir } from "node:fs/promises";
import { builtinModules } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ignoredDirectories = new Set(["node_modules", "dist", "build", "coverage", ".git", ".next", ".expo", "test", "tests", "__tests__"]);
const sourceExtension = /\.[cm]?[jt]sx?$/;
// Metro/Babel execute under Node; they are not part of the application bundle.
const nodeBuildConfigs = new Set(["metro.config.js", "babel.config.js", "react-native.config.js"]);
const packageName = specifier => specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0];
const publicPackages = new Set(["@predioon/ui", "@predioon/api-client", "@predioon/contracts", "@predioon/shared"]);
const serverPackages = new Set(["@predioon/db", "@predioon/domain", "@predioon/runtime", "@predioon/api", "@predioon/ingest", "@predioon/notifications"]);
const serverLibraries = new Set(["express", "mqtt", "drizzle-orm", "drizzle-kit", "pg", "postgres"]);
const domainLibraries = new Set([...serverLibraries, "react", "react-dom", "react-native"]);
const nodeBuiltins = new Set(builtinModules.map(name => name.replace(/^node:/, "")));

async function entries(path) {
  try { return await readdir(path, { withFileTypes: true }); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
}

async function sourceFiles(directory) {
  const files = [];
  for (const entry of await entries(directory)) {
    if (entry.isDirectory() && !ignoredDirectories.has(entry.name)) files.push(...await sourceFiles(join(directory, entry.name)));
    else if (entry.isFile() && sourceExtension.test(entry.name) && !/\.(test|spec)\./.test(entry.name)) files.push(join(directory, entry.name));
  }
  return files;
}

// Tokenize strings separately so examples and commented imports cannot become edges.
function imports(source) {
  const tokens = [];
  const tokenPattern = /\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|[A-Za-z_$][\w$]*|[^\s]/g;
  for (const match of source.matchAll(tokenPattern)) {
    const value = match[0];
    if (value.startsWith("//") || value.startsWith("/*")) continue;
    tokens.push({ value, quoted: /^["'`]/.test(value) });
  }
  const specifiers = [];
  const add = (token, typeOnly = false) => {
    if (token?.quoted && !token.value.includes("${")) specifiers.push({ specifier: token.value.slice(1, -1), typeOnly });
  };
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.quoted) continue;
    if (token.value === "require" && tokens[index + 1]?.value === "(") add(tokens[index + 2]);
    if (token.value !== "import" && token.value !== "export") continue;
    if (tokens[index + 1]?.value === "(") { add(tokens[index + 2]); continue; }
    if (tokens[index + 1]?.quoted) { add(tokens[index + 1]); continue; }
    for (let next = index + 1; next < tokens.length; next++) {
      const current = tokens[next];
      if ([";", "import", "export", "="].includes(current.value)) break;
      if (current.value === "from") { add(tokens[next + 1], tokens[index + 1]?.value === "type"); break; }
    }
  }
  return specifiers;
}

/** Check source imports and the transitive workspace dependency graph. */
export async function checkBoundaries(root) {
  root = resolve(root);
  const packages = new Map();
  for (const group of ["apps", "packages", "services"]) {
    for (const entry of await entries(join(root, group))) {
      if (!entry.isDirectory()) continue;
      const directory = join(root, group, entry.name);
      let manifest;
      try { manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8")); }
      catch (error) { if (error.code === "ENOENT") continue; throw error; }
      if (!manifest.name) continue;
      const server = group === "services" || (group === "apps" && /(^|[-/])(api|server)(-|$)/.test(manifest.name));
      packages.set(manifest.name, { name: manifest.name, directory, manifest, server, client: (group === "apps" && !server) || publicPackages.has(manifest.name), edges: new Map(), typeOnlyEdges: new Set(), runtimeEdges: new Set() });
    }
  }

  function owner(path) {
    return [...packages.values()].find(pkg => path === pkg.directory || path.startsWith(`${pkg.directory}${sep}`));
  }

  const violations = new Set();
  const fileImportEdges = new Map();
  const apiDatabaseEntrypoints = new Set(["@predioon/db/runtime", "@predioon/db/identity", "@predioon/db/broker-auth"]);
  for (const pkg of packages.values()) {
    const dependencies = { ...pkg.manifest.dependencies, ...pkg.manifest.peerDependencies, ...pkg.manifest.optionalDependencies };
    // Workspace devDependencies can still smuggle runtime imports across layers.
    for (const name of Object.keys(pkg.manifest.devDependencies ?? {})) if (packages.has(name)) dependencies[name] = pkg.manifest.devDependencies[name];
    for (const name of Object.keys(dependencies)) pkg.edges.set(name, `${relative(root, pkg.directory)}/package.json`);
    for (const file of await sourceFiles(pkg.directory)) {
      if (nodeBuildConfigs.has(relative(pkg.directory, file))) continue;
      const sourceImports = imports(await readFile(file, "utf8"));
      fileImportEdges.set(file, sourceImports);
      for (const { specifier, typeOnly } of sourceImports) {
        if (pkg.client && specifier.startsWith(".") && nodeBuildConfigs.has(relative(pkg.directory, resolve(dirname(file), specifier)))) {
          violations.add(`Client build configuration imported at runtime: ${specifier} (${relative(root, file)})`);
        }
        const target = specifier.startsWith(".") || specifier.startsWith("/") ? owner(resolve(dirname(file), specifier))?.name : specifier;
        if (pkg.name === "@predioon/api" && target && packageName(target) === "@predioon/db" && !apiDatabaseEntrypoints.has(specifier)) {
          violations.add(`API owner boundary: ${specifier} (${relative(root, file)}); use a restricted database entrypoint`);
        }
        if (pkg.name === "@predioon/notifications" && target && packageName(target) === "@predioon/db" && specifier !== "@predioon/db/notifications") {
          violations.add(`Notification database boundary: ${specifier} (${relative(root, file)}); use only @predioon/db/notifications`);
        }
        if (target && packageName(target) !== pkg.name) {
          pkg.edges.set(target, relative(root, file));
          (typeOnly ? pkg.typeOnlyEdges : pkg.runtimeEdges).add(target);
        }
      }
    }
  }

  const notifications = packages.get("@predioon/notifications");
  if (notifications) {
    const visited = new Set();
    function inspectNotification(pkg, chain) {
      if (visited.has(pkg.name)) return;
      visited.add(pkg.name);
      for (const [specifier, source] of pkg.edges) {
        const name = packageName(specifier);
        const target = packages.get(name);
        const nextChain = [...chain, specifier];
        // postgres.Sql types do not construct a second pool. Runtime imports
        // remain forbidden, even if a later type import overwrites the edge.
        if (name === "postgres" && !pkg.runtimeEdges.has(specifier) &&
          (pkg.typeOnlyEdges.has(specifier) || source.endsWith("/package.json"))) continue;
        // The declared direct workspace dependency is package metadata. Every
        // actual source import still needs the dedicated public entrypoint.
        if (name === "@predioon/db") {
          if (specifier === "@predioon/db/notifications" ||
            (pkg === notifications && specifier === "@predioon/db" && source.endsWith("/package.json"))) continue;
          violations.add(`Notification database boundary: ${nextChain.join(" -> ")} (${source})`);
        } else if (target?.server || serverPackages.has(name) || serverLibraries.has(name)) {
          violations.add(`Notification service boundary: ${nextChain.join(" -> ")} (${source})`);
        } else if (target) inspectNotification(target, nextChain);
      }
    }
    inspectNotification(notifications, [notifications.name]);
    // Follow the dedicated export itself: stopping at package metadata would
    // miss an owner barrel imported indirectly by one of its relative helpers.
    const database = packages.get("@predioon/db");
    if (database) {
      const administrativeFiles = new Set(["index.ts", "bootstrap.ts", "seed.ts", "apply-infrastructure.ts", "provision-runtime-roles.ts", "wait-db.ts"]
        .map(name => join(database.directory, "src", name)));
      const visitedFiles = new Set();
      function inspectNotificationAdapter(file, chain) {
        if (visitedFiles.has(file)) return;
        visitedFiles.add(file);
        if (administrativeFiles.has(file)) {
          violations.add(`Notification owner boundary: ${chain.join(" -> ")}`);
          return;
        }
        for (const { specifier } of fileImportEdges.get(file) ?? []) {
          const nextChain = [...chain, specifier];
          if (packageName(specifier) === "@predioon/db" && specifier !== "@predioon/db/notifications") {
            violations.add(`Notification owner boundary: ${nextChain.join(" -> ")}`);
          } else if (specifier.startsWith(".") || specifier.startsWith("/")) {
            const base = resolve(dirname(file), specifier);
            const target = [base, base.replace(/\.([cm]?)js$/, ".$1ts"), base + ".ts", join(base, "index.ts")]
              .find(candidate => fileImportEdges.has(candidate));
            if (target) inspectNotificationAdapter(target, nextChain);
          } else if (packages.get(packageName(specifier))?.server || ["@predioon/api", "@predioon/ingest", "mqtt"].includes(packageName(specifier))) {
            violations.add(`Notification service boundary: ${nextChain.join(" -> ")}`);
          }
        }
      }
      inspectNotificationAdapter(join(database.directory, "src/notifications.ts"), ["@predioon/db/notifications"]);
    }
  }

  for (const origin of packages.values()) {
    const domain = origin.name === "@predioon/domain";
    if (!origin.client && !domain) continue;
    const visited = new Set();
    function inspect(pkg, chain) {
      if (visited.has(pkg.name)) return;
      visited.add(pkg.name);
      for (const [specifier, source] of pkg.edges) {
        const name = packageName(specifier);
        const target = packages.get(name);
        const library = name.startsWith("@types/") ? name.slice("@types/".length) : name;
        const forbiddenWorkspace = domain
          ? target?.server || ["@predioon/db", "@predioon/runtime", "@predioon/ui", "@predioon/api-client"].includes(name)
          : target?.server || serverPackages.has(name);
        const forbiddenLibrary = domain ? domainLibraries.has(library) : serverLibraries.has(library) || name.startsWith("node:") || nodeBuiltins.has(specifier.replace(/^node:/, ""));
        const nextChain = [...chain, specifier];
        if (forbiddenWorkspace || forbiddenLibrary) {
          violations.add(`${domain ? "Domain" : "Client/public"} boundary: ${nextChain.join(" -> ")} (${source})`);
        } else if (target) inspect(target, nextChain);
      }
    }
    inspect(origin, [origin.name]);
  }
  return [...violations].sort();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const violations = await checkBoundaries(process.argv[2] ?? resolve(dirname(fileURLToPath(import.meta.url)), ".."));
  if (violations.length) {
    console.error(violations.join("\n"));
    process.exitCode = 1;
  } else console.log("Architecture boundaries passed.");
}

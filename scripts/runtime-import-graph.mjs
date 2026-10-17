import { readFile, realpath, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";

// Resolve the installed parser from this script's real project, not from fixtures.
const require = createRequire(new URL("../packages/db/package.json", import.meta.url));
const ts = require("typescript");
const packageName = specifier => specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0];
const inside = (root, path) => {
  const pathFromRoot = relative(root, path);
  return !isAbsolute(pathFromRoot) && pathFromRoot !== ".." && !pathFromRoot.startsWith(`..${sep}`);
};
const sourceExtension = /\.[cm]?[jt]sx?$/;

/** Runtime AST edges; erased TS nodes never contribute executable imports. */
export function runtimeImports(source, file) {
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const edges = [];
  function unwrapExpression(node) {
    while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) ||
      ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node))) node = node.expression;
    return node;
  }
  const literal = node => {
    node = unwrapExpression(node);
    return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined;
  };
  function isRequire(node) {
    node = unwrapExpression(node);
    if (ts.isIdentifier(node)) return node.text === "require";
    if (!ts.isPropertyAccessExpression(node) && !ts.isElementAccessExpression(node)) return false;
    const receiver = unwrapExpression(node.expression);
    return ts.isIdentifier(receiver) && receiver.text === "module" &&
      (ts.isPropertyAccessExpression(node) ? node.name.text === "require" : literal(node.argumentExpression) === "require");
  }
  const add = (node, kind, origin = node) => edges.push({
    specifier: literal(node), kind,
    line: parsed.getLineAndCharacterOfPosition((origin ?? parsed).getStart(parsed)).line + 1,
  });
  function visit(node) {
    if (ts.isTypeNode(node)) return;
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      const bindings = clause?.namedBindings;
      if (clause?.isTypeOnly || (clause && !clause.name && bindings && ts.isNamedImports(bindings) &&
        bindings.elements.length > 0 && bindings.elements.every(element => element.isTypeOnly))) return;
      add(node.moduleSpecifier, "import");
      return;
    }
    if (ts.isExportDeclaration(node)) {
      if (node.isTypeOnly || (node.exportClause && ts.isNamedExports(node.exportClause) &&
        node.exportClause.elements.length > 0 && node.exportClause.elements.every(element => element.isTypeOnly))) return;
      if (node.moduleSpecifier) add(node.moduleSpecifier, "export");
      return;
    }
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      if (!node.isTypeOnly) add(node.moduleReference.expression, "require");
      return;
    }
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || isRequire(node.expression))) {
      add(node.arguments[0], node.expression.kind === ts.SyntaxKind.ImportKeyword ? "dynamic import" : "require", node);
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  return { edges, invalid: parsed.parseDiagnostics.length > 0 };
}

function runtimeExportTargets(value) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(runtimeExportTargets);
  if (!value || typeof value !== "object") return [];
  // Conservatively inspect every possible runtime condition; type declarations are erased.
  return Object.entries(value).filter(([condition]) => condition !== "types").flatMap(([, target]) => runtimeExportTargets(target));
}

function exportTargets(manifest, subpath) {
  const exports = manifest.exports;
  if (exports === undefined) return subpath === "." ? [manifest.main ?? "./src/index.ts"] : [`.${subpath.slice(1)}`];
  if (typeof exports === "string" || Array.isArray(exports) || exports === null ||
    !Object.keys(exports).some(key => key.startsWith("."))) return subpath === "." ? runtimeExportTargets(exports) : [];
  if (Object.hasOwn(exports, subpath)) return runtimeExportTargets(exports[subpath]);
  for (const key of Object.keys(exports).filter(key => key.includes("*")).sort((a, b) => b.length - a.length)) {
    const [prefix, suffix] = key.split("*");
    if (subpath.startsWith(prefix) && subpath.endsWith(suffix)) {
      const matched = subpath.slice(prefix.length, suffix ? -suffix.length : undefined);
      return runtimeExportTargets(exports[key]).map(target => target.replaceAll("*", matched));
    }
  }
  return [];
}

/** Inspect only the productive entrypoint and the two dedicated database exports. */
export async function checkIngestRuntimeGraph(root, packages) {
  const ingest = packages.get("@predioon/ingest");
  if (!ingest) return [];
  root = resolve(root);
  const physicalRoot = await realpath(root);
  const database = packages.get("@predioon/db");
  const dedicatedAdapters = new Set(database ? ["ingest", "access-service"].map(name => join(database.directory, `src/${name}.ts`)) : []);
  const violations = new Set();
  const parsedFiles = new Map();
  const configurations = new Map();
  const visited = new Set();
  const display = file => relative(root, file).split(sep).join("/");
  const violation = (kind, chain, detail) => violations.add(`Ingest ${kind} boundary: ${chain.join(" -> ")}${detail ? ` (${detail})` : ""}`);

  async function firstSource(candidates) {
    for (const candidate of candidates) {
      if (!inside(root, candidate)) return { error: "source path escapes workspace root" };
      try {
        if (!(await stat(candidate)).isFile()) continue;
        const physical = await realpath(candidate);
        if (!inside(physicalRoot, physical)) return { error: "source symlink escapes workspace root" };
        if (!sourceExtension.test(physical) || /\.d\.[cm]?ts$/.test(physical)) return { error: "runtime source is not inspectable" };
        // Canonical paths prevent symlinks from hiding administrative filenames.
        const file = resolve(root, relative(physicalRoot, physical));
        return { file };
      } catch (error) {
        if (!["ENOENT", "ENOTDIR"].includes(error.code)) throw error;
      }
    }
    return undefined;
  }

  async function sourceFile(base, allowTypeScript, preferTypeScript = false) {
    const extension = extname(base);
    const candidates = [base];
    if (allowTypeScript && /\.[cm]?jsx?$/.test(extension)) {
      const rewrites = [base.replace(/\.([cm]?)jsx?$/, ".$1ts"), base.replace(/\.([cm]?)jsx?$/, ".$1tsx")];
      if (preferTypeScript && extension === ".jsx") rewrites.reverse();
      if (preferTypeScript) candidates.unshift(...rewrites);
      else candidates.push(...rewrites);
    }
    const typescriptExtensions = allowTypeScript ? [".ts", ".tsx", ".jsx", ".mts", ".cts", ".mjs", ".cjs"] : [];
    const nativeExtensions = [".js", ".json", ".node"];
    if (!extension) candidates.push(...(preferTypeScript ? [...typescriptExtensions, ...nativeExtensions] : [...nativeExtensions, ...typescriptExtensions]).map(suffix => base + suffix));
    return firstSource(candidates);
  }

  async function sourceIndex(base, allowTypeScript, preferTypeScript = false) {
    const typescriptExtensions = allowTypeScript ? [".ts", ".tsx", ".jsx", ".mts", ".cts", ".mjs", ".cjs"] : [];
    const nativeExtensions = [".js", ".json", ".node"];
    return firstSource((preferTypeScript ? [...typescriptExtensions, ...nativeExtensions] : [...nativeExtensions, ...typescriptExtensions]).map(suffix => join(base, `index${suffix}`)));
  }

  async function existingFile(base, allowTypeScript = true, esm = false) {
    if (!inside(root, base)) return { error: "source path escapes workspace root" };
    const file = await sourceFile(base, allowTypeScript, esm);
    if (file) return file;
    try {
      if (!(await stat(base)).isDirectory()) return { error: "runtime source cannot be resolved" };
      if (!inside(physicalRoot, await realpath(base))) return { error: "source symlink escapes workspace root" };
    } catch (error) {
      if (!["ENOENT", "ENOTDIR"].includes(error.code)) throw error;
      return { error: "runtime source cannot be resolved" };
    }
    // TSX's ESM resolver tries a directory index without following its CJS main.
    if (esm) return await sourceIndex(base, allowTypeScript, true) ?? { error: "runtime source cannot be resolved" };
    let manifest;
    const manifestPath = join(base, "package.json");
    try {
      if (!inside(physicalRoot, await realpath(manifestPath))) return { error: "directory package.json symlink escapes workspace root" };
      try { manifest = JSON.parse(await readFile(manifestPath, "utf8")); }
      catch (error) { if (error instanceof SyntaxError) return { error: "directory package.json cannot be parsed" }; throw error; }
    } catch (error) { if (!["ENOENT", "ENOTDIR"].includes(error.code)) throw error; }
    if (manifest?.main) {
      if (typeof manifest.main !== "string") return { error: "directory main cannot be resolved" };
      const main = resolve(base, manifest.main);
      // Node loads a main as a file or index, never by recursing into its package.json.
      const target = await sourceFile(main, allowTypeScript) ?? await sourceIndex(main, allowTypeScript);
      if (target) return target;
    }
    const index = await sourceIndex(base, allowTypeScript);
    if (index) return index;
    return { error: "runtime source cannot be resolved" };
  }

  async function existingFiles(base, includeEsm = false) {
    const typescript = await existingFile(base);
    if (typescript.error && typescript.error !== "runtime source cannot be resolved") return [typescript];
    const native = await existingFile(base, false);
    const variants = [typescript];
    if (native.file && native.file !== typescript.file || native.error && native.error !== "runtime source cannot be resolved") variants.push(native);
    // Keep CJS profiles and add the ESM TSX alternative only to import/export edges.
    // All profiles inspect paths; none loads the resolved application source.
    if (includeEsm) {
      const esm = await existingFile(base, true, true);
      if (esm.file && variants.every(candidate => candidate.file !== esm.file) ||
        esm.error && esm.error !== "runtime source cannot be resolved" && variants.every(candidate => candidate.error !== esm.error)) variants.push(esm);
    }
    return variants;
  }

  async function readConfiguration(path, ancestors = new Set()) {
    if (configurations.has(path)) return configurations.get(path);
    if (!inside(root, path)) return { error: "tsconfig escapes workspace root" };
    if (ancestors.has(path)) return { error: "tsconfig extends cycle" };
    let source;
    try {
      if (!inside(physicalRoot, await realpath(path))) return { error: "tsconfig symlink escapes workspace root" };
      source = await readFile(path, "utf8");
    } catch (error) { if (error.code === "ENOENT") return {}; throw error; }
    const parsed = ts.parseConfigFileTextToJson(path, source);
    if (parsed.error) return { error: "tsconfig cannot be parsed" };
    const config = parsed.config;
    let inherited = {};
    for (const base of [config.extends ?? []].flat()) {
      if (typeof base !== "string" || (!base.startsWith(".") && !isAbsolute(base))) return { error: "tsconfig extends cannot be resolved" };
      const parent = resolve(dirname(path), base.endsWith(".json") ? base : base + ".json");
      inherited = { ...inherited, ...await readConfiguration(parent, new Set([...ancestors, path])) };
      if (inherited.error) return inherited;
    }
    const options = config.compilerOptions ?? {};
    const baseUrl = options.baseUrl === undefined ? inherited.baseUrl : resolve(dirname(path), options.baseUrl);
    const result = {
      ...inherited,
      ...(baseUrl ? { baseUrl } : {}),
      ...(options.paths ? { paths: options.paths, pathsBase: baseUrl ?? dirname(path) } : {}),
    };
    configurations.set(path, result);
    return result;
  }

  async function configurationFor(file) {
    const rootConfig = await readConfiguration(join(root, "tsconfig.json"));
    let configuration = rootConfig;
    const directories = [];
    for (let directory = dirname(file); directory !== root && inside(root, directory); directory = dirname(directory)) directories.unshift(directory);
    for (const directory of directories) {
      const config = await readConfiguration(join(directory, "tsconfig.json"));
      configuration = { ...configuration, ...config };
    }
    return configuration;
  }

  async function resolveSpecifier(file, specifier, kind = "import") {
    const includeEsm = kind !== "require";
    if (specifier.startsWith(".") || isAbsolute(specifier)) return existingFiles(resolve(dirname(file), specifier), includeEsm);
    if (specifier.startsWith("file:")) return [{ error: "file URL imports cannot be inspected" }];
    const configuration = await configurationFor(file);
    if (configuration.error) return [{ error: configuration.error }];
    for (const [alias, targets] of Object.entries(configuration.paths ?? {}).sort(([a], [b]) => b.length - a.length)) {
      const [prefix, suffix] = alias.split("*");
      const wildcard = alias.includes("*");
      if (wildcard ? !specifier.startsWith(prefix) || !specifier.endsWith(suffix) : alias !== specifier) continue;
      const matched = wildcard ? specifier.slice(prefix.length, suffix ? -suffix.length : undefined) : "";
      for (const target of targets) {
        const candidates = await existingFiles(resolve(configuration.pathsBase ?? configuration.baseUrl ?? root, target.replaceAll("*", matched)), includeEsm);
        if (candidates.some(candidate => candidate.file || candidate.error !== "runtime source cannot be resolved")) return candidates;
      }
      return [{ error: "tsconfig alias cannot be resolved" }];
    }
    if (configuration.baseUrl) {
      const candidates = await existingFiles(resolve(configuration.baseUrl, specifier), includeEsm);
      if (candidates.some(candidate => candidate.file || candidate.error !== "runtime source cannot be resolved")) return candidates;
    }
    const pkg = packages.get(packageName(specifier));
    if (!pkg) return [];
    const subpath = specifier === pkg.name ? "." : `.${specifier.slice(pkg.name.length)}`;
    const targets = exportTargets(pkg.manifest, subpath);
    if (!targets.length) return [{ error: "workspace export cannot be resolved" }];
    return (await Promise.all(targets.map(async target => {
      if (!target.startsWith("./") || !inside(pkg.directory, resolve(pkg.directory, target))) return [{ error: "workspace export escapes its package" }];
      return existingFiles(resolve(pkg.directory, target), includeEsm);
    }))).flat();
  }

  function forbiddenFile(file, adapter) {
    if (database && inside(join(database.directory, "src"), file)) {
      const name = relative(join(database.directory, "src"), file).replace(/\.[cm]?[jt]sx?$/, "");
      if (/^(index|context|env|bootstrap|seed(?:-.*)?|apply(?:-.*)?|provision(?:-.*)?|wait(?:-.*)?|migration-runner|infrastructure-migrations)$/.test(name)) return "owner";
      if (["runtime", "identity", "broker-auth", "notifications"].includes(name)) return "database";
      if (adapter && ["ingest", "access-service"].includes(name) && file !== adapter) return "database";
    }
    if (file === join(ingest.directory, "src/demo-data.ts")) return "owner";
    const pkg = [...packages.values()].find(value => inside(value.directory, file));
    if (pkg?.server && pkg !== ingest) return "service";
    return undefined;
  }

  async function inspect(file, chain, adapter) {
    const forbidden = forbiddenFile(file, adapter);
    if (forbidden) { violation(forbidden, chain, display(file)); return; }
    if (dedicatedAdapters.has(file)) adapter ??= file;
    const key = `${adapter ?? "service"}:${file}`;
    if (visited.has(key)) return;
    visited.add(key);
    if (!parsedFiles.has(file)) parsedFiles.set(file, runtimeImports(await readFile(file, "utf8"), file));
    const parsed = parsedFiles.get(file);
    if (parsed.invalid) { violation("source", chain, "runtime source cannot be parsed"); return; }
    for (const edge of parsed.edges) {
      const location = `${display(file)}:${edge.line}`;
      if (edge.specifier === undefined) { violation("unresolved import", chain, `${edge.kind} in ${location}`); continue; }
      const nextChain = [...chain, edge.specifier];
      const name = packageName(edge.specifier);
      if (name === "@predioon/db" && edge.specifier === "@predioon/db") { violation("owner", nextChain, display(file)); continue; }
      if (name === "@predioon/db" && !["@predioon/db/ingest", "@predioon/db/access-service"].includes(edge.specifier)) {
        violation("database", nextChain, display(file)); continue;
      }
      if (["@predioon/api", "@predioon/notifications"].includes(name) ||
        (name === "postgres" && file !== join(database?.directory ?? root, "src/runtime-connection.ts"))) {
        violation("service", nextChain, display(file)); continue;
      }
      for (const target of await resolveSpecifier(file, edge.specifier, edge.kind)) {
        if (target.error) violation("unresolved import", nextChain, `${target.error}; ${location}`);
        else if (database && target.file === join(database.directory, "src/runtime-connection.ts") && !dedicatedAdapters.has(file)) {
          violation("database", nextChain, `private pool constructor outside dedicated adapter; ${display(file)}`);
        } else await inspect(target.file, nextChain, adapter);
      }
    }
  }

  const index = await existingFile(join(ingest.directory, "src/index.ts"));
  if (index.file) await inspect(index.file, ["services/ingest/src/index.ts"]);
  else violation("unresolved import", ["services/ingest/src/index.ts"], index.error);
  if (database?.manifest.exports) for (const name of ["ingest", "access-service"]) {
    for (const target of await resolveSpecifier(join(ingest.directory, "src/index.ts"), `@predioon/db/${name}`)) {
      if (target.error) violation("unresolved import", [`@predioon/db/${name}`], target.error);
      else await inspect(target.file, [`@predioon/db/${name}`], target.file);
    }
  }
  return [...violations].sort();
}

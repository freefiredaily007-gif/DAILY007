import { builtinModules } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const sandboxRoot = path.resolve(scriptDirectory, "..");
const workspaceRoot = path.resolve(sandboxRoot, "../..");
const builtins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));
const manifestCache = new Map();

function readManifest(filePath) {
  if (!manifestCache.has(filePath)) {
    try {
      manifestCache.set(filePath, JSON.parse(readFileSync(filePath, "utf8")));
    } catch {
      manifestCache.set(filePath, null);
    }
  }
  return manifestCache.get(filePath);
}

function stripQuery(id) {
  return id.split("?")[0];
}

function packageSpecifier(specifier) {
  if (
    !specifier
    || specifier.startsWith(".")
    || specifier.startsWith("/")
    || specifier.startsWith("\0")
    || specifier.startsWith("@/")
    || specifier.startsWith("virtual:")
    || builtins.has(specifier)
  ) {
    return null;
  }
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

function findOwningManifest(importer) {
  let current = path.dirname(stripQuery(importer));
  while (current.startsWith(workspaceRoot)) {
    const manifestPath = path.join(current, "package.json");
    if (existsSync(manifestPath)) {
      const manifest = readManifest(manifestPath);
      if (manifest?.name?.startsWith("@workspace/")) {
        return { manifest, manifestPath };
      }
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

function resolvedPackageName(resolvedId, fallbackSpecifier) {
  if (resolvedId.external) {
    return packageSpecifier(fallbackSpecifier);
  }

  const resolvedPath = stripQuery(resolvedId.id);
  if (!path.isAbsolute(resolvedPath)) return null;

  let current = path.dirname(resolvedPath);
  while (current.startsWith(workspaceRoot)) {
    const manifest = readManifest(path.join(current, "package.json"));
    if (manifest?.name && current.split(path.sep).includes("node_modules")) {
      return manifest.name;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return packageSpecifier(fallbackSpecifier);
}

function dependencyNames(manifest) {
  return new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
  ]);
}

export function previewDependencyBoundaryPlugin() {
  return {
    name: "preview-dependency-boundary",
    enforce: "pre",
    async resolveId(source, importer) {
      if (process.env.DAILY007_CHECK_PREVIEW_DEPENDENCIES !== "1" || !importer) {
        return null;
      }

      const sourcePackage = packageSpecifier(source);
      if (!sourcePackage) return null;

      const owner = findOwningManifest(importer);
      if (!owner) return null;

      let resolved;
      try {
        resolved = await this.resolve(source, importer, { skipSelf: true });
      } catch {
        // Let Vite report unresolved imports using its normal diagnostic.
        return null;
      }
      if (!resolved) return null;

      const packageName = resolvedPackageName(resolved, source);
      if (!packageName || dependencyNames(owner.manifest).has(packageName)) {
        return null;
      }

      this.error(
        `Preview dependency boundary violation: ${owner.manifest.name} imports `
        + `${JSON.stringify(source)} from ${path.relative(workspaceRoot, stripQuery(importer))}, `
        + `but does not declare resolved package ${JSON.stringify(packageName)} in its package.json.`,
      );
    },
  };
}

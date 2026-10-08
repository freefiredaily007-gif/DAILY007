import { readFileSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const declarationPackages = ["@types/react", "@types/react-dom"];
const versionPattern = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/;
const ignoredNodeModulesEntries = new Set([".bin", ".cache", ".pnpm"]);

function readInstalledPackage(projectRoot, packageName) {
  const packageJsonPath = path.join(projectRoot, "node_modules", packageName, "package.json");

  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    if (typeof packageJson.version !== "string") {
      return { error: `has no version in ${packageJsonPath}` };
    }
    return { version: packageJson.version };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { error: `was not found at ${packageJsonPath}` };
    }
    throw error;
  }
}

function versionLine(version) {
  const match = versionPattern.exec(version);
  return match ? `${match[1]}.${match[2]}` : null;
}

function readPackageJson(packageJsonPath) {
  try {
    return JSON.parse(readFileSync(packageJsonPath, "utf8"));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function listInstalledPackages(nodeModulesPath) {
  let entries;
  try {
    entries = readdirSync(nodeModulesPath, { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const packages = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".") || ignoredNodeModulesEntries.has(entry.name)) {
      continue;
    }

    const entryPath = path.join(nodeModulesPath, entry.name);
    if (entry.name.startsWith("@") && entry.isDirectory()) {
      for (const scopedPackage of readdirSync(entryPath, { withFileTypes: true })) {
        if (scopedPackage.isDirectory() || scopedPackage.isSymbolicLink()) {
          packages.push(path.join(entryPath, scopedPackage.name));
        }
      }
    } else if (entry.isDirectory() || entry.isSymbolicLink()) {
      packages.push(entryPath);
    }
  }

  return packages;
}

function findNestedReactTypeMismatches(projectRoot, expectedVersions, expectedProjectName) {
  const mismatches = [];
  const visitedNodeModules = new Set();
  const visitedPackages = new Set();
  const directNodeModulesPath = path.resolve(projectRoot, "node_modules");

  function inspectNodeModules(nodeModulesPath, owner) {
    let realNodeModulesPath;
    try {
      realNodeModulesPath = realpathSync(nodeModulesPath);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return;
      }
      throw error;
    }

    if (visitedNodeModules.has(realNodeModulesPath)) {
      return;
    }
    visitedNodeModules.add(realNodeModulesPath);

    if (path.resolve(nodeModulesPath) !== directNodeModulesPath) {
      for (const packageName of declarationPackages) {
        const packageJsonPath = path.join(nodeModulesPath, packageName, "package.json");
        const packageJson = readPackageJson(packageJsonPath);
        if (!packageJson) {
          continue;
        }

        const expectedVersion = expectedVersions.get(packageName);
        const expectedLine = expectedVersion ? versionLine(expectedVersion) : null;
        const actualVersion =
          typeof packageJson.version === "string" ? packageJson.version : null;
        const actualLine = actualVersion ? versionLine(actualVersion) : null;
        const expectedDescription = expectedLine
          ? `expected ${expectedProjectName} line ${expectedLine}`
          : `expected the ${expectedProjectName} declaration line to be parseable`;
        if (!actualLine || !expectedLine) {
          mismatches.push(
            `${packageName}: ${owner} resolves ${actualVersion ?? "an unparseable version"} ` +
              `at ${packageJsonPath}; ${expectedDescription}`,
          );
        } else if (actualLine !== expectedLine) {
          mismatches.push(
            `${packageName}: ${owner} resolves ${actualVersion} at ${packageJsonPath}; ` +
              expectedDescription,
          );
        }
      }
    }

    for (const packagePath of listInstalledPackages(nodeModulesPath)) {
      let realPackagePath;
      try {
        realPackagePath = realpathSync(packagePath);
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
          continue;
        }
        throw error;
      }

      if (visitedPackages.has(realPackagePath)) {
        continue;
      }
      visitedPackages.add(realPackagePath);

      const packageJsonPath = path.join(realPackagePath, "package.json");
      const packageJson = readPackageJson(packageJsonPath);
      const packageLabel =
        packageJson?.name && packageJson?.version
          ? `${packageJson.name}@${packageJson.version}`
          : packagePath;

      inspectNodeModules(path.join(realPackagePath, "node_modules"), packageLabel);

      // pnpm stores peer dependencies beside a package in its virtual store.
      // Those sibling declarations are what TypeScript resolves from the linked package.
      const packageParent = path.dirname(realPackagePath);
      // Scoped packages add an @scope directory between the package and node_modules.
      const peerNodeModulesPath =
        path.basename(packageParent).startsWith("@")
          ? path.dirname(packageParent)
          : packageParent;
      if (path.basename(peerNodeModulesPath) === "node_modules") {
        inspectNodeModules(peerNodeModulesPath, packageLabel);
      }
    }
  }

  inspectNodeModules(directNodeModulesPath, expectedProjectName);
  return mismatches;
}

export function findReactTypeMismatches(sandboxRoot, mobileRoot) {
  const mismatches = [];
  const sandboxVersions = new Map();
  const mobileVersions = new Map();

  for (const packageName of declarationPackages) {
    const sandboxPackage = readInstalledPackage(sandboxRoot, packageName);
    const mobilePackage = readInstalledPackage(mobileRoot, packageName);

    if (sandboxPackage.error || mobilePackage.error) {
      mismatches.push(
        `${packageName}: mockup sandbox ${sandboxPackage.error ?? `resolved ${sandboxPackage.version}`}; ` +
          `Daily007 ${mobilePackage.error ?? `resolved ${mobilePackage.version}`}`,
      );
      continue;
    }

    sandboxVersions.set(packageName, sandboxPackage.version);
    mobileVersions.set(packageName, mobilePackage.version);
    const sandboxLine = versionLine(sandboxPackage.version);
    const mobileLine = versionLine(mobilePackage.version);
    if (!sandboxLine || !mobileLine) {
      mismatches.push(
        `${packageName}: could not parse mockup sandbox ${sandboxPackage.version} or ` +
          `Daily007 ${mobilePackage.version}`,
      );
    } else if (sandboxLine !== mobileLine) {
      mismatches.push(
        `${packageName}: mockup sandbox ${sandboxPackage.version} (line ${sandboxLine}) ` +
          `does not match Daily007 ${mobilePackage.version} (line ${mobileLine})`,
      );
    }
  }

  for (const [projectRoot, expectedVersions, projectName] of [
    [sandboxRoot, sandboxVersions, "mockup sandbox"],
    [mobileRoot, mobileVersions, "Daily007"],
  ]) {
    if (
      expectedVersions.size === declarationPackages.length &&
      [...expectedVersions.values()].every((version) => versionLine(version) !== null)
    ) {
      mismatches.push(
        ...findNestedReactTypeMismatches(projectRoot, expectedVersions, projectName),
      );
    }
  }
  return mismatches;
}

export function checkMobileReactTypes(sandboxRoot, mobileRoot) {
  const mismatches = findReactTypeMismatches(sandboxRoot, mobileRoot);
  if (mismatches.length > 0) {
    throw new Error(
      [
        "React declaration compatibility check failed.",
        ...mismatches.map((mismatch) => `- ${mismatch}`),
        "Keep the mockup sandbox and Daily007 on matching major.minor lines for both React declaration packages.",
        "These browser previews typecheck imported Daily007 screens, so mismatched declarations can cause confusing ref errors.",
        "For a nested entry, align the listed dependency's React type peer context and verify the exact package path shown above.",
      ].join("\n"),
    );
  }

  return "React declaration versions are compatible with the Daily007 mobile previews.";
}

function getProjectRoots() {
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
  const sandboxRoot = path.resolve(scriptDirectory, "..");
  const workspaceRoot = path.resolve(sandboxRoot, "../..");
  return {
    sandboxRoot,
    mobileRoot: path.join(workspaceRoot, "artifacts/daily007"),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const { sandboxRoot, mobileRoot } = getProjectRoots();
    console.log(checkMobileReactTypes(sandboxRoot, mobileRoot));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const declarationPackages = ["@types/react", "@types/react-dom"];
const versionPattern = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/;

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

export function findReactTypeMismatches(sandboxRoot, mobileRoot) {
  const mismatches = [];

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

import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { checkMobileReactTypes } from "./check-mobile-react-types.mjs";

const temporaryDirectories = [];

async function createProject(versions) {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "mockup-react-types-"));
  temporaryDirectories.push(projectRoot);

  for (const [packageName, version] of Object.entries(versions)) {
    const packageDirectory = path.join(projectRoot, "node_modules", packageName);
    await mkdir(packageDirectory, { recursive: true });
    await writeFile(
      path.join(packageDirectory, "package.json"),
      JSON.stringify({ name: packageName, version }),
    );
  }

  return projectRoot;
}

async function addInstalledPackage(projectRoot, packageName, version) {
  const packageDirectory = path.join(projectRoot, "node_modules", packageName);
  await mkdir(packageDirectory, { recursive: true });
  await writeFile(
    path.join(packageDirectory, "package.json"),
    JSON.stringify({ name: packageName, version }),
  );
  return packageDirectory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

test("accepts patch-version differences on matching declaration lines", async () => {
  const sandboxRoot = await createProject({
    "@types/react": "19.2.18",
    "@types/react-dom": "19.2.7",
  });
  const mobileRoot = await createProject({
    "@types/react": "19.2.3",
    "@types/react-dom": "19.2.1",
  });

  assert.equal(
    checkMobileReactTypes(sandboxRoot, mobileRoot),
    "React declaration versions are compatible with the Daily007 mobile previews.",
  );
});

test("reports incompatible React declaration lines with guidance", async () => {
  const sandboxRoot = await createProject({
    "@types/react": "19.3.0",
    "@types/react-dom": "19.2.7",
  });
  const mobileRoot = await createProject({
    "@types/react": "19.2.18",
    "@types/react-dom": "19.2.7",
  });

  assert.throws(
    () => checkMobileReactTypes(sandboxRoot, mobileRoot),
    /React declaration compatibility check failed[\s\S]*@types\/react: mockup sandbox 19\.3\.0 \(line 19\.3\) does not match Daily007 19\.2\.18 \(line 19\.2\)[\s\S]*matching major\.minor lines/,
  );
});

test("reports a declaration package that is not installed", async () => {
  const sandboxRoot = await createProject({
    "@types/react": "19.2.18",
  });
  const mobileRoot = await createProject({
    "@types/react": "19.2.18",
    "@types/react-dom": "19.2.7",
  });

  assert.throws(
    () => checkMobileReactTypes(sandboxRoot, mobileRoot),
    /@types\/react-dom: mockup sandbox was not found/,
  );
});

test("reports conflicting React type copies in a reachable Daily007 workspace dependency", async () => {
  const sandboxRoot = await createProject({
    "@types/react": "19.2.18",
    "@types/react-dom": "19.2.7",
  });
  const mobileRoot = await createProject({
    "@types/react": "19.2.18",
    "@types/react-dom": "19.2.7",
  });
  const sharedPackage = await addInstalledPackage(
    mobileRoot,
    "@workspace/preview-shared",
    "1.0.0",
  );
  const nestedReactTypes = path.join(sharedPackage, "node_modules", "@types", "react");
  await mkdir(nestedReactTypes, { recursive: true });
  await writeFile(
    path.join(nestedReactTypes, "package.json"),
    JSON.stringify({ name: "@types/react", version: "19.3.0" }),
  );
  const nestedReactDomTypes = path.join(
    sharedPackage,
    "node_modules",
    "@types",
    "react-dom",
  );
  await mkdir(nestedReactDomTypes, { recursive: true });
  await writeFile(
    path.join(nestedReactDomTypes, "package.json"),
    JSON.stringify({ name: "@types/react-dom", version: "19.3.0" }),
  );

  assert.throws(
    () => checkMobileReactTypes(sandboxRoot, mobileRoot),
    (error) => {
      assert.match(
        error.message,
        new RegExp(
          `@types/react: @workspace/preview-shared@1\\.0\\.0 resolves 19\\.3\\.0 at ` +
            `${nestedReactTypes.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\/package\\.json; expected Daily007 line 19\\.2`,
        ),
      );
      assert.match(
        error.message,
        new RegExp(
          `@types/react-dom: @workspace/preview-shared@1\\.0\\.0 resolves 19\\.3\\.0 at ` +
            `${nestedReactDomTypes.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\/package\\.json; expected Daily007 line 19\\.2`,
        ),
      );
      return true;
    },
  );
});

test("reports conflicting React declaration copies in a nested sandbox UI dependency", async () => {
  const sandboxRoot = await createProject({
    "@types/react": "19.2.18",
    "@types/react-dom": "19.2.7",
  });
  const mobileRoot = await createProject({
    "@types/react": "19.2.18",
    "@types/react-dom": "19.2.7",
  });
  const uiPackage = await addInstalledPackage(
    sandboxRoot,
    "@radix-ui/react-dialog",
    "1.1.23",
  );
  const conflictingTypes = [
    ["@types/react", "19.3.0"],
    ["@types/react-dom", "19.3.1"],
  ].map(([packageName, version]) => ({
    packageName,
    packageJsonPath: path.join(
      uiPackage,
      "node_modules",
      packageName,
      "package.json",
    ),
    version,
  }));

  for (const { packageName, packageJsonPath, version } of conflictingTypes) {
    await mkdir(path.dirname(packageJsonPath), { recursive: true });
    await writeFile(
      packageJsonPath,
      JSON.stringify({ name: packageName, version }),
    );
  }

  assert.throws(
    () => checkMobileReactTypes(sandboxRoot, mobileRoot),
    (error) => {
      for (const { packageName, packageJsonPath, version } of conflictingTypes) {
        assert.ok(
          error.message.includes(
            `${packageName}: @radix-ui/react-dialog@1.1.23 resolves ${version} at ` +
              `${packageJsonPath}; expected mockup sandbox line 19.2`,
          ),
          `diagnostic should include the owning UI dependency and exact path for ${packageName}`,
        );
      }
      return true;
    },
  );
});

test("reports a conflicting declaration from a pnpm package peer context", async () => {
  const sandboxRoot = await createProject({
    "@types/react": "19.2.18",
    "@types/react-dom": "19.2.7",
  });
  const mobileRoot = await createProject({
    "@types/react": "19.2.18",
    "@types/react-dom": "19.2.7",
  });
  const packageRoot = path.join(
    mobileRoot,
    "node_modules",
    ".pnpm",
    "preview-dependency@1.0.0",
    "node_modules",
    "preview-dependency",
  );
  await mkdir(packageRoot, { recursive: true });
  await writeFile(
    path.join(packageRoot, "package.json"),
    JSON.stringify({ name: "preview-dependency", version: "1.0.0" }),
  );
  const peerReactTypes = path.join(
    path.dirname(packageRoot),
    "@types",
    "react",
  );
  await mkdir(peerReactTypes, { recursive: true });
  await writeFile(
    path.join(peerReactTypes, "package.json"),
    JSON.stringify({ name: "@types/react", version: "19.3.0" }),
  );
  await symlink(
    packageRoot,
    path.join(mobileRoot, "node_modules", "preview-dependency"),
    "dir",
  );

  assert.throws(
    () => checkMobileReactTypes(sandboxRoot, mobileRoot),
    (error) => {
      assert.match(error.message, /preview-dependency@1\.0\.0 resolves 19\.3\.0/);
      assert.ok(
        error.message.includes(path.join(peerReactTypes, "package.json")),
        "diagnostic should include the nested declaration package path",
      );
      return true;
    },
  );
});

test("reports a conflicting declaration from a sandbox UI package peer context", async () => {
  const sandboxRoot = await createProject({
    "@types/react": "19.2.18",
    "@types/react-dom": "19.2.7",
  });
  const mobileRoot = await createProject({
    "@types/react": "19.2.18",
    "@types/react-dom": "19.2.7",
  });
  const packageRoot = path.join(
    sandboxRoot,
    "node_modules",
    ".pnpm",
    "@radix-ui+react-dialog@1.1.23",
    "node_modules",
    "@radix-ui",
    "react-dialog",
  );
  await mkdir(packageRoot, { recursive: true });
  await writeFile(
    path.join(packageRoot, "package.json"),
    JSON.stringify({ name: "@radix-ui/react-dialog", version: "1.1.23" }),
  );
  const peerTypes = path.join(
    path.dirname(path.dirname(packageRoot)),
    "@types",
  );
  const peerReactTypes = path.join(peerTypes, "react");
  await mkdir(peerReactTypes, { recursive: true });
  const peerReactPackageJson = path.join(peerReactTypes, "package.json");
  await writeFile(
    peerReactPackageJson,
    JSON.stringify({ name: "@types/react", version: "19.3.0" }),
  );
  const radixScope = path.join(sandboxRoot, "node_modules", "@radix-ui");
  await mkdir(radixScope, { recursive: true });
  await symlink(
    packageRoot,
    path.join(radixScope, "react-dialog"),
    "dir",
  );

  assert.throws(
    () => checkMobileReactTypes(sandboxRoot, mobileRoot),
    (error) => {
      assert.ok(error.message.includes(
        "@types/react: @radix-ui/react-dialog@1.1.23 resolves 19.3.0 at " +
          `${peerReactPackageJson}; expected mockup sandbox line 19.2`,
      ));
      return true;
    },
  );
});

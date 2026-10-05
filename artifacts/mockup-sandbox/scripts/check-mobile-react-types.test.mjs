import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
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

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const screenSource = await readFile(
  new URL('../src/screens/AdminRegs.tsx', import.meta.url),
  'utf8',
);
const sourceFile = ts.createSourceFile(
  'AdminRegs.tsx',
  screenSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);

let exportCsvInitializer;
const findExportHandler = (node) => {
  if (
    ts.isVariableDeclaration(node)
    && ts.isIdentifier(node.name)
    && node.name.text === 'exportCsv'
  ) {
    exportCsvInitializer = node.initializer;
    return;
  }
  ts.forEachChild(node, findExportHandler);
};
findExportHandler(sourceFile);
assert.ok(exportCsvInitializer, 'AdminRegs must keep its CSV export handler.');

const handlerModuleSource = ts.transpile(
  `const exportCsv = ${exportCsvInitializer.getText(sourceFile)};\nmodule.exports = exportCsv;`,
  { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
);
const createHandlerModule = new Function(
  'module',
  'Platform',
  'Sharing',
  'File',
  'Paths',
  'selectedTournament',
  'paidRoster',
  'setErr',
  'setOkMsg',
  'setExportBusy',
  'globalThis',
  handlerModuleSource,
);

const selectedTournament = { id: 'cup/one', name: 'Cup One' };
const paidRoster = [{
  tournamentId: selectedTournament.id,
  status: 'approved',
  captainName: 'Captain One',
  captainGameName: 'Player One',
  captainGameUid: 'UID-001',
  teamName: 'Team One',
}];

function createHarness({ platform = 'android', shareAsync, browser = globalThis }) {
  const files = new Map();
  const deleteCalls = [];
  const state = { error: '', success: '', busy: false };
  let fileConstructions = 0;

  class PreviewFile {
    constructor(directory, name) {
      fileConstructions += 1;
      this.uri = `${directory}/${name}`;
    }

    get exists() {
      return files.has(this.uri);
    }

    create() {
      files.set(this.uri, '');
    }

    write(contents) {
      assert.ok(files.has(this.uri), 'The CSV must be created before it is written.');
      files.set(this.uri, contents);
    }

    delete() {
      deleteCalls.push(this.uri);
      files.delete(this.uri);
    }
  }

  const module = { exports: {} };
  createHandlerModule(
    module,
    { OS: platform },
    {
      isAvailableAsync: async () => true,
      shareAsync,
    },
    PreviewFile,
    { cache: 'cache://daily007' },
    selectedTournament,
    paidRoster,
    (value) => { state.error = value; },
    (value) => { state.success = value; },
    (value) => { state.busy = value; },
    browser,
  );

  return {
    exportCsv: module.exports,
    files,
    deleteCalls,
    state,
    get fileConstructions() {
      return fileConstructions;
    },
  };
}

test('native CSV export deletes its cache file after sharing succeeds', async () => {
  const harness = createHarness({
    shareAsync: async (uri, options) => {
      assert.match(uri, /^cache:\/\/daily007\/daily007-cup_one-players\.csv$/);
      assert.equal(options.mimeType, 'text/csv');
      assert.ok(harness.files.has(uri), 'The file must remain available while the share sheet is open.');
      assert.match(harness.files.get(uri), /"Real Name","In-Game Name","Game UID"/);
      assert.match(harness.files.get(uri), /"Captain One","Player One","UID-001"/);
    },
  });

  await harness.exportCsv();

  assert.equal(harness.files.size, 0);
  assert.equal(harness.deleteCalls.length, 1);
  assert.equal(harness.state.error, '');
  assert.equal(
    harness.state.success,
    'CSV file opened in the native share sheet. Choose an app or save destination.',
  );
  assert.equal(harness.state.busy, false);
});

test('native CSV export deletes its cache file after sharing rejects', async () => {
  const harness = createHarness({
    shareAsync: async (uri) => {
      assert.ok(harness.files.has(uri), 'The file must exist until the failed share settles.');
      throw new Error('Native share failed.');
    },
  });

  await harness.exportCsv();

  assert.equal(harness.files.size, 0);
  assert.equal(harness.deleteCalls.length, 1);
  assert.equal(harness.state.error, 'Native share failed.');
  assert.equal(harness.state.success, '');
  assert.equal(harness.state.busy, false);
});

test('browser CSV download keeps its download-and-revoke behavior', async () => {
  let createdBlob;
  let revokedUrl;
  let createdTag;
  let clicked = false;
  const link = { href: '', download: '', click: () => { clicked = true; } };
  class PreviewBlob {
    constructor(parts, options) {
      this.parts = parts;
      this.type = options.type;
      createdBlob = this;
    }
  }
  const browser = {
    Blob: PreviewBlob,
    URL: {
      createObjectURL: () => 'blob:local-csv',
      revokeObjectURL: (url) => { revokedUrl = url; },
    },
    document: {
      createElement: (tag) => {
        createdTag = tag;
        return link;
      },
    },
  };
  const harness = createHarness({
    platform: 'web',
    browser,
    shareAsync: async () => {
      throw new Error('The browser must not invoke native sharing.');
    },
  });

  await harness.exportCsv();

  assert.equal(createdBlob.type, 'text/csv;charset=utf-8');
  assert.match(createdBlob.parts.join(''), /"Captain One","Player One","UID-001"/);
  assert.equal(createdTag, 'a');
  assert.equal(link.href, 'blob:local-csv');
  assert.equal(link.download, 'daily007-cup_one-players.csv');
  assert.equal(clicked, true);
  assert.equal(revokedUrl, 'blob:local-csv');
  assert.equal(harness.fileConstructions, 0);
  assert.equal(harness.state.success, 'Player list CSV downloaded.');
  assert.equal(harness.state.busy, false);
});

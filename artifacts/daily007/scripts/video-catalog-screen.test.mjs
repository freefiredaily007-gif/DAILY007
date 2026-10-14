import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import ts from "typescript";

const videoSource = readFileSync(
  new URL("../src/screens/Video.tsx", import.meta.url),
  "utf8",
);
const videoSourceFile = ts.createSourceFile(
  "Video.tsx",
  videoSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);

function findVariableDeclaration(name) {
  let declaration;
  function visit(node) {
    if (
      ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.name.text === name
    ) {
      declaration = node;
    }
    ts.forEachChild(node, visit);
  }
  visit(videoSourceFile);
  assert.ok(declaration?.initializer, `Video should define ${name}.`);
  return declaration;
}

function findFunctionDeclaration(name) {
  let declaration;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
      declaration = node;
    }
    ts.forEachChild(node, visit);
  }
  visit(videoSourceFile);
  assert.ok(declaration, `Video should define ${name}.`);
  return declaration;
}

function findCatalogMap() {
  let mapCall;
  function visit(node) {
    if (
      ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && ts.isIdentifier(node.expression.expression)
      && node.expression.expression.text === "filteredVideos"
      && node.expression.name.text === "map"
    ) {
      mapCall = node;
    }
    ts.forEachChild(node, visit);
  }
  visit(videoSourceFile);
  assert.ok(mapCall, "Video should render cards from the filtered catalog.");
  return mapCall;
}

function evaluateExpression(node, scope) {
  const javascript = ts.transpileModule(
    `const __value = (${node.getText(videoSourceFile)});`,
    {
      compilerOptions: {
        jsx: ts.JsxEmit.React,
        module: ts.ModuleKind.None,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  return new Function(
    ...Object.keys(scope),
    `${javascript}\nreturn __value;`,
  )(...Object.values(scope));
}

function loadScreenHelper(name, scope = {}) {
  const declaration = findFunctionDeclaration(name);
  const javascript = ts.transpileModule(
    `const __helper = (${declaration.getText(videoSourceFile)});`,
    {
      compilerOptions: {
        module: ts.ModuleKind.None,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  return new Function(
    ...Object.keys(scope),
    `${javascript}\nreturn __helper;`,
  )(...Object.values(scope));
}

function createCardRenderer(pressables) {
  const Pressable = ({
    accessibilityLabel,
    accessibilityHint,
    children,
    onPress,
    testID,
  }) => {
    pressables.push({ accessibilityLabel, accessibilityHint, onPress, testID });
    return React.createElement(
      "button",
      {
        "aria-label": accessibilityLabel,
        "aria-description": accessibilityHint,
        "data-testid": testID,
        onClick: onPress,
      },
      children,
    );
  };
  const View = ({ children }) => React.createElement("div", null, children);
  const Text = ({ children }) => React.createElement("span", null, children);
  const Feather = () => null;

  return { Feather, Pressable, Text, View };
}

function renderCatalogCards(videos) {
  const pressables = [];
  const styles = {
    videoCatalogCard: {},
    catalogPlayIcon: {},
    catalogCardContent: {},
    catalogTitle: {},
    catalogTopic: {},
    catalogTap: {},
  };
  const element = evaluateExpression(findCatalogMap(), {
    React,
    ...createCardRenderer(pressables),
    colors: { primary: "#000000" },
    filteredVideos: videos,
    styles,
  });
  return {
    markup: renderToStaticMarkup(React.createElement(React.Fragment, null, ...element)),
    pressables,
  };
}

function filterCatalog(searchQuery, videos) {
  const initializer = findVariableDeclaration("filteredVideos").initializer;
  assert.ok(
    ts.isCallExpression(initializer) && initializer.arguments[0],
    "Video should derive filtered videos from its memoized search callback.",
  );
  const filterCallback = evaluateExpression(initializer.arguments[0], {
    searchQuery,
    videos,
  });
  return filterCallback();
}

function getCatalogVideos(catalogResponse) {
  const initializer = findVariableDeclaration("videos").initializer;
  return evaluateExpression(initializer, {
    videosQuery: { data: catalogResponse },
  });
}

function getSelectedVideo(videos, selectedVideoId) {
  return evaluateExpression(
    findVariableDeclaration("selectedVideo").initializer,
    { videos, selectedVideoId },
  );
}

test("corrected catalog title and topic display, search, and open the original YouTube video", () => {
  const correctedCatalogResponse = {
    videos: [{
      id: "video-record-42",
      title: "Corrected Tournament Highlights",
      topic: "Clash Squad",
      youtubeId: "a1b2C3d4E5F",
      url: "https://youtu.be/a1b2C3d4E5F",
      active: true,
      createdAt: "2026-10-14T00:00:00.000Z",
    }],
  };
  const videos = getCatalogVideos(correctedCatalogResponse);
  assert.deepEqual(videos, correctedCatalogResponse.videos);

  const renderedCatalog = renderCatalogCards(videos);
  assert.match(renderedCatalog.markup, /Corrected Tournament Highlights/);
  assert.match(renderedCatalog.markup, /Topic: Clash Squad/);
  assert.equal(renderedCatalog.pressables.length, 1);
  assert.equal(
    renderedCatalog.pressables[0].accessibilityLabel,
    "Corrected Tournament Highlights, topic Clash Squad",
  );

  assert.deepEqual(
    filterCatalog("corrected tournament", videos),
    videos,
    "Search should find the corrected title.",
  );
  assert.deepEqual(
    filterCatalog("clash squad", videos),
    videos,
    "Search should find the corrected topic.",
  );
  assert.deepEqual(
    filterCatalog("old video name", videos),
    [],
    "The previous title should no longer match the edited catalog item.",
  );

  let selectedVideoId = null;
  let showPlayer = false;
  const card = evaluateExpression(findCatalogMap(), {
    React,
    ...createCardRenderer([]),
    colors: { primary: "#000000" },
    filteredVideos: videos,
    catalogScrollRestorePendingRef: { current: false },
    setSelectedVideoId: (id) => { selectedVideoId = id; },
    setShowPlayer: (visible) => { showPlayer = visible; },
    styles: {
      videoCatalogCard: {},
      catalogPlayIcon: {},
      catalogCardContent: {},
      catalogTitle: {},
      catalogTopic: {},
      catalogTap: {},
    },
  })[0];
  card.props.onPress();
  assert.equal(selectedVideoId, "video-record-42");
  assert.equal(showPlayer, true);

  const selectedVideo = getSelectedVideo(videos, selectedVideoId);
  assert.equal(selectedVideo.youtubeId, "a1b2C3d4E5F");

  const playerDocumentCallback = findVariableDeclaration("playerDocument")
    .initializer.arguments[0];
  const playerDocument = evaluateExpression(playerDocumentCallback, {
    selectedVideo,
    colors: { background: "#ffffff" },
    createYouTubeDocument: loadScreenHelper("createYouTubeDocument", {
      PLAYING_STATE: 1,
    }),
  })();
  assert.match(playerDocument, /videoId: "a1b2C3d4E5F"/);
  assert.match(videoSource, /source=\{\{ html: playerDocument \}\}/);
});

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const adminSource = await readFile(path.resolve(process.cwd(), 'src/screens/AdminVideos.tsx'), 'utf8');

test('Admin video management starts with the same two category cards as the user library', () => {
  assert.match(adminSource, /testID="admin-video-category-selector"/);
  assert.match(adminSource, /\['application_related', 'youtube'\]/);
  assert.match(adminSource, /DAILY007 APPLICATION RELATED VIDEO/);
  assert.match(adminSource, /YOUTUBE VIDEOS/);
  assert.match(adminSource, /testID=\{`admin-video-category-\$\{category\}`\}/);
  assert.match(adminSource, /testID=\{`admin-video-category-page-\$\{selectedCategory\}`\}/);
  assert.match(adminSource, /video\.category === selectedCategory/);
  assert.doesNotMatch(adminSource, /CategoryPicker|CATEGORY FILTER/);
});

test('Add Video exposes only title, description, and YouTube link and binds category to its page', () => {
  const formStart = adminSource.indexOf('const renderVideoForm =');
  const formEnd = adminSource.indexOf('\n  return (', formStart);
  assert.ok(formStart >= 0 && formEnd > formStart);
  const formSource = adminSource.slice(formStart, formEnd);
  const addFields = formSource.slice(0, formSource.indexOf("{formMode === 'edit' ?"));

  assert.match(addFields, /VIDEO TITLE \*/);
  assert.match(addFields, /DESCRIPTION \(OPTIONAL\)/);
  assert.match(addFields, /YOUTUBE URL \/ LINK \*/);
  assert.doesNotMatch(addFields, /CATEGORY|PUBLISH DATE|THUMBNAIL URL|DISPLAY ORDER|PUBLICATION STATUS/);
  assert.match(adminSource, /category: selectedCategory/);
  assert.match(adminSource, /topic: CATEGORY_LABELS\[selectedCategory\]/);
});

test('Admin add/delete refresh invalidates both Admin and User video lists', () => {
  assert.match(adminSource, /getDaily007AdminListVideosQueryKey\(\)/);
  assert.match(adminSource, /getDaily007ListVideosQueryKey\(\)/);
  assert.match(adminSource, /useDaily007AdminDeleteVideo/);
  assert.match(adminSource, /await refreshVideoLists\(\)/);
});

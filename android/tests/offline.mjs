import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';

const script = readFileSync(new URL('../../web/site/assets/js/study.js', import.meta.url), 'utf8');

test('Android saves progress and history locally without an API', async () => {
  const values = {};
  const elements = new Map();
  let attempts = 0;
  let click;
  const $ = selector => {
    if (!elements.has(selector)) elements.set(selector, { hidden: true, addEventListener() {} });
    return elements.get(selector);
  };
  function launch() {
    const window = { wordYarnAndroid: {}, addEventListener() {} };
    runInNewContext(script, { window, location: { protocol: 'https:' },
      document: { addEventListener(type, cb) { if (type === 'click') click = cb; } },
      navigator: {}, crypto: {}, setInterval() {},
      fetch() { attempts++; throw Error('offline'); },
      localStorage: { getItem: key => values[key], setItem: (key, value) => { values[key] = value; } } });
    return window.createStudy({ $, esc: String, manifest: [{ id: 'ch01', no: 1, titleCn: '初到海州' }] });
  }
  const study = launch();
  study.position('ch01', 'p3');
  study.rate('ch01', 'boundary', 'known', true);
  study.rate('ch01', 'coast', 'fuzzy', false);
  await study.sync();
  launch();
  assert.equal(attempts, 0);
  assert.match($('#continueDetail').textContent, /第 3 段/);
  assert.match($('#reviewSummary').textContent, /1 次/);
  assert.equal($('#historyStudy').hidden, false);
  await click({ target: { closest: selector => selector === '#historyStudy' } });
  assert.match($('#studyHistory').innerHTML, /boundary/);
  assert.doesNotMatch($('#studyHistory').innerHTML, /coast/);
});

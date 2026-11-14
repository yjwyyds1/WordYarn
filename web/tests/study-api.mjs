import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('study data survives a restart and only due words enter the queue', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cet4-test-'));
  const exe = resolve(process.env.CET4_EXE || (process.platform === 'win32' ? '../desktop/dist/cet4.exe' : 'build-cet4/cet4'));
  const port = 19000 + Math.floor(Math.random() * 20000);
  let child;
  async function api(path, payload) {
    const response = await fetch('http://127.0.0.1:' + port + '/api/' + path, payload === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    assert.equal(response.status, 200);
    return response.json();
  }
  async function start() {
    child = spawn(exe, [resolve('site'), join(dir, 'study.sqlite'), String(port)], { stdio: 'inherit' });
    let failure;
    child.on('error', e => { failure = e; });
    for (let i = 0; i < 60; ++i) {
      if (failure) throw failure;
      if (child.exitCode !== null) throw Error('Server exited: ' + child.exitCode);
      try { return await api('study'); } catch { await new Promise(r => setTimeout(r, 100)); }
    }
    throw Error('Server did not start');
  }
  async function stop() {
    if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
    await new Promise(resolve => { child.once('exit', resolve); child.kill(); });
  }
  try {
    assert.deepEqual((await start()).due, []);
    const base = 'http://127.0.0.1:' + port;
    const home = await fetch(base + '/');
    assert.equal(home.status, 200);
    assert.match(await home.text(), /id="view-today"/);
    const invalid = await fetch(base + '/api/position', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chapter: 'ch00', paragraph: 'p1' })
    });
    assert.equal(invalid.status, 400);
    const position = { chapter: 'ch01', paragraph: 'p3' };
    const word = { chapter: 'ch01', lemma: 'boundary', rating: 'new' };
    await api('position', position);
    await api('mark', word);
    assert.equal((await api('study')).due[0].lemma, 'boundary');
    await api('mark', { chapter: 'ch02', lemma: 'sample', rating: 'fuzzy' });
    assert.equal((await api('study')).reviewCount, 0);
    await api('review', { ...word, rating: 'known', attempt: 'test-1' });
    await api('review', { ...word, rating: 'known', attempt: 'test-1' });
    await stop();
    const restored = await start();
    assert.deepEqual(restored.position, position);
    assert.deepEqual(restored.due.map(w => w.chapter), ['ch02']);
    assert.equal(restored.reviewCount, 1);
    assert.equal(restored.words.find(w => w.lemma === 'boundary').rating, 'known');
    assert.ok(restored.words.find(w => w.lemma === 'boundary').dueAt > Date.now() / 1000);
    assert.equal((await api('history'))[0].lemma, 'boundary');
    const now = Math.floor(Date.now() / 1000);
    const later = { chapter: 'ch03', lemma: 'context', rating: 'known' };
    await api('review', { ...later, attempt: 'offline-1', reviewedAt: now - 172800 });
    await api('review', { ...later, attempt: 'offline-2', reviewedAt: now - 86400 });
    const replayed = await api('study');
    assert.equal(Object.values(replayed.activity).reduce((a, b) => a + b, 0), 3);
    assert.equal(replayed.remembered, 1);
    assert.equal(replayed.words.find(w => w.lemma === 'context').dueAt, now + 172800);
    assert.equal((await api('history'))[0].reviewedAt, now - 86400);
    const marks = { chapter: 'ch04', lemma: 'memory' };
    const steps = [0, 1, 4, 11, 26].map(days => now - (27 - days) * 86400);
    for (const [i,time] of steps.entries()) {
      const response = await api('review', { ...marks, rating: 'known', attempt: 'long-' + i, reviewedAt: time });
      assert.equal(response.dueAt, time + [1,3,7,15,30][i] * 86400);
    }
    const early = await api('review', {...marks,rating:'known',attempt:'early',reviewedAt:now});
    assert.equal(early.dueAt,steps.at(-1) + 30 * 86400);
    const wrong = await api('review', {...marks,rating:'new',attempt:'wrong',reviewedAt:now});
    assert.equal(wrong.dueAt,now + 600);
    const fuzzy = await api('review', {...marks,rating:'fuzzy',attempt:'fuzzy',reviewedAt:now});
    assert.equal(fuzzy.dueAt,now + 12 * 3600);
  } finally {
    await stop();
    await rm(dir, { recursive: true, force: true });
  }
});

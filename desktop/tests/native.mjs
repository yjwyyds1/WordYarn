import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

test('copies live WAL data and never replaces an existing desktop database', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wordyarn-migration-'));
  const exe = resolve(process.env.CET4_DESKTOP || 'desktop/dist/WordYarn.exe');
  const source = join(dir, 'web.sqlite'), dest = join(dir, 'desktop.sqlite');
  const db = new DatabaseSync(source);
  try {
    db.exec("PRAGMA journal_mode=WAL; CREATE TABLE progress(n); INSERT INTO progress VALUES(7);");
    await writeFile(dest + '.importing', 'interrupted copy');
    execFileSync(exe, ['--migrate', source, dest]);
    const copy = new DatabaseSync(dest);
    try {
      assert.equal(copy.prepare('SELECT n FROM progress').get().n, 7);
      copy.exec('UPDATE progress SET n=9');
      db.exec('UPDATE progress SET n=11');
      execFileSync(exe, ['--migrate', source, dest]);
      assert.equal(copy.prepare('SELECT n FROM progress').get().n, 9);
      assert.equal(db.prepare('SELECT n FROM progress').get().n, 11);
    } finally { copy.close(); }
  } finally { db.close(); await rm(dir, { recursive: true, force: true }); }
});

test('desktop HTTP API requires the per-launch token', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wordyarn-private-'));
  const exe = resolve(process.env.CET4_EXE || 'desktop/dist/cet4.exe');
  const port = 27000 + Math.floor(Math.random() * 12000);
  const url = 'http://127.0.0.1:' + port + '/api/study';
  const child = spawn(exe, [resolve('web/site'), join(dir, 'test.sqlite'), String(port)], {
    env: { ...process.env, CET4_DESKTOP_TOKEN: 'test-private-token' }, stdio: 'ignore'
  });
  let error;
  child.on('error', e => { error = e; });
  try {
    let response;
    for (let i = 0; i < 80; ++i) {
      if (error) throw error;
      if (child.exitCode !== null) throw Error('Server exited: ' + child.exitCode);
      try { response = await fetch(url); break; } catch { await new Promise(r => setTimeout(r, 100)); }
    }
    assert.equal(response?.status, 403);
    assert.equal((await fetch(url, { headers: { 'X-CET4-Token': 'test-private-token' } })).status, 200);
  } finally {
    if (child.pid && child.exitCode === null && child.signalCode === null)
      await new Promise(r => { child.once('exit', r); child.kill(); });
    await rm(dir, { recursive: true, force: true });
  }
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';

test('built-in voice speaks new text and pauses without restarting', () => {
  const calls = [], events = [];
  const window = {};
  runInNewContext(readFileSync(new URL('../assets/mobile.js', import.meta.url), 'utf8'), {
    window, document: { documentElement: { classList: { add() {} } } },
    AndroidSpeech: Object.fromEntries(['speak', 'pause', 'resume', 'stop'].map(
      method => [method, (...args) => calls.push([method, ...args])]))
  });
  const { synthesis, Utterance } = window.wordYarnAndroid;
  const utterance = new Utterance('These words were never recorded in advance.');
  utterance.voice = { voiceURI: 'wordyarn-kitten-7', speaker: 7 };
  utterance.onend = () => events.push('end');
  synthesis.speak(utterance);
  synthesis.pause();
  synthesis.resume();
  assert.deepEqual(calls.map(call => call[0]), ['speak', 'pause', 'resume']);
  assert.equal(calls[0][2], utterance.text);
  assert.equal(calls[0][5], 7);
  window.wordYarnSpeechEvent(1, 'end', 0, 0);
  assert.deepEqual(events, ['end']);
});

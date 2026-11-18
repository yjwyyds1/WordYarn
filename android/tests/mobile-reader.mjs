import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const { chromium } = createRequire(import.meta.url)(process.env.CET4_PLAYWRIGHT || 'playwright-core');
const origin = 'https://appassets.androidplatform.net';
const base = new URL('../build/assets/reader/', import.meta.url);

test('packaged mobile reader renders and keeps study state after reopening', async () => {
  const browser = await chromium.launch(process.env.CET4_EDGE ? { executablePath: process.env.CET4_EDGE } : {});
  try {
    const context = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
    const requested = [];
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      requested.push(url.href);
      if (url.origin !== origin) return route.abort();
      const contentType = { html: 'text/html', js: 'application/javascript', css: 'text/css', svg: 'image/svg+xml' }[url.pathname.split('.').at(-1)];
      await route.fulfill({ contentType: contentType + '; charset=utf-8', body: await readFile(new URL('.' + url.pathname, base)) });
    });
    await context.addInitScript(() => {
      window.spokenOnAndroid = [];
      window.AndroidSpeech = {
        speak(id, text) {
          spokenOnAndroid.push(text);
          setTimeout(() => window.wordYarnSpeechEvent(Number(id), 'end', 0, 0), 20);
        },
        stop() {}
      };
    });
    let page = await context.newPage();
    await page.goto(origin + '/index.html#ch01/read');
    await page.locator('.para[data-open=false]').first().waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 375);
    assert.equal(await page.locator('.tabs').evaluate(el => Math.round(el.getBoundingClientRect().bottom)), 812);
    await page.locator('.para-toggle').first().click();
    await page.locator('.para[data-open=true]').first().waitFor();
    await page.locator('#voiceSettings').click();
    const phrase = 'I can read a sentence that was never recorded.';
    await page.locator('#androidVoiceText').fill(phrase);
    await page.getByRole('button', { name: '试听' }).click();
    await page.waitForFunction(text => window.spokenOnAndroid.includes(text), phrase);
    await page.locator('#voiceDialog').getByRole('button', { name: '关闭' }).click();
    await page.getByRole('tab', { name: '闪卡' }).click();
    const word = await page.locator('.fc-word').textContent();
    await page.locator('.fc-actions [data-rate=known]').click();
    await page.close();
    page = await context.newPage();
    await page.goto(origin + '/index.html#ch01/today');
    await page.locator('#historyStudy').click();
    assert.match(await page.locator('#studyHistory').textContent(), new RegExp(word, 'i'));
    assert.ok(requested.every(url => url.startsWith(origin + '/') && !url.includes('/api/')));
  } finally {
    await browser.close();
  }
});

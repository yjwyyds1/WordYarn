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
    let cloudRequest;
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      requested.push(url.href);
      if (url.hostname === 'australiaeast.tts.speech.microsoft.com') {
        if (route.request().method() === 'POST') {
          cloudRequest = route.request().postData();
          if (route.request().headers()['ocp-apim-subscription-key'] === 'fake-key-for-test-success') {
            return route.fulfill({status:200, contentType:'audio/mpeg', body:'mock audio', headers:{'access-control-allow-origin':'*'}});
          }
          return route.fulfill({status:401, headers:{'access-control-allow-origin':'*'}});
        }
        return route.fulfill({status:204, headers:{
          'access-control-allow-origin':'*',
          'access-control-allow-methods':'POST',
          'access-control-allow-headers':'content-type,ocp-apim-subscription-key,x-microsoft-outputformat'
        }});
      }
      if (url.origin !== origin) return route.abort();
      const contentType = { html: 'text/html', js: 'application/javascript', css: 'text/css', svg: 'image/svg+xml', ico: 'image/x-icon' }[url.pathname.split('.').at(-1)];
      await route.fulfill({ contentType: contentType + '; charset=utf-8', body: await readFile(new URL('.' + url.pathname, base)) });
    });
    await context.addInitScript(() => {
      window.spokenOnAndroid = [];
      window.playedCloudAudio = [];
      window.Audio = class {
        constructor(src) { this.src = src; }
        play() {
          playedCloudAudio.push(this.src);
          this.onplaying?.();
          setTimeout(() => this.onended?.(), 20);
          return Promise.resolve();
        }
        pause() {}
        removeAttribute() {}
      };
      window.AndroidSpeech = {
        speak(id, text, rate, volume, speaker) {
          spokenOnAndroid.push({ text, speaker });
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
    assert.equal(await page.locator('#voiceChoice option').count(), 10); // Default, Natasha, eight Kitten voices.
    assert.match(await page.locator('#voiceChoice option').first().textContent(), /Kitten.*0/);
    const phrase = 'I can read a sentence that was never recorded.';
    await page.locator('#androidVoiceText').fill(phrase);
    await page.getByRole('button', { name: '试听' }).click();
    await page.waitForFunction(text => window.spokenOnAndroid.some(audio => audio.text === text && audio.speaker === 0), phrase);
    await page.locator('#voiceChoice').selectOption('wordyarn-kitten-7');
    await page.getByRole('button', { name: '试听' }).click();
    await page.waitForFunction(text => window.spokenOnAndroid.some(audio => audio.text === text && audio.speaker === 7), phrase);
    await page.locator('#voiceChoice').selectOption('wordyarn-natasha-online');
    assert.ok(await page.locator('#voiceDialog').evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth + 1));
    await page.locator('#natashaRegion').fill('australiaeast');
    await page.locator('#natashaKey').fill('fake-key-for-test-only');
    await page.locator('#androidVoiceText').fill('Read A & B.');
    await page.getByRole('button', { name: '试听' }).click();
    await page.getByText('Natasha 的 Azure 密钥或区域不匹配', {exact:true}).waitFor();
    assert.ok(cloudRequest.includes('en-AU-NatashaNeural'));
    assert.ok(cloudRequest.includes('Read A &amp; B.'));
    await page.locator('#natashaKey').fill('fake-key-for-test-success');
    await page.getByRole('button', { name: '试听' }).click();
    await page.waitForFunction(() => playedCloudAudio.some(url => url.startsWith('blob:')));
    assert.equal(await page.evaluate(() => Object.values(localStorage).join('').includes('fake-key-for-test-only')), false);
    await page.locator('#voiceChoice').selectOption('wordyarn-kitten-7');
    await page.locator('#voiceDialog').getByRole('button', { name: '关闭' }).click();
    await page.getByRole('tab', { name: '闪卡' }).click();
    const word = await page.locator('.fc-word').textContent();
    await page.locator('.fc-actions [data-rate=known]').click();
    await page.close();
    page = await context.newPage();
    await page.goto(origin + '/index.html#ch01/today');
    await page.locator('#historyStudy').click();
    assert.match(await page.locator('#studyHistory').textContent(), new RegExp(word, 'i'));
    assert.ok(requested.every(url => (url.startsWith(origin + '/') || url === 'https://australiaeast.tts.speech.microsoft.com/cognitiveservices/v1') && !url.includes('/api/')));
  } finally {
    await browser.close();
  }
});

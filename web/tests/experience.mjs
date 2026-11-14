import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.CET4_PLAYWRIGHT || 'playwright-core');
const base = 'http://127.0.0.1:18879/';

test('reader, word list, flashcards, dictation and activity dashboard', async () => {
  const server = spawn(process.execPath, ['web/tools/serve.mjs', '18879']);
  let browser;
  try {
    for (let j=0;j<40;j++) {
      try { if ((await fetch(base)).ok) break; } catch {}
      await new Promise(r=>setTimeout(r,100));
    }
    browser = await chromium.launch(process.env.CET4_EDGE ? {executablePath: process.env.CET4_EDGE} : {});
    const page = await browser.newPage({viewport:{width:1280,height:780},reducedMotion:'reduce'});
    const errors = [];
    page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(() => {
      window.spoken = [];
      Object.defineProperty(window, 'speechSynthesis', {value:{
        getVoices:()=>[], addEventListener(){}, cancel(){clearTimeout(this.timer);},
        pause(){clearTimeout(this.timer);}, resume(){this.timer=setTimeout(()=>this.current.onend?.(),500);},
        speak(u){spoken.push(u.text);window.lastVolume=u.volume;this.current=u;u.onstart?.();this.timer=setTimeout(()=>u.onend?.(),500);}
      }});
    });
    await page.route('**/api/**',route=>route.fulfill({status:404}));
    await page.goto(base+'#ch01/read');
    await page.locator('.para[data-open=true]').first().waitFor({timeout:4000});
    assert.equal(await page.locator('.para[data-open=false]').count(),0);
    const target = page.locator('.srow .w[data-w=boundary]').first();
    await target.evaluate(el=>window.scrollBy(0,el.getBoundingClientRect().top-105));
    await target.click();
    await page.locator('#pop').waitFor();
    assert.equal(await page.evaluate(()=>spoken.at(-1)),'boundary');
    const bounds=await page.locator('#pop').boundingBox();
    assert.ok(bounds.y >= 55 && bounds.y+bounds.height < 781);
    await page.locator('#pop [data-rate=new]').click();
    await page.keyboard.press('Escape');
    await page.locator('#voiceSettings').click();
    await page.locator('#voiceVolume').fill('70');
    await page.locator('#voicePreview').click();
    assert.ok(Math.abs(await page.evaluate(()=>lastVolume)-0.7) < 1e-6);
    await page.locator('#voiceDialog').getByRole('button',{name:'关闭'}).click();
    const playback = await page.locator('[data-say-para=p1]').boundingBox();
    assert.ok(playback.width < 150);
    await page.locator('[data-say-para=p1]').click();
    await page.locator('[data-say-para=p1]').filter({hasText:'暂停'}).click();
    await page.locator('[data-say-para=p1]').filter({hasText:'继续'}).waitFor();
    assert.equal(await page.locator('.para[data-para=p1] progress:visible').count(),1);
    await page.getByRole('tab',{name:'词表'}).click();
    await page.locator('#vocabSearch').fill('boundary');
    assert.equal(await page.locator('.card[data-w=boundary]').count(),1);
    await page.locator('.card[data-w=boundary] [data-speak-kind=origin]').first().click();
    assert.ok((await page.evaluate(()=>spoken.at(-1))).includes('boundary'));
    await page.locator('.card[data-w=boundary] [data-jump]').first().click();
    await page.locator('.srow.is-flash').filter({hasText:'boundary'}).waitFor();
    await page.getByRole('button',{name:'返回词表'}).click();
    assert.equal(await page.locator('#vocabSearch').inputValue(),'boundary');
    await page.getByRole('tab',{name:'闪卡'}).click();
    await page.locator('.fc-example').waitFor();
    const first = await page.locator('.fc-word').textContent();
    assert.ok((await page.evaluate(()=>spoken)).includes(first));
    await page.evaluate(() => document.body.dispatchEvent(new KeyboardEvent('keydown', {key:'3',repeat:true,bubbles:true})));
    assert.equal(await page.locator('.fc-word').textContent(), first);
    await page.locator('.fc-actions [data-rate=known]').click();
    assert.notEqual(await page.locator('.fc-word').textContent(),first);
    for(let j=0;j<5;j++) await page.locator('.fc-actions [data-rate=known]').click();
    await page.getByRole('tab',{name:'词表'}).click();
    await page.getByRole('tab',{name:'闪卡'}).click();
    assert.notEqual(await page.locator('.fc-word').textContent(), first);
    await page.locator('[data-restart]').click();
    assert.match(await page.locator('.fc-idx').first().textContent(), /待练 139/);
    await page.getByRole('tab',{name:'今日'}).click();
    await page.locator('#startDue').click();
    await page.getByRole('heading',{name:'今日听写'}).waitFor();
    await page.locator('.dictation-hint').filter({hasText:'边界'}).waitFor();
    await page.getByRole('button',{name:'重听单词'}).click();
    assert.equal(await page.evaluate(()=>spoken.at(-1)),'boundary');
    await page.locator('#exerciseAnswer').fill('Boundry');
    await page.getByRole('button',{name:'核对答案'}).click();
    assert.equal(await page.locator('.answer-yours strong').textContent(),'Boundry');
    assert.equal(await page.locator('.answer-correct strong').textContent(),'boundary');
    assert.equal(await page.locator('.answer-correct mark').textContent(),'a');
    await page.locator('[data-study-rate=known]').click();
    assert.match(await page.locator('#nextReviewReceipt').textContent(), /boundary · 下次复习/);
    await page.getByRole('button',{name:'完成',exact:true}).click();
    await page.getByRole('tab',{name:'统计'}).click();
    assert.equal(await page.locator('.chapter-stat').count(),30);
    assert.equal(await page.locator('.review-day').count(),7);
    assert.ok(await page.locator('.activity-cell[data-level]:not([data-level="0"])').count());
    const mobile = await browser.newPage({viewport:{width:375,height:812},isMobile:true,hasTouch:true});
    await mobile.goto(base+'#ch01/profile');
    await mobile.locator('.chapter-stat').first().waitFor();
    assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth),375);
    await page.setViewportSize({width:760,height:700});
    assert.equal(await page.locator('#btnNav').getAttribute('aria-expanded'),'false');
    await mobile.close();
    assert.deepEqual(errors,[]);
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
});

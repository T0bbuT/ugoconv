// ショートカットの読み込み係が GitHub Pages から本体を読み込んで変換を始められるか確かめる
const { chromium } = require('playwright');
const fs = require('fs');
const dir = __dirname;
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith('https://www.pixiv.net/artworks/')) return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' });
    if (url.includes('/ajax/illust/123/ugoira_meta')) return route.fulfill({ contentType: 'application/json', body: fs.readFileSync(dir + '/meta.json') });
    if (url.startsWith('https://i.pximg.net/')) return route.fulfill({ contentType: 'application/zip', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(dir + '/u.zip') });
    if (url.startsWith('https://t0bbut.github.io/ugoconv/shortcut-remote.js')) return route.fulfill({ contentType: 'application/javascript', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(dir + '/../docs/shortcut-remote.js') });
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto('https://www.pixiv.net/artworks/123');
  const result = await page.evaluate((c) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('completion が 3 秒以内に呼ばれなかった')), 3000);
    window.completion = (v) => { clearTimeout(timer); resolve(v); };
    (0, eval)(c);
  }), fs.readFileSync(dir + '/../docs/shortcut-loader.js', 'utf8'));
  console.log('loader ->', result);
  await page.waitForSelector('#ugoconv-root .save-row:not([hidden])', { state: 'attached', timeout: 30000 });
  console.log('loader OK:', await page.locator('#ugoconv-root .status').textContent());
  await browser.close();
})();

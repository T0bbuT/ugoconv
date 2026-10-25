// 短いブックマークレットが本体を読み込んで変換できるか確かめる
const { chromium } = require('playwright');
const fs = require('fs');
const dir = __dirname;
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ acceptDownloads: true });
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith('https://www.pixiv.net/artworks/')) return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' });
    if (url.includes('/ajax/illust/123/ugoira_meta')) return route.fulfill({ contentType: 'application/json', body: fs.readFileSync(dir + '/meta.json') });
    if (url.startsWith('https://i.pximg.net/')) return route.fulfill({ contentType: 'application/zip', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(dir + '/u.zip') });
    if (url.startsWith('https://t0bbut.github.io/ugoconv/bookmarklet.js')) return route.fulfill({ contentType: 'application/javascript', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(dir + '/../docs/bookmarklet.js') });
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto('https://www.pixiv.net/artworks/123');
  const code = decodeURIComponent(fs.readFileSync(dir + '/../docs/bookmarklet-loader.txt', 'utf8').slice('javascript:'.length));
  await page.evaluate((c) => (0, eval)(c), code);
  await page.waitForSelector('#ugoconv-root .panel:not([hidden])', { state: 'attached', timeout: 10000 });
  const dl = page.waitForEvent('download');
  await page.locator('#ugoconv-root [data-fmt=mp4]').click();
  const d = await dl;
  console.log('bookmarklet loader OK', d.suggestedFilename());
  await browser.close();
})();

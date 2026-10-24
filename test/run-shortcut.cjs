// iPhone ショートカットの「Web ページで JavaScript を実行」を真似て shortcut.js を動かす
const { chromium } = require('playwright');
const fs = require('fs');
const dir = __dirname;
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith('https://www.pixiv.net/artworks/')) return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body><h1>dummy</h1></body>' });
    if (url.includes('/ajax/illust/123/ugoira_meta')) return route.fulfill({ contentType: 'application/json', body: fs.readFileSync(dir + '/meta.json') });
    if (url.startsWith('https://i.pximg.net/')) return route.fulfill({ contentType: 'application/zip', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(dir + '/u.zip') });
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto('https://www.pixiv.net/artworks/123');
  const result = await page.evaluate((code) => new Promise((resolve) => {
    window.completion = resolve;
    (0, eval)(code);
  }), fs.readFileSync(dir + '/../docs/shortcut.js', 'utf8'));
  if (result.startsWith('ERROR')) console.log(result);
  else { fs.writeFileSync(dir + '/out-shortcut.mp4', Buffer.from(result, 'base64')); console.log('shortcut OK', Buffer.from(result, 'base64').length); }
  await browser.close();
})();

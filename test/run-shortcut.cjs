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
  // ショートカットと同じく、各呼び出しは completion() まで数秒以内に終わる必要がある
  const runAction = (code) => page.evaluate((c) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('completion が 3 秒以内に呼ばれなかった')), 3000);
    window.completion = (v) => { clearTimeout(timer); resolve(v); };
    (0, eval)(c);
  }), code);
  console.log('start ->', await runAction(fs.readFileSync(dir + '/../docs/shortcut.js', 'utf8')));
  const check = fs.readFileSync(dir + '/../src/shortcut-check.js', 'utf8');
  let result = '';
  for (let i = 0; i < 60 && !result; i++) {
    await page.waitForTimeout(500);
    result = await runAction(check);
  }
  if (!result || result.startsWith('ERROR')) console.log('shortcut FAILED', result);
  else { fs.writeFileSync(dir + '/out-shortcut.mp4', Buffer.from(result, 'base64')); console.log('shortcut OK', Buffer.from(result, 'base64').length); }
  await browser.close();
})();

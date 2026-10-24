const { chromium } = require('playwright');
const fs = require('fs');
const dir = __dirname;
const [mode, fmt, cors] = process.argv.slice(2); // mode: user|bm, fmt: mp4|gif, cors: yes|no
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ acceptDownloads: true, hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on('console', (m) => console.log('[console]', m.text()));
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith('https://www.pixiv.net/artworks/')) return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><h1>dummy pixiv</h1></body></html>' });
    if (url.includes('/ajax/illust/123/ugoira_meta')) return route.fulfill({ contentType: 'application/json', body: fs.readFileSync(dir + '/meta.json') });
    if (url.startsWith('https://i.pximg.net/')) {
      const ref = route.request().headers()['referer'] || '';
      if (!/pixiv\.net/.test(ref)) return route.fulfill({ status: 403, body: 'no referer' });
      const headers = cors === 'yes' ? { 'access-control-allow-origin': 'https://www.pixiv.net' } : {};
      return route.fulfill({ contentType: 'application/zip', headers, body: fs.readFileSync(dir + '/u.zip') });
    }
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto('https://www.pixiv.net/artworks/123#ugoconv=mp4');
  const code = fs.readFileSync(dir + '/../docs/' + (mode === 'bm' ? 'bookmarklet.js' : 'ugoira-converter.user.js'), 'utf8');
  await page.addScriptTag({ content: code });
  
  const dl = page.waitForEvent('download', { timeout: 60000 });
  await page.waitForSelector('#ugoconv-root .save-row:not([hidden])', { state: 'attached', timeout: 60000 }).catch(()=>{}); await page.screenshot({ path: dir + '/mobile.png' }); await page.locator('#ugoconv-root .save').click();
  const d = await Promise.race([dl, page.waitForTimeout(60000).then(() => null)]);
  console.log('status:', await page.locator('#ugoconv-root .status').textContent());
  if (d) { const p = `${dir}/out.${fmt}`; await d.saveAs(p); console.log('saved', d.suggestedFilename(), fs.statSync(p).size); }
  await browser.close();
})();

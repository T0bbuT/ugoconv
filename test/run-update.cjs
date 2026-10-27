// 更新のお知らせが、新しい版がある時だけ出ることを確かめる
const { chromium } = require('playwright');
const fs = require('fs');
const dir = __dirname;
(async () => {
  const browser = await chromium.launch();
  for (const latest of ['9.9.9', JSON.parse(fs.readFileSync(dir + '/../docs/version.json')).version]) {
    const page = await browser.newPage();
    await page.route('**/*', (route) => {
      const url = route.request().url();
      if (url.startsWith('https://t0bbut.github.io/ugohen/version.json')) return route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ version: latest }) });
      return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' });
    });
    await page.goto('https://www.pixiv.net/artworks/1');
    await page.addScriptTag({ content: fs.readFileSync(dir + '/../docs/ugoira-converter.user.js', 'utf8') });
    await page.waitForTimeout(500);
    await page.locator('#ugoconv-root .toggle').click();
    const shown = await page.locator('#ugoconv-root .update').isVisible();
    console.log(`latest=${latest} notice=${shown}`, shown ? await page.locator('#ugoconv-root .update a').textContent() : '');
    await page.close();
  }
  await browser.close();
})();

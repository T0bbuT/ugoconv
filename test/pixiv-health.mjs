// pixiv 側の仕様変更の見張り: 実際の pixiv から全年齢のうごイラ 1 作品を取って、
// main.js が前提にしている形(ugoira_meta の中身、zip の取得、zip 内のコマ)のままか確かめる。
// GitHub Actions で 1 日 1 回動かす。失敗したら GitHub からメールが届く。
// 使い方: node test/pixiv-health.mjs [作品ID]
import { unzipSync } from 'fflate';

const ID = process.argv[2] || process.env.UGOIRA_ID || '44298467';
const SITE = 'https://t0bbut.github.io/ugoconv/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const headers = { 'User-Agent': UA, Referer: 'https://www.pixiv.net/', 'Accept-Language': 'ja' };

const problems = [];
async function check(name, fn) {
  try {
    const note = await fn();
    console.log(`OK   ${name}${note ? ` (${note})` : ''}`);
    return true;
  } catch (e) {
    console.log(`NG   ${name}: ${e.message}`);
    problems.push(`${name}: ${e.message}`);
    return false;
  }
}
const must = (cond, msg) => { if (!cond) throw new Error(msg); };

let meta;
await check('作品ページ /artworks/{id} が開ける', async () => {
  const res = await fetch(`https://www.pixiv.net/artworks/${ID}`, { headers });
  must(res.ok, `HTTP ${res.status}`);
  return `HTTP ${res.status}`;
});

const metaOk = await check('ugoira_meta が今までと同じ形で返る', async () => {
  const res = await fetch(`https://www.pixiv.net/ajax/illust/${ID}/ugoira_meta`, { headers });
  const json = await res.json().catch(() => null);
  must(json, `JSON でない応答 (HTTP ${res.status})`);
  must(!json.error, `error: ${json.message}`);
  meta = json.body;
  must(meta && typeof meta === 'object', 'body がない');
  must(typeof (meta.originalSrc || meta.src) === 'string', 'originalSrc / src がない');
  must(Array.isArray(meta.frames) && meta.frames.length > 0, 'frames がない');
  for (const f of meta.frames) must(typeof f.file === 'string' && typeof f.delay === 'number', 'frames[] の file / delay の形が違う');
  return `${meta.frames.length} コマ, ${meta.mime_type}`;
});

if (metaOk) {
  const url = meta.originalSrc || meta.src;
  await check('i.pximg.net は Referer なしだと弾く（前提の確認）', async () => {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    must(res.status === 403, `HTTP ${res.status}（弾かなくなった。悪いことではないが仕様が変わった）`);
  });
  await check('zip が取れて、frames のコマが全部入っている', async () => {
    const res = await fetch(url, { headers });
    must(res.ok, `HTTP ${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    const files = unzipSync(buf);
    const missing = meta.frames.filter((f) => !files[f.file]).map((f) => f.file);
    must(missing.length === 0, `zip に無いコマ: ${missing.slice(0, 3).join(', ')}`);
    const first = files[meta.frames[0].file];
    const isJpeg = first[0] === 0xff && first[1] === 0xd8;
    const isPng = first[0] === 0x89 && first[1] === 0x50;
    must(isJpeg || isPng, 'コマが JPEG でも PNG でもない');
    return `${(buf.length / 1024 / 1024).toFixed(1)} MB, ${isJpeg ? 'JPEG' : 'PNG'}`;
  });
}

// 配布側(GitHub Pages)も毎回読み込まれるので、ついでに確かめる
for (const f of ['version.json', 'bookmarklet.js', 'shortcut-remote.js', 'ugoira-converter.user.js']) {
  await check(`配布ページの ${f} が取れる`, async () => {
    const res = await fetch(SITE + f, { cache: 'no-store' });
    must(res.ok, `HTTP ${res.status}`);
  });
}

if (problems.length) {
  console.log(`\n${problems.length} 件の問題（作品ID ${ID}）`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## うごイラ変換の見張りで問題が見つかりました\n\n作品ID: ${ID}\n\n${problems.map((p) => `- ${p}`).join('\n')}\n`);
  }
  process.exit(1);
}
console.log('\nすべて OK');

import { build } from 'esbuild';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
const VERSION = '0.3.2';
mkdirSync('docs', { recursive: true });
const opts = { bundle: true, minify: true, format: 'iife', target: ['safari16', 'chrome100', 'firefox115'], write: false, legalComments: 'none', define: { __VERSION__: JSON.stringify(VERSION) } };
const us = (await build({ ...opts, entryPoints: ['src/userscript.js'] })).outputFiles[0].text;
const header = `// ==UserScript==
// @name         うごイラ変換 (試作)
// @namespace    ugoira-converter-proto
// @version      ${VERSION}
// @description  pixiv のうごイラを端末内で MP4 / GIF に変換して保存します。サーバーを使いません。
// @match        https://www.pixiv.net/*
// @connect      i.pximg.net
// @connect      t0bbut.github.io
// @grant        GM.xmlHttpRequest
// @grant        GM_xmlhttpRequest
// @run-at       document-start
// @noframes
// @homepageURL  https://t0bbut.github.io/ugoconv/
// @downloadURL  https://t0bbut.github.io/ugoconv/ugoira-converter.user.js
// @updateURL    https://t0bbut.github.io/ugoconv/ugoira-converter.user.js
// ==/UserScript==
// 同梱ライブラリ: fflate (MIT), gifenc (MIT), mp4-muxer (MIT)
`;
writeFileSync('docs/ugoira-converter.user.js', header + us);
const bm = (await build({ ...opts, entryPoints: ['src/bookmarklet.js'] })).outputFiles[0].text.trim();
const bookmarklet = 'javascript:' + bm.replace(/[%#\n\r]/g, encodeURIComponent);
writeFileSync('docs/bookmarklet.txt', bookmarklet);
writeFileSync('docs/bookmarklet.js', bm);
const bmLoader = 'javascript:' + readFileSync('src/bookmarklet-loader.js', 'utf8').split('\n').filter((l) => l && !l.startsWith('//')).join('').replace(/[%#]/g, encodeURIComponent);
writeFileSync('docs/bookmarklet-loader.txt', bmLoader);
console.log('userscript', (header + us).length, 'bookmarklet', bookmarklet.length);
const html = readFileSync('src/index.html', 'utf8').replace('__BOOKMARKLET__', () => JSON.stringify(bmLoader).replace(/<\//g, '<\\/'));
writeFileSync('docs/index.html', html);
const check = readFileSync('src/shortcut-check.js', 'utf8').split('\n').filter((l) => l && !l.startsWith('//')).join('');
const sc = (await build({ ...opts, entryPoints: ['src/shortcut.js'] })).outputFiles[0].text.trim();
writeFileSync('docs/shortcut.js', sc);
const remote = (await build({ ...opts, entryPoints: ['src/shortcut-remote.js'] })).outputFiles[0].text.trim();
writeFileSync('docs/shortcut-remote.js', remote);
const loader = readFileSync('src/shortcut-loader.js', 'utf8').split('\n').filter((l) => l && !l.startsWith('//')).map((l) => l.trim()).join('');
writeFileSync('docs/shortcut-loader.js', loader);
writeFileSync('docs/shortcut.html', readFileSync('src/shortcut.html', 'utf8').replace('__LOADER_JS__', () => JSON.stringify(loader)).replace('__CHECK_JS__', () => JSON.stringify(check)).replace('__VERSION__', VERSION));
writeFileSync('docs/version.json', JSON.stringify({ version: VERSION }) + '\n');
console.log('shortcut', sc.length);

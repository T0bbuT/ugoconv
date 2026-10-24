import { build } from 'esbuild';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
const VERSION = '0.1.2';
mkdirSync('docs', { recursive: true });
const opts = { bundle: true, minify: true, format: 'iife', target: ['safari16', 'chrome100', 'firefox115'], write: false, legalComments: 'none' };
const us = (await build({ ...opts, entryPoints: ['src/userscript.js'] })).outputFiles[0].text;
const header = `// ==UserScript==
// @name         うごイラ変換 (試作)
// @namespace    ugoira-converter-proto
// @version      ${VERSION}
// @description  pixiv のうごイラを端末内で MP4 / GIF に変換して保存します。サーバーを使いません。
// @match        https://www.pixiv.net/*
// @connect      i.pximg.net
// @grant        GM.xmlHttpRequest
// @grant        GM_xmlhttpRequest
// @run-at       document-idle
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
console.log('userscript', (header + us).length, 'bookmarklet', bookmarklet.length);
const html = readFileSync('src/index.html', 'utf8').replace('__BOOKMARKLET__', () => JSON.stringify(bookmarklet).replace(/<\//g, '<\\/'));
writeFileSync('docs/index.html', html);

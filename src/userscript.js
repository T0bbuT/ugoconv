import { start, takeAutoFormat } from './main.js';

// document-start で動かし、pixiv が URL を書き換える前に自動変換の指定を読み取る
const autoFormat = takeAutoFormat();
const run = () => start({ autoFormat });
if (document.body) run();
else document.addEventListener('DOMContentLoaded', run, { once: true });

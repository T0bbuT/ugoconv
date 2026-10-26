import { start } from './main.js';
if (!/(^|\.)pixiv\.net$/.test(location.hostname)) alert('pixiv の作品ページで実行してください');
else start({ autoOpen: true, via: 'bookmarklet' });

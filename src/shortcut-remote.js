import { startForShortcut } from './main.js';

// ローダー(src/shortcut-loader.js)が GitHub Pages から読み込んで実行する本体。
// completion() はローダー側で呼ぶので、ここでは変換を始めるだけ
startForShortcut('mp4');

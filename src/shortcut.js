import { startForShortcut } from './main.js';

// iPhone の「ショートカット」アプリの「Web ページで JavaScript を実行」に貼り付けて使う。
// 変換を始めたらすぐ返す。completion() はショートカットが用意する関数
startForShortcut('mp4');
completion('started');

import { startForShortcut } from './main.js';

// iPhone の「ショートカット」アプリの「Web ページで JavaScript を実行」に貼り付けて使う。
// ショートカットの JavaScript は数秒で打ち切られ、大きなデータを返すのも間に合わないので、
// 変換を始めたらすぐ返し、保存はページのパネルから行う。completion() はショートカットが用意する関数
startForShortcut('mp4');
completion('started');

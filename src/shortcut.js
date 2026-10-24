import { runForShortcut } from './main.js';

// iPhone の「ショートカット」アプリの「Web ページで JavaScript を実行」に貼り付けて使う。
// completion() はショートカットが用意する関数で、渡した値がアクションの結果になる
runForShortcut('mp4').then(
  (base64) => completion(base64),
  (e) => completion(`ERROR: ${e.message || e}`),
);

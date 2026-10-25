// iPhone のショートカットに貼る読み込み係。実行のたびに最新の変換コードを GitHub Pages から読み込む。
// ショートカットの JavaScript は数秒で打ち切られるので、読み込んで変換を始めたらすぐ completion() を呼ぶ
fetch('https://t0bbut.github.io/ugoconv/shortcut-remote.js?t=' + Date.now(), { cache: 'no-store', credentials: 'omit' })
  .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
  .then(function (code) { (0, eval)(code); completion('started'); })
  .catch(function (e) { alert('うごイラ変換: 読み込みに失敗しました（' + e.message + '）'); completion('ERROR: ' + e.message); });

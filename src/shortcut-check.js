// ショートカットが繰り返し呼ぶ確認用コード。変換中は空文字、できたら MP4 の Base64 を返す
var j = window.__ugoconvJob;
completion(!j ? 'ERROR: 変換が始まっていません' : j.error ? 'ERROR: ' + j.error : (j.base64 || ''));

# ugoconv（うごイラ変換・試作）

pixiv のうごイラを、**利用者の端末の中で** MP4 / GIF に変換するユーザースクリプトです。変換用のサーバーを持たないので運営費がかかりません。ブラウザで pixiv にログインしていれば R-18 作品も変換できます。

- 配布ページ: https://t0bbut.github.io/ugoconv/
- 対応: PC（Tampermonkey / Violentmonkey）、iPhone（Safari + Userscripts アプリ、共有ショートカット）、Android（Firefox + Violentmonkey）、その他ブラウザはブックマークレット

## 仕組み

1. pixiv のページ上で `/ajax/illust/{id}/ugoira_meta` を取得（コマ画像 zip の URL と各コマの表示時間）
2. zip（i.pximg.net）をダウンロードして fflate で展開
3. MP4 は WebCodecs (H.264) + mp4-muxer、GIF は gifenc で組み立て
4. PC はそのままダウンロード、スマホは共有シートから保存

作品 URL に `#ugoconv=mp4` / `#ugoconv=gif` が付いていると自動で変換を始めます（iPhone の共有ショートカット用）。

## 開発

```sh
npm install
npm run build   # src/ → docs/（GitHub Pages で配信）
npm test        # ダミーの pixiv 応答で MP4 / GIF 変換を確認（Playwright）
```

## 注意

pixiv（ピクシブ株式会社）とは無関係の非公式ツールです。変換したファイルは個人で楽しむ範囲で使い、作者の許可なく転載しないでください。
同梱ライブラリ: fflate (MIT), gifenc (MIT), mp4-muxer (MIT)

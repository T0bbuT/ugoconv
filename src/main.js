// うごイラ変換: pixiv の作品ページ上で、うごイラを MP4 / GIF に端末内で変換する。
// ユーザースクリプトとブックマークレットの両方でこのファイルを使う。
import { unzipSync } from 'fflate';
import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';

const GIF_MAX_SIDE = 1000; // GIF は重いので長辺をここまで縮小する

// ---------- pixiv からの取得 ----------

function currentIllustId() {
  const m = location.pathname.match(/\/artworks\/(\d+)/) || location.search.match(/illust_id=(\d+)/);
  return m ? m[1] : null;
}

async function fetchMeta(id) {
  // 同一オリジンなので、ブラウザでのログイン状態(R-18 含む)がそのまま使われる
  const res = await fetch(`/ajax/illust/${id}/ugoira_meta`, { credentials: 'include' });
  const json = await res.json().catch(() => null);
  if (!json || json.error) {
    throw new Error(json?.message || 'うごイラ情報を取得できませんでした（うごイラでない作品か、ログインが必要です）');
  }
  return json.body; // { originalSrc, src, mime_type, frames: [{ file, delay }] }
}

function gmRequest() {
  if (typeof GM !== 'undefined' && GM.xmlHttpRequest) return GM.xmlHttpRequest.bind(GM);
  if (typeof GM_xmlhttpRequest !== 'undefined') return GM_xmlhttpRequest;
  return null;
}

function fetchViaGM(request, url, onProgress) {
  return new Promise((resolve, reject) => {
    request({
      method: 'GET',
      url,
      responseType: 'arraybuffer',
      headers: { Referer: 'https://www.pixiv.net/' },
      onprogress: (e) => e.total && onProgress(e.loaded / e.total),
      onload: (r) => (r.status === 200 ? resolve(new Uint8Array(r.response)) : reject(new Error(`zip の取得に失敗 (${r.status})`))),
      onerror: () => reject(new Error('zip の取得に失敗（通信エラー）')),
    });
  });
}

async function fetchZip(url, onProgress) {
  // pixiv のページ上なら Referer は自動で付く。CORS で弾かれた場合はユーザースクリプトの GM API で取り直す
  try {
    const res = await fetch(url, { credentials: 'omit', referrer: 'https://www.pixiv.net/' });
    if (!res.ok) throw new Error(`zip の取得に失敗 (${res.status})`);
    const total = Number(res.headers.get('content-length')) || 0;
    const reader = res.body.getReader();
    const chunks = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.length;
      if (total) onProgress(loaded / total);
    }
    const out = new Uint8Array(loaded);
    let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.length; }
    return out;
  } catch (e) {
    const request = gmRequest();
    if (!request) throw e;
    return fetchViaGM(request, url, onProgress);
  }
}

async function loadFrames(meta, onProgress) {
  const files = unzipSync(await fetchZip(meta.originalSrc || meta.src, (p) => onProgress('ダウンロード中', p)));
  const type = meta.mime_type || 'image/jpeg';
  // 画像のデコードは変換時に 1 コマずつ行う。全コマを先にデコードすると
  // 高解像度の作品でスマホのメモリが足りなくなり、Safari がページごと落ちる
  const frames = meta.frames.map((f) => {
    const data = files[f.file];
    if (!data) throw new Error(`zip 内に ${f.file} がありません`);
    return { blob: new Blob([data], { type }), delay: f.delay };
  });
  const first = await createImageBitmap(frames[0].blob);
  frames.width = first.width;
  frames.height = first.height;
  first.close();
  return frames;
}

async function drawFrame(ctx, frame, width, height) {
  const bitmap = await createImageBitmap(frame.blob);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
}

// ---------- 変換 ----------

const tick = () => new Promise((r) => setTimeout(r, 0));

async function pickAvcCodec(width, height) {
  for (const codec of ['avc1.640034', 'avc1.4d0034', 'avc1.42003e', 'avc1.42001f']) {
    const config = { codec, width, height, bitrate: bitrateFor(width, height), avc: { format: 'avc' } };
    try {
      const { supported } = await VideoEncoder.isConfigSupported(config);
      if (supported) return config;
    } catch { /* 次を試す */ }
  }
  return null;
}

function bitrateFor(w, h) {
  return Math.min(20_000_000, Math.max(2_000_000, Math.round(w * h * 8)));
}

export function canEncodeMp4() {
  return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
}

export async function encodeMp4(frames, onProgress) {
  if (!canEncodeMp4()) throw new Error('このブラウザは MP4 変換（WebCodecs）に対応していません。GIF をお試しください');
  const { width: w0, height: h0 } = frames;
  const width = w0 & ~1, height = h0 & ~1; // H.264 は偶数サイズが必要
  const config = await pickAvcCodec(width, height);
  if (!config) throw new Error('このブラウザでは H.264 エンコードが使えません。GIF をお試しください');

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width, height },
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });
  let encodeError = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { encodeError = e; },
  });
  encoder.configure(config);

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  let t = 0; // ms
  let sinceKey = Infinity;
  for (let i = 0; i < frames.length; i++) {
    if (encodeError) throw encodeError;
    const { delay } = frames[i];
    await drawFrame(ctx, frames[i], width, height);
    const frame = new VideoFrame(canvas, { timestamp: t * 1000, duration: delay * 1000 });
    const keyFrame = sinceKey >= 2000;
    encoder.encode(frame, { keyFrame });
    frame.close();
    sinceKey = keyFrame ? delay : sinceKey + delay;
    t += delay;
    while (encoder.encodeQueueSize > 2) await new Promise((r) => setTimeout(r, 5));
    onProgress('MP4 変換中', (i + 1) / frames.length);
  }
  await encoder.flush();
  encoder.close();
  if (encodeError) throw encodeError;
  muxer.finalize();
  return new Blob([muxer.target.buffer], { type: 'video/mp4' });
}

export async function encodeGif(frames, onProgress) {
  const { width: w0, height: h0 } = frames;
  const scale = Math.min(1, GIF_MAX_SIDE / Math.max(w0, h0));
  const width = Math.round(w0 * scale), height = Math.round(h0 * scale);
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const gif = GIFEncoder();
  for (let i = 0; i < frames.length; i++) {
    const { delay } = frames[i];
    await drawFrame(ctx, frames[i], width, height);
    const { data } = ctx.getImageData(0, 0, width, height);
    const palette = quantize(data, 256);
    const index = applyPalette(data, palette);
    gif.writeFrame(index, width, height, { palette, delay });
    onProgress('GIF 変換中', (i + 1) / frames.length);
    await tick(); // 画面が固まらないように
  }
  gif.finish();
  return new Blob([gif.bytes()], { type: 'image/gif' });
}

// ---------- 保存 ----------

async function saveBlob(blob, filename) {
  const file = new File([blob], filename, { type: blob.type });
  const isTouch = matchMedia('(pointer: coarse)').matches;
  // iPhone は共有シート経由（「ビデオを保存」で写真アプリへ）。Android の共有先には「保存」が無いので PC と同じくダウンロード
  if (isTouch && !/Android/i.test(navigator.userAgent) && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// ---------- 画面 ----------

const CSS = `
:host { all: initial; }
.fab { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; font: 14px/1.4 system-ui, sans-serif; }
.btn { border: 0; border-radius: 999px; padding: 10px 16px; background: #0096fa; color: #fff; font: inherit; font-weight: 600; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,.25); }
.btn:disabled { opacity: .5; cursor: default; }
.btn.sub { background: #fff; color: #333; }
.panel { position: absolute; right: 0; bottom: 52px; width: 260px; padding: 14px; border-radius: 12px; background: #fff; color: #222; box-shadow: 0 4px 20px rgba(0,0,0,.3); }
.panel[hidden], .row[hidden] { display: none; }
.row { display: flex; gap: 8px; margin-top: 10px; }
.row .btn { flex: 1; padding: 10px 8px; }
.status { min-height: 1.4em; font-size: 13px; color: #555; }
.bar { height: 6px; margin-top: 6px; border-radius: 3px; background: #eee; overflow: hidden; }
.bar > div { height: 100%; width: 0; background: #0096fa; transition: width .1s; }
.err { color: #d33; }
.title { font-weight: 700; margin-bottom: 6px; }
.title small { font-weight: 400; color: #999; }
.update { margin-top: 10px; font-size: 13px; }
.update[hidden] { display: none; }
.update a { color: #0096fa; font-weight: 600; }
.toggle.has-update::after { content: ''; display: inline-block; width: 8px; height: 8px; margin-left: 6px; border-radius: 50%; background: #ff5252; vertical-align: middle; }
`;

function createUI() {
  const host = document.createElement('div');
  host.id = 'ugoconv-root';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>${CSS}</style>
    <div class="fab">
      <div class="panel" hidden>
        <div class="title">うごイラ変換 <small>v${__VERSION__}</small></div>
        <div class="status">形式を選んでください</div>
        <div class="bar"><div></div></div>
        <div class="row">
          <button class="btn" data-fmt="mp4">MP4</button>
          <button class="btn" data-fmt="gif">GIF</button>
        </div>
        <div class="row save-row" hidden><button class="btn save">保存する</button></div>
        <div class="update" hidden><a target="_blank" rel="noopener"></a></div>
      </div>
      <button class="btn toggle">うごイラ変換</button>
    </div>`;
  document.body.appendChild(host);
  const $ = (s) => root.querySelector(s);
  const ui = {
    panel: $('.panel'),
    status: $('.status'),
    bar: $('.bar > div'),
    fmtButtons: [...root.querySelectorAll('[data-fmt]')],
    saveRow: $('.save-row'),
    saveBtn: $('.save'),
    toggle: $('.toggle'),
    update: $('.update'),
    setStatus(text, p, isError) {
      this.status.textContent = text;
      this.status.classList.toggle('err', !!isError);
      this.bar.style.width = `${Math.round((p ?? 0) * 100)}%`;
    },
    setBusy(busy) { this.fmtButtons.forEach((b) => { b.disabled = busy; }); },
  };
  return ui;
}

let ui = null;
let busy = false;
let pending = null; // { blob, filename }

// forShortcut: iPhone のショートカットから呼ばれた時。保存はショートカット側で行い、失敗は呼び出し元に投げる
async function convert(fmt, { forShortcut = false } = {}) {
  if (busy) return null;
  const id = currentIllustId();
  if (!id) {
    ui.setStatus('作品ページで実行してください', 0, true);
    if (forShortcut) throw new Error('pixiv の作品ページで実行してください');
    return null;
  }
  busy = true;
  pending = null;
  ui.saveRow.hidden = true;
  ui.setBusy(true);
  const onProgress = (label, p) => ui.setStatus(`${label}… ${Math.round(p * 100)}%`, p);
  try {
    ui.setStatus('うごイラ情報を取得中…', 0);
    const meta = await fetchMeta(id);
    const frames = await loadFrames(meta, onProgress);
    const blob = fmt === 'mp4' ? await encodeMp4(frames, onProgress) : await encodeGif(frames, onProgress);
    pending = { blob, filename: `pixiv_${id}.${fmt}` };
    const size = blob.size >= 1024 * 1024 ? `${(blob.size / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(blob.size / 1024)} KB`;
    ui.setStatus(forShortcut ? `完了（${size}）。「保存する」を押してください` : `完了（${size}）`, 1);
    ui.saveRow.hidden = false;
    // PC はそのまま保存。スマホの共有シートはタップ直後でないと開けないのでボタンを押してもらう
    // ショートカットの場合も、保存できなかった時のために「保存する」ボタンは出しておく
    if (!forShortcut && !matchMedia('(pointer: coarse)').matches) await saveBlob(pending.blob, pending.filename);
    return pending;
  } catch (e) {
    console.error('[ugoconv]', e);
    ui.setStatus(e.message || String(e), 0, true);
    if (forShortcut) throw e;
    return null;
  } finally {
    busy = false;
    ui.setBusy(false);
  }
}

// 共有ショートカットから #ugoconv=mp4 付きで開かれたかを調べる。
// pixiv はページ表示中に URL を書き換えて # 以降を消すことがあるので、
// ユーザースクリプトはページ読み込みの最初(document-start)にこれを呼んでおく。
// リダイレクトで消えた場合に備えて sessionStorage にも控える
const AUTO_KEY = 'ugoconv-auto';
export function takeAutoFormat() {
  const m = location.href.match(/[#?&]ugoconv(?:=(mp4|gif))?/);
  try {
    if (m) {
      const fmt = m[1] || 'mp4';
      sessionStorage.setItem(AUTO_KEY, JSON.stringify({ fmt, at: Date.now() }));
      return fmt;
    }
    const saved = JSON.parse(sessionStorage.getItem(AUTO_KEY) || 'null');
    if (saved && Date.now() - saved.at < 30_000) return saved.fmt;
  } catch { /* sessionStorage が使えない環境 */ }
  return null;
}

// ---------- 更新のお知らせ ----------
// iPhone の Userscripts アプリなどは自動更新されないので、1 日 1 回だけ最新の版数を確かめて知らせる

const SITE = 'https://t0bbut.github.io/ugoconv/';
const UPDATE_KEY = 'ugoconv-update';

function isNewer(a, b) {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

async function fetchLatestVersion() {
  try {
    const res = await fetch(`${SITE}version.json`, { cache: 'no-store', credentials: 'omit' });
    return (await res.json()).version;
  } catch (e) {
    const request = gmRequest();
    if (!request) throw e;
    return new Promise((resolve, reject) => request({
      method: 'GET',
      url: `${SITE}version.json?t=${Date.now()}`,
      onload: (r) => { try { resolve(JSON.parse(r.responseText).version); } catch (err) { reject(err); } },
      onerror: reject,
    }));
  }
}

async function checkUpdate() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(UPDATE_KEY) || 'null'); } catch { /* 無視 */ }
  let latest = saved?.latest;
  if (!saved || Date.now() - saved.at > 24 * 60 * 60 * 1000) {
    try {
      latest = await fetchLatestVersion();
      localStorage.setItem(UPDATE_KEY, JSON.stringify({ latest, at: Date.now() }));
    } catch { return; } // 確認できなくても変換には関係ないので黙って諦める
  }
  if (!latest || !isNewer(latest, __VERSION__)) return;
  const link = ui.update.querySelector('a');
  link.href = `${SITE}ugoira-converter.user.js`;
  link.textContent = `新しい版 v${latest} があります → 更新する`;
  ui.update.hidden = false;
  ui.toggle.classList.add('has-update');
}

export function start({ autoOpen = false, autoFormat = takeAutoFormat(), updateCheck = false } = {}) {
  // 同じ版が既に動いていれば開くだけ。古い版が残っていたら(入れ直しで重複した時など)置き換える
  if (window.__ugoconv?.version === __VERSION__) {
    window.__ugoconv.open();
    return;
  }
  document.getElementById('ugoconv-root')?.remove();
  ui = createUI();
  const open = () => { ui.panel.hidden = false; };
  window.__ugoconv = { open, version: __VERSION__ };
  ui.toggle.addEventListener('click', () => { ui.panel.hidden = !ui.panel.hidden; });
  ui.fmtButtons.forEach((b) => b.addEventListener('click', () => convert(b.dataset.fmt)));
  ui.saveBtn.addEventListener('click', () => pending && saveBlob(pending.blob, pending.filename));
  if (!canEncodeMp4()) ui.fmtButtons[0].title = 'このブラウザは MP4 変換に未対応の可能性があります';

  // 作品ページ以外ではボタンを隠す（pixiv はページ遷移なしで URL が変わるので監視する）
  const syncVisibility = () => {
    ui.toggle.parentElement.style.display = currentIllustId() ? '' : 'none';
  };
  syncVisibility();
  setInterval(syncVisibility, 1000);

  // 共有ショートカットから #ugoconv=mp4 付きで開かれたら自動で変換
  if (updateCheck) checkUpdate();

  if (autoFormat && currentIllustId()) {
    try { sessionStorage.removeItem(AUTO_KEY); } catch { /* 無視 */ }
    if (/ugoconv/.test(location.hash)) history.replaceState(history.state, '', location.pathname + location.search);
    open();
    convert(autoFormat);
  } else if (autoOpen) {
    open();
  }
}

// ---------- iPhone のショートカット用 ----------
// ショートカットの「Web ページで JavaScript を実行」は数秒で打ち切られるので、変換を始めてすぐ返す。
// 保存はパネルの「保存する」から行う(数 MB の結果をショートカットへ返すのも時間切れになった)。
// src/shortcut-check.js を繰り返し呼べば Base64 で受け取ることもできる

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export function startForShortcut(fmt = 'mp4') {
  const id = currentIllustId();
  const running = window.__ugoconvJob;
  if (running && running.id === id && !running.error) return; // 同じ作品の変換中・変換済みならそのまま
  const job = { id, base64: null, error: null };
  window.__ugoconvJob = job;
  start({ autoOpen: true });
  convert(fmt, { forShortcut: true })
    .then((result) => {
      if (!result) throw new Error('すでに変換中です');
      return blobToBase64(result.blob);
    })
    .then((base64) => { job.base64 = base64; })
    .catch((e) => { job.error = e.message || String(e); });
}

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
  const zip = await fetchZip(meta.originalSrc || meta.src, (p) => onProgress('ダウンロード中', p));
  const files = unzipSync(zip);
  const type = meta.mime_type || 'image/jpeg';
  const frames = [];
  for (let i = 0; i < meta.frames.length; i++) {
    const f = meta.frames[i];
    const data = files[f.file];
    if (!data) throw new Error(`zip 内に ${f.file} がありません`);
    frames.push({ bitmap: await createImageBitmap(new Blob([data], { type })), delay: f.delay });
    onProgress('展開中', (i + 1) / meta.frames.length);
  }
  return frames;
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
  const { width: w0, height: h0 } = frames[0].bitmap;
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
    const { bitmap, delay } = frames[i];
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    const frame = new VideoFrame(canvas, { timestamp: t * 1000, duration: delay * 1000 });
    const keyFrame = sinceKey >= 2000;
    encoder.encode(frame, { keyFrame });
    frame.close();
    sinceKey = keyFrame ? delay : sinceKey + delay;
    t += delay;
    while (encoder.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 5));
    onProgress('MP4 変換中', (i + 1) / frames.length);
  }
  await encoder.flush();
  encoder.close();
  if (encodeError) throw encodeError;
  muxer.finalize();
  return new Blob([muxer.target.buffer], { type: 'video/mp4' });
}

export async function encodeGif(frames, onProgress) {
  const { width: w0, height: h0 } = frames[0].bitmap;
  const scale = Math.min(1, GIF_MAX_SIDE / Math.max(w0, h0));
  const width = Math.round(w0 * scale), height = Math.round(h0 * scale);
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const gif = GIFEncoder();
  for (let i = 0; i < frames.length; i++) {
    const { bitmap, delay } = frames[i];
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
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
  // スマホは共有シート経由（「ビデオを保存」で写真アプリへ）、PC は通常のダウンロード
  if (isTouch && navigator.canShare?.({ files: [file] })) {
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
.panel[hidden] { display: none; }
.row { display: flex; gap: 8px; margin-top: 10px; }
.row .btn { flex: 1; padding: 10px 8px; }
.status { min-height: 1.4em; font-size: 13px; color: #555; }
.bar { height: 6px; margin-top: 6px; border-radius: 3px; background: #eee; overflow: hidden; }
.bar > div { height: 100%; width: 0; background: #0096fa; transition: width .1s; }
.err { color: #d33; }
.title { font-weight: 700; margin-bottom: 6px; }
`;

function createUI() {
  const host = document.createElement('div');
  host.id = 'ugoconv-root';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>${CSS}</style>
    <div class="fab">
      <div class="panel" hidden>
        <div class="title">うごイラ変換</div>
        <div class="status">形式を選んでください</div>
        <div class="bar"><div></div></div>
        <div class="row">
          <button class="btn" data-fmt="mp4">MP4</button>
          <button class="btn" data-fmt="gif">GIF</button>
        </div>
        <div class="row save-row" hidden><button class="btn save">保存する</button></div>
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

async function convert(fmt) {
  if (busy) return;
  const id = currentIllustId();
  if (!id) { ui.setStatus('作品ページで実行してください', 0, true); return; }
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
    frames.forEach((f) => f.bitmap.close());
    pending = { blob, filename: `pixiv_${id}.${fmt}` };
    const size = blob.size >= 1024 * 1024 ? `${(blob.size / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(blob.size / 1024)} KB`;
    ui.setStatus(`完了（${size}）`, 1);
    ui.saveRow.hidden = false;
    // PC はそのまま保存。スマホの共有シートはタップ直後でないと開けないのでボタンを押してもらう
    if (!matchMedia('(pointer: coarse)').matches) await saveBlob(pending.blob, pending.filename);
  } catch (e) {
    console.error('[ugoconv]', e);
    ui.setStatus(e.message || String(e), 0, true);
  } finally {
    busy = false;
    ui.setBusy(false);
  }
}

export function start({ autoOpen = false } = {}) {
  if (window.__ugoconv) {
    window.__ugoconv.open();
    return;
  }
  ui = createUI();
  const open = () => { ui.panel.hidden = false; };
  window.__ugoconv = { open };
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
  const auto = location.hash.match(/ugoconv(?:=(mp4|gif))?/);
  if (auto) {
    open();
    history.replaceState(null, '', location.pathname + location.search);
    convert(auto[1] || 'mp4');
  } else if (autoOpen) {
    open();
  }
}

// Волна для YouTube Music — караоке на весь экран, живая обложка, темы
(() => {
  if (window.__volnaExt) return;
  window.__volnaExt = true;

  const ext = chrome.runtime;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ask = (m) => new Promise((r) => { try { ext.sendMessage(m, (x) => { void chrome.runtime.lastError; r(x); }); } catch { r(null); } });
  const clean = (s) => String(s || '').replace(/\(.*?\)|\[.*?\]/g, '').replace(/\b(feat|ft)\.?.*$/i, '').replace(/official|video|audio|lyrics|клип|remaster(ed)?/gi, '').replace(/\s+/g, ' ').trim();
  // YouTube Music требует Trusted Types для вставки HTML — заводим свою политику
  let TT = null;
  try { TT = window.trustedTypes?.createPolicy?.('volna-ext', { createHTML: (x) => x }) || null; } catch { TT = null; }
  const setHTML = (el, html) => { el.innerHTML = TT ? TT.createHTML(html) : html; };
  const fmt = (x) => { x = Math.max(0, Math.round(x)); return Math.floor(x / 60) + ':' + String(x % 60).padStart(2, '0'); };

  let host = null, root = null, open = false, btn = null;

  /* ================= НАСТРОЙКИ ================= */
  const DEF = { theme: 'moon', acc: '', blur: 0, dim: 45, panel: 55, fx: 'sway', size: 100, customBg: '', autoOpen: false, btn: true };
  const THEMES = { none: { acc: '#ff4e45' }, moon: { acc: '#7aa7ff', img: 'bg/moon.jpg' }, sakura: { acc: '#ff7eb6', img: 'bg/sakura.jpg' }, neon: { acc: '#b67cff', img: 'bg/neon.jpg' }, forest: { acc: '#5fd39a', img: 'bg/forest.jpg' }, custom: { acc: '#ffd166' } };
  let C = { ...DEF };
  const acc = () => C.acc || THEMES[C.theme]?.acc || '#b67cff';

  function applyTheme() {
    const h = document.documentElement, on = C.theme !== 'none';
    h.classList.toggle('volna-theme', on);
    h.style.setProperty('--volna-acc', acc());
    let bg = document.getElementById('volna-bg');
    if (!bg) { bg = document.createElement('div'); bg.id = 'volna-bg'; document.body.prepend(bg); }
    const img = C.theme === 'custom' ? C.customBg : THEMES[C.theme]?.img ? chrome.runtime.getURL(THEMES[C.theme].img) : '';
    h.style.setProperty('--volna-img', img ? `url("${img}")` : 'none');
    h.style.setProperty('--volna-blur', (C.blur || 0) + 'px');
    h.style.setProperty('--volna-dim', ((C.dim ?? 45) / 100).toFixed(2));
    h.style.setProperty('--volna-panel', ((C.panel ?? 55) / 100).toFixed(2));
    if (host) { host.style.setProperty('--acc', acc()); root.querySelector('.vl')?.style.setProperty('--size', (C.size || 100) / 100); fxUI(); }
    placeBtn();
  }

  /* ================= ПЛЕЕР YOUTUBE MUSIC ================= */
  const video = () => document.querySelector('video');
  const now = () => video()?.currentTime || 0;
  const dur = () => { const d = video()?.duration; return isFinite(d) ? d : 0; };
  const paused = () => { const v = video(); return !v || v.paused; };
  const isAd = () => !!document.querySelector('.ad-showing, .ytp-ad-player-overlay, .ytmusic-ad');
  function meta() {
    const m = navigator.mediaSession?.metadata;
    let title = m?.title || '', artist = m?.artist || '', art = '';
    if (m?.artwork?.length) art = [...m.artwork].sort((a, b) => (parseInt(b.sizes) || 0) - (parseInt(a.sizes) || 0))[0].src;
    if (!title) {
      title = document.querySelector('.ytmusicTrackInfoTitle, ytmusic-player-bar .title')?.textContent?.trim() || '';
      artist = document.querySelector('.ytmusicTrackInfoSubtitle, ytmusic-player-bar .byline')?.textContent?.split('•')[0]?.trim() || '';
    }
    if (!title) return null;
    art = art.replace(/=w\d+-h\d+/, '=w1200-h1200').replace(/\/(hq|mq|sd)default\.jpg/, '/maxresdefault.jpg');
    return { title, artist, art };
  }
  function clickCtl(name) {
    const b = document.querySelector(`.ytmusicPlayerControls${name}Button button, .${name.toLowerCase()}-button`);
    if (b) b.click();
  }
  const playPause = () => { const v = video(); if (!v) return; v.paused ? v.play() : v.pause(); };

  /* ================= ОКНО КАРАОКЕ (Shadow DOM) ================= */
  const FX = [['pulse', 'Пульс'], ['sway', 'Качание'], ['tilt', '3D'], ['float', 'Плавно'], ['off', 'Без']];
  const MIC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 12c2-6 4-6 6 0s4 6 6 0 3-5 4-3"/></svg>';

  function build() {
    host = document.createElement('div');
    host.id = 'volna-karaoke';
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483000;pointer-events:none;';
    root = host.attachShadow({ mode: 'open' });
    setHTML(root, `<style>${CSS}</style>
<div class="vl" role="dialog" aria-label="Караоке Волны">
  <div class="bg" id="bg"></div><div class="tint"></div>
  <header>
    <div class="th" id="th"></div>
    <div class="tt"><b id="ti">—</b><span id="ar"></span></div>
    <div class="sp"></div>
    <div class="off" id="off" title="Сдвиг текста, если слова не в такт"><button data-off="-0.3" title="Текст позже">−</button><button data-off="0" id="ov" title="Сбросить">0.0 с</button><button data-off="0.3" title="Текст раньше">+</button></div>
    <button class="pill" id="fix">Найти вручную</button>
    <button class="x" id="x" title="Закрыть (Esc)">×</button>
  </header>
  <main>
    <section class="stage" id="stage">
      <div class="cov" id="cov"><i></i></div>
      <div class="eq">${[14, 26, 20, 30, 16, 24, 12].map((h) => `<b style="--h:${h}px"></b>`).join('')}</div>
      <div class="fx" id="fx">${FX.map(([k, n]) => `<button data-fx="${k}">${n}</button>`).join('')}</div>
    </section>
    <div class="body" id="body"><p class="msg">Включи песню — и текст побежит в такт.</p></div>
  </main>
</div>`);
    document.documentElement.appendChild(host);
    host.style.setProperty('--acc', acc());
    $$('#x').onclick = () => toggle(false);
    $$('#fix').onclick = manualForm;
    $$('#off').onclick = (e) => {
      const b = e.target.closest('[data-off]'); if (!b || !cur) return;
      const v = b.dataset.off === '0' ? 0 : Math.round(((offs[cur.key] || 0) + +b.dataset.off) * 10) / 10;
      if (v) offs[cur.key] = v; else delete offs[cur.key];
      chrome.storage.local.set({ offs }); offUI(); L.idx = -2;
    };
    $$('#fx').onclick = (e) => { const b = e.target.closest('[data-fx]'); if (!b) return; C.fx = b.dataset.fx; chrome.storage.local.set({ fx: C.fx }); fxUI(); };
    const body = $$('#body');
    body.addEventListener('click', (e) => { const l = e.target.closest('.ly[data-t]'); if (l && video()) { video().currentTime = Math.max(0, +l.dataset.t - curOff() + 0.01); L.user = 0; L.idx = -2; } });
    ['wheel', 'touchmove'].forEach((ev) => body.addEventListener(ev, () => (L.user = Date.now()), { passive: true }));
    root.querySelector('.vl').style.setProperty('--size', (C.size || 100) / 100);
    fxUI();
  }
  const $$ = (s) => root.querySelector(s);

  function toggle(force) {
    const want = force === undefined ? !open : force;
    if (want === open) return;
    if (!host) build();
    open = want;
    host.style.pointerEvents = open ? 'auto' : 'none';
    root.querySelector('.vl').classList.toggle('open', open);
    btn?.classList.toggle('on', open);
    if (open) { L.idx = -2; L.user = 0; if (cur) showTrack(); requestAnimationFrame(loop); }
  }

  /* ================= ТЕКУЩАЯ ПЕСНЯ ================= */
  let cur = null, offs = {};
  chrome.storage.local.get({ offs: {} }, (v) => (offs = v.offs || {}));
  const curOff = () => (cur ? offs[cur.key] || 0 : 0);
  function offUI() { if (!root) return; const v = curOff(); $$('#ov').textContent = (v > 0 ? '+' : '') + v.toFixed(1) + ' с'; $$('#off').classList.toggle('on', !!v); }

  setInterval(() => {
    const m = meta(); if (!m || isAd()) return;
    const key = (m.artist + '|' + m.title).toLowerCase();
    if (cur && cur.key === key) { if (m.art && cur.art !== m.art) { cur.art = m.art; artUI(); } return; }
    cur = { ...m, key };
    L.lrc = null; L.idx = -2;
    loadLyrics(cur);
    loadBpm(cur);
    if (host) showTrack();
    if (C.autoOpen && !open) toggle(true);
  }, 700);

  function showTrack() {
    $$('#ti').textContent = cur.title; $$('#ar').textContent = cur.artist;
    artUI(); offUI();
  }
  async function artUI() {
    if (!root || !cur) return;
    const u = cur.art ? `url("${cur.art}")` : 'none';
    for (const id of ['th', 'cov', 'bg']) $$('#' + id).style.backgroundImage = u;
    // цвет свечения из обложки
    const c = cur; if (!c.art) return;
    const data = await ask({ type: 'image', url: c.art });
    if (!data || cur !== c) return;
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement('canvas'); cv.width = cv.height = 24; const g = cv.getContext('2d'); g.drawImage(img, 0, 0, 24, 24);
      const d = g.getImageData(0, 0, 24, 24).data; let best = null, bs = -1;
      for (let i = 0; i < d.length; i += 4) { const r = d[i], gg = d[i + 1], b = d[i + 2], mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), s = mx - mn, sc = s * (mx > 40 && mx < 245 ? 1 : 0.3); if (sc > bs) { bs = sc; best = [r, gg, b]; } }
      if (best && cur === c) { const vl = root.querySelector('.vl'); vl.style.setProperty('--glow', `rgb(${best.join(',')})`); vl.style.setProperty('--lbg', `rgb(${best.map((v) => Math.round(v * 0.42)).join(',')})`); }
    };
    img.src = data;
  }

  /* ================= ТЕКСТ ================= */
  const L = { lrc: null, els: [], idx: -2, user: 0, tok: 0, warn: '' };
  const lyrCache = new Map();
  function parseLRC(txt) {
    const out = [];
    for (const raw of txt.split('\n')) {
      const tags = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)]; if (!tags.length) continue;
      const body = raw.replace(/\[[^\]]*\]/g, '');
      const wt = [...body.matchAll(/<(\d+):(\d+(?:\.\d+)?)>([^<]*)/g)];
      const words = wt.length ? wt.map((m) => ({ t: +m[1] * 60 + +m[2], text: m[3].trim() })).filter((w) => w.text) : null;
      const text = body.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
      for (const m of tags) out.push({ t: +m[1] * 60 + +m[2], text, words: words && words.map((w) => ({ ...w })) });
    }
    out.sort((a, b) => a.t - b.t);
    out.forEach((l, i) => {
      const next = out[i + 1]?.t ?? l.t + 6, gap = next - l.t, est = l.text.length * 0.1 + 0.8;
      const d = Math.max(0.5, gap < 7 ? gap * 0.9 : Math.min(gap - 0.1, est * 1.3));
      if (l.words && l.words.length) l.words.forEach((w, k) => { w.d = Math.max(0.1, (l.words[k + 1]?.t ?? l.t + d) - w.t); });
      else { const parts = l.text.split(' ').filter(Boolean), tot = parts.reduce((s, p) => s + p.length + 1, 0) || 1; let a = l.t; l.words = parts.map((p) => { const dd = d * (p.length + 1) / tot, w = { t: a, d: dd, text: p }; a += dd; return w; }); }
    });
    return out;
  }
  async function loadLyrics(t, manual) {
    const tok = ++L.tok; L.lrc = null; L.els = []; L.idx = -2; L.warn = '';
    if (root) setHTML($$('#body'), '<p class="msg">Ищу текст…</p>');
    const q = { artist: clean(manual?.artist ?? t.artist), title: clean(manual?.title ?? t.title) };
    let list = !manual && lyrCache.get(t.key);
    if (!list) { list = (await ask({ type: 'lyrics', ...q })) || []; if (list.length) lyrCache.set(t.key, list); }
    // ждём длительность песни, чтобы выбрать версию текста под неё
    for (let k = 0; k < 20 && !dur(); k++) await new Promise((r) => setTimeout(r, 200));
    if (tok !== L.tok) return;
    const d = dur(), syn = list.filter((x) => x.synced);
    let hit = null;
    if (syn.length) {
      hit = d ? syn.reduce((m, x) => (Math.abs(x.duration - d) < Math.abs(m.duration - d) ? x : m)) : syn[0];
      const delta = d && hit.duration ? d - hit.duration : 0;
      if (Math.abs(delta) > 4) L.warn = `Эта версия песни на ${Math.round(Math.abs(delta))} с ${delta > 0 ? 'длиннее' : 'короче'} текста — если слова не в такт, подвинь их кнопками ± вверху.`;
    } else hit = list.find((x) => x.plain) || null;
    L.hit = hit; render();
  }
  function render() {
    if (!root) return;
    const body = $$('#body'), hit = L.hit;
    if (!hit) { setHTML(body, `<p class="msg">${L.tok && cur ? 'Текст не найден. Нажми «Найти вручную» и уточни артиста и название.' : 'Включи песню — и текст побежит в такт.'}</p>`); return; }
    if (hit.synced) {
      L.lrc = parseLRC(hit.synced);
      setHTML(body, (L.warn ? `<p class="warn">${esc(L.warn)}</p>` : '') + '<div class="ly dots" data-i="-1"><i></i><i></i><i></i></div>' +
        L.lrc.map((l, i) => `<p class="ly" data-i="${i}" data-t="${l.t}">${l.text ? l.words.map((w) => `<span class="w">${esc(w.text)} </span>`).join('') : '♪'}</p>`).join(''));
      L.els = [...body.querySelectorAll('.ly')];
    } else {
      L.lrc = null; L.els = [];
      setHTML(body, `<div class="plain">${esc(hit.plain)}</div><p class="msg small">У этой песни текст без таймингов.</p>`);
    }
    L.idx = -2; body.scrollTop = 0;
  }
  function manualForm() {
    if (!cur) return;
    setHTML($$('#body'), `<form class="mf" id="mf"><b>Найти текст вручную</b><input id="mA" placeholder="Артист" value="${esc(cur.artist)}"><input id="mT" placeholder="Название" value="${esc(cur.title)}"><button class="pill acc">Искать</button></form>`);
    $$('#mf').onsubmit = (e) => { e.preventDefault(); lyrCache.delete(cur.key); loadLyrics(cur, { artist: $$('#mA').value, title: $$('#mT').value }); };
    $$('#mA').focus();
  }
  function sync(time) {
    if (!L.lrc || !L.els.length) return;
    time += curOff();
    let i = -1; for (let k = 0; k < L.lrc.length; k++) { if (L.lrc[k].t <= time + 0.12) i = k; else break; }
    if (i !== L.idx) {
      L.idx = i;
      L.els.forEach((el) => { const k = +el.dataset.i; el.classList.toggle('on', k === i); el.classList.toggle('past', k < i && k >= 0); el.classList.toggle('far', Math.abs(k - i) > 3); if (k !== i) el.querySelectorAll('.w').forEach((w) => w.style.removeProperty('--f')); });
      L.els[0].style.display = i === -1 ? '' : 'none';
      const el = L.els[i + 1], b = $$('#body');
      if (el && Date.now() - L.user > 3500) b.scrollTo({ top: el.offsetTop - b.clientHeight * 0.32, behavior: 'smooth' });
    }
    if (i >= 0) {
      const ln = L.lrc[i], ws = L.els[i + 1].querySelectorAll('.w');
      ln.words.forEach((w, k) => { if (ws[k]) ws[k].style.setProperty('--f', (Math.max(0, Math.min(1, (time - w.t) / w.d)) * 100).toFixed(1) + '%'); });
    }
  }

  /* ================= ОБЛОЖКА: ПУЛЬС / КАЧАНИЕ ПОД ТЕКСТ ================= */
  const beat = { bpm: 0, off: 0, lastW: null, kick: null, env: 0, w: -1 };
  const sway = { w: null, dir: 1, tgt: 0, ph: 0, at: 0, pw: 9 };
  const bpmCache = new Map();
  async function loadBpm(t) {
    beat.bpm = 0; beat.off = 0; beat.lastW = null; beat.kick = null;
    if (bpmCache.has(t.key)) { beat.bpm = bpmCache.get(t.key); return; }
    const b = (await ask({ type: 'bpm', q: (clean(t.artist) + ' ' + clean(t.title)).trim() })) || 0;
    bpmCache.set(t.key, b); if (cur === t) beat.bpm = b;
  }
  function wordStart(t) { const ln = L.lrc?.[L.idx]; if (!ln || !ln.words) return null; let w = null; for (const x of ln.words) { if (x.t <= t) w = x.t; else break; } return w; }
  function fxUI() { if (!root) return; $$('#stage').dataset.fx = C.fx || 'sway'; root.querySelectorAll('#fx button').forEach((b) => b.classList.toggle('on', b.dataset.fx === (C.fx || 'sway'))); }
  function beatTick() {
    const st = $$('#stage'), play = cur && !paused(), t = now() + curOff();
    let v = 0;
    if (play) {
      const w = wordStart(t);
      if (w != null && w !== beat.lastW) { beat.lastW = w; beat.kick = t; if (beat.bpm) { const P = 60 / beat.bpm; let e = ((w - beat.off) % P + P) % P; if (e > P / 2) e -= P; beat.off += e * 0.3; } }
      if (beat.bpm) { const P = 60 / beat.bpm, ph = (((t - beat.off) % P) + P) % P / P; v = Math.exp(-ph * 5.5); }
      else if (beat.kick != null) v = Math.exp(-Math.max(0, t - beat.kick) * 6) * 0.8;
    }
    beat.env = Math.max(v, beat.env * 0.86); if (beat.env < 0.004) beat.env = 0;
    if (Math.abs(beat.env - beat.w) > 0.012 || (beat.env === 0 && beat.w !== 0)) {
      beat.w = beat.env; const x = beat.env.toFixed(2); st.style.setProperty('--beat', x);
      const ln = L.els[L.idx + 1]; if (ln !== beat.line) { beat.line?.style.removeProperty('--beat'); beat.line = ln; } ln?.style.setProperty('--beat', x);
    }
    // качание: на каждое новое слово — плавный наклон в другую сторону, в паузах успокаивается
    const fx = C.fx || 'sway'; let ph = 0;
    if (fx === 'float') ph = Math.sin(performance.now() / 1000 * 1.1) * 0.8;
    else if (fx === 'sway' || fx === 'tilt') {
      const w = play && L.lrc ? wordStart(t) : null, n = performance.now();
      if (w != null && w !== sway.w) { sway.w = w; sway.dir = -sway.dir; sway.tgt = sway.dir; sway.at = n; }
      if (!play || n - sway.at > 1600) sway.tgt = 0;
      sway.ph += (sway.tgt - sway.ph) * 0.06; ph = sway.ph;
    }
    if (Math.abs(ph - sway.pw) > 0.01) { sway.pw = ph; st.style.setProperty('--ph', ph.toFixed(3)); }
  }

  function loop() {
    if (!open) return;
    try { if (!isAd()) sync(now()); beatTick(); } catch (e) { console.warn('[Волна]', e); }
    requestAnimationFrame(loop);
  }

  /* ================= КНОПКА В ПАНЕЛИ YOUTUBE MUSIC ================= */
  function placeBtn() {
    if (C.btn === false) { btn?.remove(); btn = null; return; }
    const slot = document.querySelector('.ytMusicMiniPlayerRightSection, ytmusic-player-bar .right-controls-buttons');
    if (btn && btn.isConnected && (slot ? slot.contains(btn) : btn.classList.contains('float'))) return;
    btn?.remove();
    btn = document.createElement('button');
    btn.className = 'volna-btn' + (open ? ' on' : '');
    btn.title = 'Караоке Волны (Alt+L)';
    setHTML(btn, MIC + '<span>Волна</span>');
    btn.onclick = (e) => { e.stopPropagation(); toggle(); };
    if (slot) slot.prepend(btn); else { btn.classList.add('float'); document.body.appendChild(btn); }
  }
  new MutationObserver(() => { if (!btn || !btn.isConnected) placeBtn(); }).observe(document.body, { childList: true, subtree: true });
  setInterval(placeBtn, 3000);

  /* ================= КЛАВИШИ ================= */
  document.addEventListener('keydown', (e) => {
    const tg = e.composedPath()[0];
    if (tg && tg.closest?.('input,textarea,[contenteditable="true"]')) return;
    if (e.altKey && e.code === 'KeyL') { e.preventDefault(); toggle(); return; }
    if (!open) return;
    if (e.code === 'Escape') { e.preventDefault(); toggle(false); }
    else if (e.code === 'ArrowRight' && e.shiftKey) { e.preventDefault(); clickCtl('Next'); }
    else if (e.code === 'ArrowLeft' && e.shiftKey) { e.preventDefault(); clickCtl('Previous'); }
  }, true);

  /* ================= СТИЛИ ОКНА ================= */
  const CSS = `
:host{all:initial}
*{box-sizing:border-box}
button{font:inherit;color:inherit;background:none;border:0;cursor:pointer}
.vl{--beat:0;--size:1;position:fixed;left:0;right:0;top:0;bottom:72px;display:flex;flex-direction:column;color:#fff;font-family:"YouTube Sans",Roboto,Manrope,system-ui,sans-serif;
 background:var(--lbg,#1b1426);opacity:0;transform:translateY(22px);pointer-events:none;transition:opacity .35s,transform .35s,background-color 1.2s;overflow:hidden}
.vl.open{opacity:1;transform:none;pointer-events:auto}
.bg{position:absolute;inset:-12%;background:center/cover no-repeat;filter:blur(60px) saturate(1.5);opacity:.55;transform:translateZ(0) scale(1.05);pointer-events:none}
.tint{position:absolute;inset:0;background:radial-gradient(120% 80% at 80% 0%,rgba(255,255,255,.1),transparent 60%),linear-gradient(180deg,rgba(0,0,0,.15),transparent 40%,rgba(0,0,0,.4));pointer-events:none}
header{position:relative;display:flex;align-items:center;gap:14px;padding:18px clamp(18px,4vw,56px)}
.th{width:52px;height:52px;border-radius:12px;background:#222 center/cover;flex:none;box-shadow:0 8px 24px rgba(0,0,0,.35)}
.tt{min-width:0}.tt b{display:block;font-size:17px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:40vw}.tt span{font-size:14px;opacity:.75}
.sp{flex:1}
.pill{height:36px;padding:0 16px;border-radius:999px;background:rgba(0,0,0,.25);border:1px solid rgba(255,255,255,.16);font-weight:700;font-size:13px}
.pill:hover{background:rgba(255,255,255,.14)}.pill.acc{background:#fff;color:#111;border:0}
.x{width:40px;height:40px;border-radius:50%;background:rgba(0,0,0,.25);font-size:24px;line-height:1}.x:hover{background:rgba(255,255,255,.18)}
.off{display:flex;align-items:center;border-radius:999px;background:rgba(0,0,0,.22);border:1px solid rgba(255,255,255,.14);padding:2px}
.off button{min-width:30px;height:32px;border-radius:999px;font-weight:800;font-size:13px;padding:0 8px;font-variant-numeric:tabular-nums}
.off button:hover{background:rgba(255,255,255,.12)}#ov{font-size:12px;opacity:.7;min-width:52px}.off.on #ov{opacity:1}
main{position:relative;flex:1;display:flex;min-height:0}
.stage{--ph:0;perspective:900px;flex:0 0 min(40%,560px);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px;padding:0 0 6vh clamp(18px,4vw,56px)}
.cov{position:relative;width:min(100%,50vh);aspect-ratio:1;border-radius:24px;background:#222 center/cover no-repeat;box-shadow:0 30px 80px rgba(0,0,0,.5);will-change:transform;
 transform:scale(calc(1 + var(--beat)*.06)) rotate(calc(var(--beat)*-.6deg))}
.cov::before{content:"";position:absolute;inset:-7%;border-radius:32px;background:var(--glow,var(--acc));filter:blur(46px);opacity:calc(.18 + var(--beat)*.6);z-index:-1;will-change:opacity}
.cov::after{content:"";position:absolute;inset:0;border-radius:inherit;border:2px solid rgba(255,255,255,.7);opacity:calc(var(--beat)*.7);transform:scale(calc(1 + (1 - var(--beat))*.12))}
.cov i{position:absolute;inset:0;border-radius:inherit;background:linear-gradient(135deg,rgba(255,255,255,.22),transparent 45%)}
.stage[data-fx=sway] .cov{transform-origin:50% 12%;transform:rotate(calc(var(--ph)*2.2deg))}
.stage[data-fx=tilt] .cov{transform:rotateY(calc(var(--ph)*7deg)) rotateX(calc(var(--beat)*2.5deg))}
.stage[data-fx=float] .cov{transform:translateY(calc(var(--ph)*6px)) rotate(calc(var(--ph)*.6deg))}
.stage[data-fx=off] .cov{transform:none}
.stage:not([data-fx=pulse]) .cov::after{display:none}
.stage[data-fx=float] .cov::before,.stage[data-fx=off] .cov::before{opacity:.25}
.eq{display:flex;gap:5px;align-items:flex-end;height:34px}
.eq b{width:6px;border-radius:3px;background:rgba(255,255,255,.85);height:calc(6px + var(--beat)*var(--h,20px));transition:height .08s}
.stage[data-fx=off] .eq b{height:6px}
.fx{display:flex;gap:4px;flex-wrap:wrap;justify-content:center;opacity:.55;transition:opacity .2s}
.stage:hover .fx{opacity:1}
.fx button{font-weight:700;font-size:12px;padding:6px 11px;border-radius:999px;color:rgba(255,255,255,.85);background:rgba(0,0,0,.22);border:1px solid rgba(255,255,255,.12)}
.fx button.on{background:#fff;color:#111}
.body{position:relative;flex:1;overflow-y:auto;padding:26vh clamp(18px,4vw,56px) 40vh;scrollbar-width:none;
 -webkit-mask-image:linear-gradient(180deg,transparent,#000 14%,#000 80%,transparent);mask-image:linear-gradient(180deg,transparent,#000 14%,#000 80%,transparent)}
.body::-webkit-scrollbar{display:none}
.ly{font-weight:800;font-size:calc(clamp(26px,3.4vw,44px)*var(--size));line-height:1.25;letter-spacing:-.015em;margin:0 0 22px;max-width:980px;cursor:pointer;transition:opacity .45s;opacity:.55;text-wrap:balance}
.ly:hover{opacity:.9}.ly.on{opacity:1;transform:scale(calc(1 + var(--beat)*.018));transform-origin:0 50%}.ly.past{opacity:.75}.ly.far{opacity:.4}
.w{--f:0%;color:transparent;-webkit-background-clip:text;background-clip:text;background-image:linear-gradient(90deg,#fff var(--f),rgba(255,255,255,.38) var(--f))}
.ly.past .w{--f:100%}
.dots{display:flex;gap:10px;height:40px;align-items:center}
.dots i{width:12px;height:12px;border-radius:50%;background:rgba(255,255,255,.45);animation:dot 1.2s ease-in-out infinite}
.dots i:nth-child(2){animation-delay:.2s}.dots i:nth-child(3){animation-delay:.4s}
@keyframes dot{50%{transform:scale(1.5);background:#fff}}
.msg{font-size:22px;font-weight:700;opacity:.8;max-width:620px}.msg.small{font-size:15px;margin-top:30px}
.warn{font-size:14px;line-height:1.5;opacity:.85;background:rgba(0,0,0,.25);border-radius:14px;padding:10px 14px;margin:0 0 28px;max-width:560px}
.plain{white-space:pre-wrap;font-size:calc(22px*var(--size));line-height:1.6;font-weight:600;max-width:760px}
.mf{display:grid;gap:12px;max-width:460px}.mf b{font-size:20px}
.mf input{height:44px;border-radius:12px;border:1px solid rgba(255,255,255,.2);background:rgba(0,0,0,.3);color:#fff;padding:0 14px;font:inherit;font-size:15px;outline:none}
.mf input:focus{border-color:var(--acc)}
@media(max-width:900px){.stage{display:none}.th{width:44px;height:44px}}
@media(prefers-reduced-motion:reduce){.cov,.ly.on{transform:none!important}}
`;

  /* ================= ЗАПУСК ================= */
  chrome.storage.local.get(DEF, (v) => { C = { ...DEF, ...v }; applyTheme(); });
  chrome.storage.onChanged.addListener((ch) => { for (const k in ch) C[k] = ch[k].newValue; applyTheme(); });
  ext.onMessage.addListener((m) => { if (m?.type === 'toggle') toggle(); if (m?.type === 'open') toggle(true); });
})();

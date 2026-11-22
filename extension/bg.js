// Волна — фоновая часть: запросы к сервисам текстов/темпа и обложкам (без ограничений CORS страницы)
const J = (u) => fetch(u).then((r) => (r.ok ? r.json() : null)).catch(() => null);

async function lyrics({ artist, title }) {
  const a = encodeURIComponent(artist || ''), t = encodeURIComponent(title || '');
  const [get, s1, s2] = await Promise.all([
    artist ? J(`https://lrclib.net/api/get?artist_name=${a}&track_name=${t}`) : null,
    artist ? J(`https://lrclib.net/api/search?artist_name=${a}&track_name=${t}`) : null,
    J(`https://lrclib.net/api/search?q=${encodeURIComponent(((artist || '') + ' ' + (title || '')).trim())}`)
  ]);
  return [get, ...(s1 || []), ...(s2 || [])].filter((x) => x && (x.syncedLyrics || x.plainLyrics || x.instrumental))
    .map((x) => ({ id: x.id, duration: x.duration || 0, synced: x.syncedLyrics || null, plain: x.plainLyrics || null, instrumental: !!x.instrumental, artist: x.artistName, title: x.trackName }));
}

async function bpm({ q }) {
  const r = await J('https://api.deezer.com/search?limit=5&q=' + encodeURIComponent(q));
  const hit = r && r.data && r.data[0];
  if (!hit) return 0;
  const tr = await J('https://api.deezer.com/track/' + hit.id);
  let b = (tr && +tr.bpm) || 0;
  if (b > 0) { while (b < 70) b *= 2; while (b > 180) b /= 2; }
  return b;
}

async function image({ url }) {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const buf = new Uint8Array(await r.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return 'data:' + (r.headers.get('content-type') || 'image/jpeg') + ';base64,' + btoa(s);
  } catch { return null; }
}

chrome.runtime.onMessage.addListener((m, _s, reply) => {
  const f = { lyrics, bpm, image }[m && m.type];
  if (!f) return false;
  f(m).then(reply, () => reply(null));
  return true;
});

chrome.commands?.onCommand.addListener(async (cmd) => {
  if (cmd !== 'toggle-karaoke') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && /music\.youtube\.com/.test(tab.url || '')) chrome.tabs.sendMessage(tab.id, { type: 'toggle' }).catch(() => {});
});

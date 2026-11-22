const DEF = { theme: 'moon', acc: '', blur: 0, dim: 45, panel: 55, fx: 'sway', size: 100, customBg: '', autoOpen: false, btn: true };
const THEMES = [
  ['none', 'Как было', '', '#ff4e45'], ['moon', 'Луна', 'bg/moon-s.jpg', '#7aa7ff'], ['sakura', 'Сакура', 'bg/sakura-s.jpg', '#ff7eb6'],
  ['neon', 'Неон', 'bg/neon-s.jpg', '#b67cff'], ['forest', 'Лес', 'bg/forest-s.jpg', '#5fd39a'], ['custom', 'Свой фон', '', '#ffd166']
];
const ACC = ['', '#ff7eb6', '#ff4e45', '#ffb84d', '#ffd166', '#5fd39a', '#4dd4e6', '#7aa7ff', '#b67cff'];
const FX = [['pulse', 'Пульс'], ['sway', 'Качание'], ['tilt', '3D'], ['float', 'Плавно'], ['off', 'Без']];
const $ = (id) => document.getElementById(id);
let C = { ...DEF };
const accOf = () => C.acc || THEMES.find((t) => t[0] === C.theme)?.[3] || '#7aa7ff';
const save = (o) => { Object.assign(C, o); chrome.storage.local.set(o); draw(); };

function draw() {
  document.body.style.setProperty('--acc', accOf());
  $('themes').innerHTML = THEMES.map(([id, n, img]) => {
    const bg = id === 'custom' && C.customBg ? `background-image:url("${C.customBg}")` : img ? `background-image:url("${img}")` : '';
    return `<button class="th ${id}${C.theme === id ? ' on' : ''}" data-th="${id}" style='${bg}'>${id === 'custom' && !C.customBg ? '＋<br>Свой фон' : n}</button>`;
  }).join('');
  $('sw').innerHTML = ACC.map((c) => `<button data-acc="${c}" class="${C.acc === c ? 'on' : ''}" title="${c ? c : 'Цвет темы'}" style="background:${c || `conic-gradient(${THEMES.find((t) => t[0] === C.theme)?.[3] || '#7aa7ff'} 0 50%, #fff 0)`}"></button>`).join('') +
    `<input type="color" id="pick" title="Свой цвет" value="${accOf()}">`;
  $('fx').innerHTML = FX.map(([k, n]) => `<button class="chip${C.fx === k ? ' on' : ''}" data-fx="${k}">${n}</button>`).join('');
  for (const k of ['dim', 'blur', 'panel', 'size']) { $(k).value = C[k]; $(k + 'O').textContent = C[k] + (k === 'blur' ? 'px' : '%'); }
  $('autoOpen').checked = !!C.autoOpen; $('btn').checked = C.btn !== false;
  $('pick').oninput = (e) => save({ acc: e.target.value });
}

$('themes').onclick = (e) => {
  const b = e.target.closest('[data-th]'); if (!b) return;
  if (b.dataset.th === 'custom' && (!C.customBg || C.theme === 'custom')) { $('file').click(); return; }
  save({ theme: b.dataset.th });
};
$('file').onchange = (e) => {
  const f = e.target.files[0]; if (!f) return;
  const img = new Image();
  img.onload = () => {
    const k = Math.min(1, 1920 / Math.max(img.width, img.height)), c = document.createElement('canvas');
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    save({ customBg: c.toDataURL('image/jpeg', 0.85), theme: 'custom' });
    URL.revokeObjectURL(img.src);
  };
  img.src = URL.createObjectURL(f);
};
$('sw').onclick = (e) => { const b = e.target.closest('[data-acc]'); if (b) save({ acc: b.dataset.acc }); };
$('fx').onclick = (e) => { const b = e.target.closest('[data-fx]'); if (b) save({ fx: b.dataset.fx }); };
for (const k of ['dim', 'blur', 'panel', 'size']) $(k).oninput = (e) => save({ [k]: +e.target.value });
$('autoOpen').onchange = (e) => save({ autoOpen: e.target.checked });
$('btn').onchange = (e) => save({ btn: e.target.checked });
$('open').onclick = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && /music\.youtube\.com/.test(tab.url || '')) { chrome.tabs.sendMessage(tab.id, { type: 'open' }).catch(() => {}); window.close(); }
  else chrome.tabs.create({ url: 'https://music.youtube.com/' });
};
chrome.storage.local.get(DEF, (v) => { C = { ...DEF, ...v }; draw(); });

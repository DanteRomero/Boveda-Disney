/* Bóveda Disney — PWA conectada a la API de TMDB (themoviedb.org) */
'use strict';

const API = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p/';
const LANG = 'es-MX';              // títulos y sinopsis en español latino
const CACHE_DAYS = 7;              // cada cuánto se vuelve a descargar el catálogo
const MIN_VOTES = 15;              // umbral para esconder cortos y rarezas

// Estudios que forman el catálogo. Los IDs se buscan en TMDB por nombre exacto.
const STUDIOS = [
  'Walt Disney Productions',        // clásicos hasta los 80
  'Walt Disney Pictures',
  'Walt Disney Animation Studios',
  'Walt Disney Feature Animation',
  'Pixar',
  'DisneyToon Studios',
  'Disneynature'
];
// Estudios de los que solo se toman las películas animadas (sus películas de acción real no son "de Disney").
// Así entran El extraño mundo de Jack, ¿Quién engañó a Roger Rabbit?, Goofy: la película, etc.
const STUDIOS_ANIM = [
  'Touchstone Pictures',
  'Skellington Productions',
  'Walt Disney Television Animation',
  'Disney Television Animation',
  'Disney MovieToons'
];
// Películas sueltas que no salen por estudio. El número es el de la dirección en themoviedb.org/movie/NÚMERO.
const EXTRA_IDS = [
  9479   // El extraño mundo de Jack (The Nightmare Before Christmas)
];
const CAT_VERSION = 2;             // subirlo cuando cambian las listas de arriba: fuerza a bajar el catálogo de nuevo

const K = { key:'boveda.tmdbKey', cat:'boveda.catalogo', seen:'boveda.vistas', theme:'boveda.tema', skin:'boveda.estilo', minor:'boveda.ocultarMenores' };
const store = {
  get(k, d){ try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch(e){ return d; } },
  set(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch(e){ return false; } },
  del(k){ try { localStorage.removeItem(k); } catch(e){} }
};

const $ = id => document.getElementById(id);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const norm = s => (s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const hue = s => { let h = 7; for (const c of String(s)) h = (h*31 + c.charCodeAt(0)) % 3600; return Math.round(h/10); };

/* ================= API ================= */
class ApiError extends Error { constructor(kind, status){ super(kind); this.kind = kind; this.status = status; } }

function authParts(){
  const key = (store.get(K.key, '') || '').trim();
  return { key, bearer: key.length > 40 };   // token v4 (largo) o clave v3 (32 caracteres)
}

async function tmdb(path, params = {}, tries = 3){
  const { key, bearer } = authParts();
  const url = new URL(API + path);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const headers = { accept: 'application/json' };
  if (bearer) headers.Authorization = 'Bearer ' + key; else url.searchParams.set('api_key', key);
  let res;
  try { res = await fetch(url, { headers }); }
  catch(e){ if (tries > 1) { await sleep(800); return tmdb(path, params, tries - 1); } throw new ApiError('network'); }
  if (res.status === 401) throw new ApiError('auth', 401);
  if (res.status === 429 && tries > 1) { await sleep(1500); return tmdb(path, params, tries - 1); }
  if (!res.ok) throw new ApiError('http', res.status);
  return res.json();
}

function errorText(e){
  if (e && e.kind === 'auth') return 'TMDB rechazó la clave. Revisá que hayas copiado el API Read Access Token completo.';
  if (e && e.kind === 'network') return 'No hay conexión con TMDB. Revisá internet y probá de nuevo.';
  if (e && e.kind === 'http') return `TMDB respondió con un error (${e.status}). Probá de nuevo en unos minutos.`;
  return 'Algo salió mal al hablar con TMDB. Probá de nuevo.';
}

async function findStudioIds(names){
  const ids = new Set();
  for (const name of names) {
    const r = await tmdb('/search/company', { query: name });
    (r.results || []).filter(c => norm(c.name) === norm(name)).forEach(c => ids.add(c.id));
  }
  return [...ids];
}

// Todas las páginas de una búsqueda de /discover/movie, de a 6 pedidos en paralelo
async function discoverAll(params, onPage){
  const first = await tmdb('/discover/movie', { ...params, page: 1 });
  const totalPages = Math.min(first.total_pages || 1, 500);
  const all = [...(first.results || [])];
  onPage(all.length, first.total_results || all.length);
  const pages = []; for (let p = 2; p <= totalPages; p++) pages.push(p);
  for (let i = 0; i < pages.length; i += 6) {
    const res = await Promise.all(pages.slice(i, i + 6).map(p => tmdb('/discover/movie', { ...params, page: p })));
    res.forEach(r => all.push(...(r.results || [])));
    onPage(all.length, first.total_results || all.length);
  }
  return all;
}

async function downloadCatalog(onProgress){
  onProgress(0.03, 'Buscando los estudios de Disney.');
  const studios = await findStudioIds(STUDIOS);
  if (!studios.length) throw new ApiError('http', 'sin estudios');
  const animStudios = await findStudioIds(STUDIOS_ANIM);

  onProgress(0.08, 'Leyendo los géneros.');
  const g = await tmdb('/genre/movie/list', { language: LANG });
  const genres = Object.fromEntries((g.genres || []).map(x => [x.id, x.name]));

  const base = { language: LANG, sort_by: 'primary_release_date.asc', include_adult: 'false', include_video: 'false' };
  const all = await discoverAll({ ...base, with_companies: studios.join('|') }, (n, total) =>
    onProgress(0.1 + 0.8 * Math.min(1, n / total), `Descargando ${Math.min(n, total)} de ${total} películas…`));

  onProgress(0.92, 'Sumando las animadas de otros estudios.');
  if (animStudios.length) all.push(...await discoverAll({ ...base, with_companies: animStudios.join('|'), with_genres: ANIM }, () => {}));
  const extras = await Promise.all(EXTRA_IDS.map(id => tmdb('/movie/' + id, { language: LANG }).catch(() => null)));
  extras.forEach(m => { if (m) all.push({ ...m, genre_ids: (m.genres || []).map(x => x.id) }); });

  const seenIds = new Set();
  const films = [];
  for (const m of all) {
    if (seenIds.has(m.id) || !m.release_date) continue;
    seenIds.add(m.id);
    films.push({
      id: m.id, t: m.title, o: m.original_title !== m.title ? m.original_title : '',
      y: +m.release_date.slice(0, 4), d: m.release_date, p: m.poster_path || '',
      g: m.genre_ids || [], v: Math.round((m.vote_average || 0) * 10) / 10, n: m.vote_count || 0,
      s: (m.overview || '').slice(0, 600)
    });
  }
  return { at: Date.now(), v: CAT_VERSION, genres, films };
}

/* ================= Estado ================= */
let CAT = null;          // { at, genres, films }
let FILMS = [];
let BY_ID = {};
let seen = new Set(store.get(K.seen, []));
let hideMinor = store.get(K.minor, true);
const ANIM = 16, DOC = 99;  // IDs de género de TMDB: Animación y Documental

const state = { gen: 'all', q: '', dec: 'all', ord: 'asc', hide: false, rnd: String(ANIM), from: 'all', to: 'all' };

function setCatalog(cat){
  CAT = cat;
  FILMS = cat.films.map(f => ({ ...f, h: hue(f.id), q: norm(f.t + ' ' + f.o) }));
  BY_ID = Object.fromEntries(FILMS.map(f => [f.id, f]));
}
const visible = () => hideMinor ? FILMS.filter(f => f.n >= MIN_VOTES || seen.has(f.id)) : FILMS;
const genreName = id => +id === ANIM ? 'Caricaturas' : (CAT.genres[id] || 'Otro');
const saveSeen = () => store.set(K.seen, [...seen]);

/* ================= Tema ================= */
const root = document.documentElement;
function applyTheme(m){
  if (m === 'light' || m === 'dark') root.setAttribute('data-theme', m); else root.removeAttribute('data-theme');
  ['light','dark','auto'].forEach(k => $('th-' + k).setAttribute('aria-pressed', String(k === m)));
  store.set(K.theme, m);
  syncThemeColor();
}
// La barra del sistema toma el fondo del tema y estilo activos.
function syncThemeColor(){
  const bg = getComputedStyle(root).getPropertyValue('--bg').trim();
  document.querySelectorAll('meta[name="theme-color"]').forEach(el => el.setAttribute('content', bg));
}

// Íconos de "Al azar" según el estilo: el tótem de oso de Kenai y el logo de Monsters Inc.
// El logo usa una máscara, así que cada copia necesita su propio id.
const ICON_TOTEM = () => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M8.6 4.4a1.6 1.6 0 1 1 2.3-1.1M15.4 4.4a1.6 1.6 0 1 0-2.3-1.1"/><path d="M7.6 10V5.4c0-1.3.9-2.1 2.2-2.1h4.4c1.3 0 2.2.8 2.2 2.1V10"/><rect x="10.1" y="6.6" width="3.8" height="4" rx=".6"/><path d="M11 8.9h2"/><path d="M7.6 10l-.5 8.3c0 1.8 2 2.7 4.9 2.7s4.9-.9 4.9-2.7l-.5-8.3"/><path d="M9.2 11.8l1.4 4.2M14.8 11.8l-1.4 4.2"/><path d="M9.5 21q0-2.6 2.5-2.6t2.5 2.6"/><path d="M7.6 6.8C4.6 7.2 3.8 10 5.3 12.4M16.6 18.6c2 .4 2.5 2.1 1.9 3.6"/><circle cx="9.1" cy="5.6" r=".6" fill="currentColor" stroke="none"/><circle cx="14.9" cy="5.6" r=".6" fill="currentColor" stroke="none"/></svg>';
const ICON_MONSTERS = id => `<svg viewBox="0 0 24 24"><defs><mask id="${id}"><rect width="24" height="24" fill="#fff"/><path d="M4.6 12Q12 6.6 19.4 12Q12 17.4 4.6 12Z" fill="#000"/></mask></defs><path mask="url(#${id})" fill="currentColor" d="M1.5 3.5h7l3.5 4.8 3.5-4.8h7v3h-1.2v11h1.2v3h-7v-3h1.1v-4.6L12 17.5l-4.6-4.6v4.6h1.1v3h-7v-3h1.2v-11H1.5z"/><path d="M4.6 12Q12 6.6 19.4 12Q12 17.4 4.6 12Z" fill="none" stroke="currentColor"/><circle cx="12" cy="12" r="2.3" fill="currentColor"/></svg>`;
const ICO_DEFAULT = { tab: $('ico-tab').innerHTML, btn: $('ico-btn').innerHTML };

// Estilos temáticos: cambian colores, tipografía, fondo y el ícono de "Al azar"; se combinan con claro/oscuro.
const SKINS = [
  { id: 'clasico',  name: 'Clásico',        sw: ['#2D47C9', '#A87708', '#93A6FF'] },
  { id: 'osos',     name: 'Tierra de osos', sw: ['#2E6A55', '#B4561F', '#7FE0B8'], ico: ICON_TOTEM },
  { id: 'monsters', name: 'Monsters Inc.',  sw: ['#6B3FA0', '#5ED3DE', '#A8E05F'], ico: ICON_MONSTERS }
];
function applySkin(s){
  const skin = SKINS.find(k => k.id === s) || SKINS[0]; s = skin.id;
  if (s === 'clasico') root.removeAttribute('data-skin'); else root.setAttribute('data-skin', s);
  ['tab', 'btn'].forEach(k => $('ico-' + k).innerHTML = skin.ico ? skin.ico('ico-mask-' + k) : ICO_DEFAULT[k]);
  store.set(K.skin, s);
  syncThemeColor();
}
applySkin(store.get(K.skin, 'clasico'));
applyTheme(store.get(K.theme, 'auto'));
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncThemeColor);
['light','dark','auto'].forEach(k => $('th-' + k).addEventListener('click', () => applyTheme(k)));

/* ================= Piezas de UI ================= */
const ICON_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const ICON_PLUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 6v12M6 12h12"/></svg>';
const ICON_CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>';

function coverHTML(f, size = 'w342'){
  return `<div class="cover" style="--h:${f.h}">${f.p
    ? `<img src="${IMG}${size}${f.p}" alt="" loading="lazy" decoding="async">`
    : `<span class="fallback">${esc(f.t)}</span>`}</div>`;
}
function cardHTML(f){
  const s = seen.has(f.id);
  return `<article class="card${s ? ' is-seen' : ''}" data-id="${f.id}">
    <button class="hit" data-act="open" aria-label="Ver ficha de ${esc(f.t)}"></button>
    ${coverHTML(f)}
    <button class="seen-btn" data-act="seen" aria-pressed="${s}" aria-label="${s ? 'Quitar de vistas' : 'Marcar como vista'}: ${esc(f.t)}">${s ? ICON_CHECK : ICON_PLUS}</button>
    <div class="card-t">${esc(f.t)}</div><div class="card-m">${f.y}${f.v ? ' · ★ ' + f.v.toFixed(1) : ''}</div>
  </article>`;
}
let toastT;
function toast(msg){ const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 1700); }

function genreCounts(){
  const c = {}; visible().forEach(f => f.g.forEach(g => c[g] = (c[g] || 0) + 1));
  return Object.entries(c).sort((a, b) => (+b[0] === ANIM) - (+a[0] === ANIM) || b[1] - a[1]);
}
function chipsHTML(sel){
  return `<button class="chip" data-g="all" aria-pressed="${sel === 'all'}">Todas</button>` +
    genreCounts().map(([id]) => `<button class="chip" data-g="${id}" aria-pressed="${sel === id}">${esc(genreName(id))}</button>`).join('');
}
function sortFilms(arr, ord){
  const a = arr.slice(), byT = (x, y) => x.t.localeCompare(y.t, 'es');
  if (ord === 'az') a.sort(byT);
  else if (ord === 'rate') a.sort((x, y) => y.v - x.v || y.n - x.n);
  else if (ord === 'desc') a.sort((x, y) => y.d.localeCompare(x.d) || byT(x, y));
  else a.sort((x, y) => x.d.localeCompare(y.d) || byT(x, y));
  return a;
}

/* ================= Catálogo ================= */
const PAGE = 60;
let current = [], shown = 0;

function renderDecades(){
  const decs = [...new Set(FILMS.map(f => Math.floor(f.y / 10) * 10))].sort();
  $('sel-dec').innerHTML = '<option value="all">Todas</option>' + decs.map(d => `<option value="${d}"${String(d) === state.dec ? ' selected' : ''}>${d}s</option>`).join('');
}
function renderCatalog(keepScroll){
  $('chips-cat').innerHTML = chipsHTML(state.gen);
  const q = norm(state.q.trim());
  current = sortFilms(visible().filter(f =>
    (state.gen === 'all' || f.g.includes(+state.gen)) &&
    (state.dec === 'all' || Math.floor(f.y / 10) * 10 === +state.dec) &&
    (!state.hide || !seen.has(f.id)) &&
    (!q || f.q.includes(q))
  ), state.ord);
  $('count').textContent = current.length === 1 ? '1 película' : `${current.length} películas`;
  const keep = keepScroll ? Math.max(shown, PAGE) : PAGE;
  shown = 0; $('grid').innerHTML = '';
  if (!current.length) { $('grid').innerHTML = `<div class="empty" style="grid-column:1/-1"><strong>No hay películas con esos filtros</strong>Probá con otra década, otro género o borrá la búsqueda.</div>`; return; }
  appendMore(keep);
}
function appendMore(n = PAGE){
  if (shown >= current.length) return;
  $('grid').insertAdjacentHTML('beforeend', current.slice(shown, shown + n).map(cardHTML).join(''));
  shown = Math.min(current.length, shown + n);
}
new IntersectionObserver(es => { if (es[0].isIntersecting && !$('p-catalogo').hidden) appendMore(); }, { rootMargin: '800px' }).observe($('sentinel'));

$('chips-cat').addEventListener('click', e => { const b = e.target.closest('.chip'); if (!b) return; state.gen = b.dataset.g; renderCatalog(); });
let qT; $('q').addEventListener('input', e => { clearTimeout(qT); qT = setTimeout(() => { state.q = e.target.value; renderCatalog(); }, 150); });
$('sel-dec').addEventListener('change', e => { state.dec = e.target.value; renderCatalog(); });
$('sel-ord').addEventListener('change', e => { state.ord = e.target.value; renderCatalog(); });
$('hide-seen').addEventListener('change', e => { state.hide = e.target.checked; renderCatalog(); });

// Actualiza una sola tarjeta sin redibujar la grilla
function patchCard(id){
  document.querySelectorAll(`.card[data-id="${id}"]`).forEach(el => {
    const f = BY_ID[id]; if (!f) return;
    if (state.hide && seen.has(id) && el.closest('#grid')) { el.remove(); return; }
    el.outerHTML = cardHTML(f);
  });
}

/* ================= Al azar ================= */
let lastPick = null, rolling = false;
function yearRange(){
  const a = state.from === 'all' ? -Infinity : +state.from, b = state.to === 'all' ? Infinity : +state.to;
  return a <= b ? [a, b] : [b, a];   // si quedan invertidos, se toma el rango igual
}
const pool = () => { const [a, b] = yearRange();
  return visible().filter(f => (state.rnd === 'all' || f.g.includes(+state.rnd)) && f.y >= a && f.y <= b && (!$('rnd-unseen').checked || !seen.has(f.id))); };
function renderYears(){
  const ys = [...new Set(FILMS.map(f => f.y).filter(Boolean))].sort((a, b) => a - b);
  const opts = sel => ys.map(y => `<option value="${y}"${String(y) === sel ? ' selected' : ''}>${y}</option>`).join('');
  $('rnd-from').innerHTML = '<option value="all">Cualquiera</option>' + opts(state.from);
  $('rnd-to').innerHTML = '<option value="all">Cualquiera</option>' + opts(state.to);
}
function renderRandomControls(){
  $('chips-rnd').innerHTML = chipsHTML(state.rnd);
  const n = pool().length;
  $('rnd-pool').textContent = n === 1 ? '1 opción' : `${n} opciones`;
  $('rnd-go').disabled = n === 0 || rolling;
}
function pickHTML(f){
  const s = seen.has(f.id);
  return `<div class="panel"><div class="stage">${coverHTML(f, 'w500')}
    <div class="pick-info"><span class="panel-label">Te tocó</span>
      <h3>${esc(f.t)}</h3>${f.o ? `<p class="orig">${esc(f.o)}</p>` : ''}
      <p class="meta">${f.y}${f.v ? ' · ★ ' + f.v.toFixed(1) : ''}</p>
      <div class="tags">${f.g.map(g => `<span class="tag">${esc(genreName(g))}</span>`).join('')}</div>
      ${f.s ? `<p class="overview">${esc(f.s)}</p>` : ''}
      <div class="actions">
        <button class="btn ${s ? 'btn-ghost' : 'btn-primary'}" data-act="seen" data-id="${f.id}">${s ? ICON_CHECK + 'Vista' : 'Marcar como vista'}</button>
        <button class="btn btn-ghost" data-act="again">Otra</button>
      </div></div></div></div>`;
}
function roll(){
  const p = pool(); if (!p.length || rolling) return;
  const cands = p.length > 1 && lastPick ? p.filter(f => f.id !== lastPick) : p;
  const final = cands[Math.floor(Math.random() * cands.length)];
  if (final.p) { const im = new Image(); im.src = IMG + 'w500' + final.p; }   // precarga el póster ganador
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || p.length < 3) { lastPick = final.id; $('rnd-out').innerHTML = pickHTML(final); return; }
  rolling = true; renderRandomControls();
  let i = 0; const steps = 14;
  const tick = () => {
    if (i < steps) {
      const f = p[Math.floor(Math.random() * p.length)];
      $('rnd-out').innerHTML = `<div class="panel"><div class="stage rolling"><div class="cover" style="--h:${f.h}"><span class="fallback">${esc(f.t)}</span></div><div class="pick-info"><span class="panel-label">Sorteando…</span></div></div></div>`;
      i++; setTimeout(tick, 50 + i * i * 1.4);
    } else { rolling = false; lastPick = final.id; $('rnd-out').innerHTML = pickHTML(final); renderRandomControls(); }
  };
  tick();
}
$('chips-rnd').addEventListener('click', e => { const b = e.target.closest('.chip'); if (!b) return; state.rnd = b.dataset.g; renderRandomControls(); });
$('rnd-unseen').addEventListener('change', renderRandomControls);
$('rnd-from').addEventListener('change', e => { state.from = e.target.value; renderRandomControls(); });
$('rnd-to').addEventListener('change', e => { state.to = e.target.value; renderRandomControls(); });
$('rnd-go').addEventListener('click', roll);

/* ================= Vistas ================= */
function renderSeen(){
  const vis = visible(), n = [...seen].filter(id => BY_ID[id]).length, tot = vis.length;
  $('v-n').textContent = n; $('v-of').textContent = `de ${tot} películas vistas`;
  $('v-bar').style.width = (tot ? n / tot * 100 : 0).toFixed(1) + '%';
  const groups = [
    ['Caricaturas', f => f.g.includes(ANIM)],
    ['Acción real', f => !f.g.includes(ANIM) && !f.g.includes(DOC)],
    ['Antes de 1990', f => f.y < 1990],
    ['Desde 1990', f => f.y >= 1990]
  ];
  $('v-groups').innerHTML = groups.map(([name, fn]) => {
    const all = vis.filter(fn), v = all.filter(f => seen.has(f.id)).length;
    return `<div class="grp"><div class="grp-h"><span>${name}</span><span>${v}/${all.length}</span></div><div class="bar"><i style="width:${all.length ? (v / all.length * 100).toFixed(1) : 0}%"></i></div></div>`;
  }).join('');
  const list = sortFilms(FILMS.filter(f => seen.has(f.id)), $('v-ord').value);
  $('v-list').innerHTML = list.length
    ? `<div class="list">${list.map(f => `<div class="li">${f.p ? `<img class="thumb" src="${IMG}w92${f.p}" alt="" loading="lazy" style="--h:${f.h}">` : `<span class="thumb" style="--h:${f.h}"></span>`}
        <button class="li-txt" data-act="open" data-id="${f.id}"><b>${esc(f.t)}</b><span>${f.y}</span></button>
        <button class="quit" data-act="seen" data-id="${f.id}" aria-label="Quitar ${esc(f.t)} de vistas">Quitar</button></div>`).join('')}</div>`
    : `<div class="empty"><strong>Todavía no marcaste ninguna</strong>Tocá el + de cualquier póster del catálogo, o sorteá una en “Al azar”.</div>`;
  const b = $('badge'); b.hidden = n === 0; b.textContent = n;
}
$('v-ord').addEventListener('change', renderSeen);

function toggleSeen(id){
  id = +id; if (!BY_ID[id]) return;
  if (seen.has(id)) { seen.delete(id); toast('Quitada de vistas'); } else { seen.add(id); toast('Marcada como vista'); }
  saveSeen();
  patchCard(id);
  if (state.hide) $('count').textContent = `${current.filter(f => !seen.has(f.id)).length} películas`;
  renderSeen(); renderRandomControls();
  if (lastPick === id && !rolling) $('rnd-out').innerHTML = pickHTML(BY_ID[id]);
  if ($('sheet').open && sheetMode === 'film' && sheetId === id) openFilm(id);
}

/* ================= Hoja: ficha y ajustes ================= */
let sheetMode = null, sheetId = null;
function showSheet(){ if (!$('sheet').open) $('sheet').showModal(); }
function openFilm(id){
  const f = BY_ID[+id]; if (!f) return;
  sheetMode = 'film'; sheetId = f.id;
  const s = seen.has(f.id);
  $('sheet-body').innerHTML = `<div class="sheet-top">${f.p ? `<img class="thumb" src="${IMG}w185${f.p}" alt="" style="--h:${f.h}">` : `<span class="thumb" style="--h:${f.h}"></span>`}
      <div style="min-width:0"><h2 id="sh-title">${esc(f.t)}</h2>${f.o ? `<p class="orig">${esc(f.o)}</p>` : ''}
      <p class="meta" style="margin-top:4px">${f.d.split('-').reverse().join('/')}${f.v ? ' · ★ ' + f.v.toFixed(1) + ` (${f.n} votos)` : ''}</p></div>
      <button class="sheet-close" data-act="close" aria-label="Cerrar">${ICON_CLOSE}</button></div>
    <div class="tags">${f.g.map(g => `<span class="tag">${esc(genreName(g))}</span>`).join('')}</div>
    ${f.s ? `<p class="overview">${esc(f.s)}</p>` : '<p class="meta">TMDB no tiene sinopsis en español para esta película.</p>'}
    <div class="actions"><button class="btn ${s ? 'btn-ghost' : 'btn-primary'}" data-act="seen" data-id="${f.id}">${s ? ICON_CHECK + 'Vista · tocá para quitar' : 'Marcar como vista'}</button></div>
    <a class="link" href="https://www.themoviedb.org/movie/${f.id}?language=${LANG}" target="_blank" rel="noopener">Ver en TMDB ↗</a>`;
  showSheet();
}
function openSettings(){
  sheetMode = 'settings'; sheetId = null;
  const { key } = authParts();
  const when = CAT ? new Date(CAT.at).toLocaleDateString('es-AR', { day: 'numeric', month: 'long' }) : '—';
  $('sheet-body').innerHTML = `<div class="sheet-top"><h2 id="sh-title">Ajustes</h2><button class="sheet-close" data-act="close" aria-label="Cerrar">${ICON_CLOSE}</button></div>
    <div class="set-row"><h3>Estilo</h3><p>Cambia los colores y la letra de la app. Se combina con el modo claro u oscuro.</p>
      <div class="skins" role="group" aria-label="Estilo">${SKINS.map(k => `<button class="skin" data-skin="${k.id}" aria-pressed="${k.id === store.get(K.skin, 'clasico')}"><span class="swatch">${k.sw.map(c => `<i style="background:${c}"></i>`).join('')}</span>${esc(k.name)}</button>`).join('')}</div></div>
    <div class="set-row"><h3>Catálogo</h3><p>${FILMS.length} películas descargadas el ${when}. Se actualiza solo cada ${CACHE_DAYS} días.</p>
      <label class="toggle"><input type="checkbox" id="set-minor" ${hideMinor ? 'checked' : ''}> Ocultar cortos y títulos con pocos votos</label>
      <button class="btn btn-ghost" data-act="refresh">Actualizar ahora</button></div>
    <div class="set-row"><h3>Mis vistas</h3><p>Se guardan en este dispositivo. Hacé una copia para pasarlas a otro celular o no perderlas.</p>
      <div class="actions"><button class="btn btn-ghost" data-act="export">Guardar copia</button><button class="btn btn-ghost" data-act="import">Cargar copia</button></div></div>
    <div class="set-row"><h3>Clave de TMDB</h3><p>${key ? 'Conectada (…' + esc(key.slice(-6)) + ')' : 'Sin clave'}</p>
      <button class="btn btn-ghost" data-act="change-key">Cambiar clave</button></div>
    <p class="attrib">Este producto usa la API de TMDB pero no está avalado ni certificado por TMDB. Datos e imágenes: themoviedb.org.</p>`;
  $('set-minor').addEventListener('change', e => { hideMinor = e.target.checked; store.set(K.minor, hideMinor); renderAll(); });
  $('sheet-body').querySelectorAll('.skin').forEach(b => b.addEventListener('click', () => {
    applySkin(b.dataset.skin);
    $('sheet-body').querySelectorAll('.skin').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  }));
  showSheet();
}
$('open-settings').addEventListener('click', openSettings);
$('sheet').addEventListener('click', e => { if (e.target === $('sheet')) $('sheet').close(); });
$('sheet').addEventListener('close', () => { sheetMode = null; sheetId = null; });

function exportSeen(){
  const data = { app: 'boveda-disney', version: 1, fecha: new Date().toISOString(),
    vistas: [...seen].map(id => ({ id, titulo: BY_ID[id]?.t || '', anio: BY_ID[id]?.y || null })) };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `boveda-vistas-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast('Copia guardada en Descargas');
}
$('import-file').addEventListener('change', async e => {
  const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const ids = (data.vistas || []).map(v => +(v.id ?? v)).filter(Boolean);
    const before = seen.size; ids.forEach(id => seen.add(id)); saveSeen();
    renderAll(); toast(`Se agregaron ${seen.size - before} vistas`);
  } catch(err) { toast('Ese archivo no es una copia de Bóveda Disney'); }
});

/* ================= Clicks globales ================= */
document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const id = b.dataset.id || b.closest('[data-id]')?.dataset.id;
  switch (b.dataset.act) {
    case 'seen': e.stopPropagation(); toggleSeen(id); break;
    case 'open': openFilm(id); break;
    case 'again': roll(); break;
    case 'close': $('sheet').close(); break;
    case 'refresh': $('sheet').close(); loadCatalog(true); break;
    case 'export': exportSeen(); break;
    case 'import': $('import-file').click(); break;
    case 'change-key': $('sheet').close(); showSetup(); break;
  }
});

/* ================= Navegación ================= */
const TABS = ['catalogo', 'azar', 'vistas'];
const PANELS = ['setup', 'loading', ...TABS];
function showPanel(name){
  PANELS.forEach(k => $('p-' + k).hidden = k !== name);
  const inApp = TABS.includes(name);
  $('tabs').hidden = !inApp;
  TABS.forEach(k => $('t-' + k).setAttribute('aria-selected', String(k === name)));
  if (inApp) try { history.replaceState(null, '', '#' + name); } catch(e) {}
  window.scrollTo({ top: 0 });
}
$('tabs').addEventListener('click', e => { const b = e.target.closest('.tab'); if (b) showPanel(b.dataset.tab); });

function renderAll(){
  $('sub').textContent = `${visible().length} películas · ${Math.min(...FILMS.map(f => f.y))}–${Math.max(...FILMS.map(f => f.y))}`;
  renderDecades(); renderYears(); renderCatalog(); renderSeen(); renderRandomControls();
}

/* ================= Arranque ================= */
function showSetup(){
  $('key-in').value = ''; $('key-err').hidden = true;
  showPanel('setup');
}
$('key-save').addEventListener('click', async () => {
  const val = $('key-in').value.trim().replace(/^Bearer\s+/i, '');
  if (val.length < 30) { $('key-err').textContent = 'Eso no parece una clave de TMDB. Copiá el API Read Access Token completo.'; $('key-err').hidden = false; return; }
  const prev = store.get(K.key, '');
  store.set(K.key, val); $('key-save').disabled = true; $('key-save').textContent = 'Probando…';
  try { await tmdb('/authentication'); loadCatalog(true); }
  catch(e) { store.set(K.key, prev); $('key-err').textContent = errorText(e); $('key-err').hidden = false; }
  finally { $('key-save').disabled = false; $('key-save').textContent = 'Conectar'; }
});

let loading = false;
async function loadCatalog(force){
  if (loading) return;
  const cached = store.get(K.cat, null);
  const fresh = cached && cached.v === CAT_VERSION && (Date.now() - cached.at) < CACHE_DAYS * 864e5;
  if (cached && !force) {
    setCatalog(cached); renderAll();
    const t = (location.hash || '').slice(1); showPanel(TABS.includes(t) ? t : 'catalogo');
    if (!fresh) refreshInBackground();
    return;
  }
  loading = true;
  showPanel('loading'); $('load-err').hidden = true; $('load-retry').hidden = true;
  try {
    const cat = await downloadCatalog((p, msg) => { $('load-bar').style.width = (p * 100).toFixed(0) + '%'; $('load-msg').textContent = msg; });
    if (!store.set(K.cat, cat)) console.warn('No se pudo guardar el catálogo en el dispositivo');
    setCatalog(cat); renderAll(); showPanel('catalogo');
    toast(`${FILMS.length} películas cargadas`);
  } catch(e) {
    if (e.kind === 'auth') { showSetup(); $('key-err').textContent = errorText(e); $('key-err').hidden = false; }
    else if (cached) { setCatalog(cached); renderAll(); showPanel('catalogo'); toast('No se pudo actualizar. Sigo con el catálogo guardado.'); }
    else { $('load-err').textContent = errorText(e); $('load-err').hidden = false; $('load-retry').hidden = false; }
  } finally { loading = false; }
}
async function refreshInBackground(){
  try { const cat = await downloadCatalog(() => {}); store.set(K.cat, cat); setCatalog(cat); renderAll(); } catch(e) {}
}
$('load-retry').addEventListener('click', () => loadCatalog(true));

/* ================= Instalación (PWA) ================= */
let installEvt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; $('install').hidden = false; });
$('install').addEventListener('click', async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice; installEvt = null; $('install').hidden = true; });
window.addEventListener('appinstalled', () => { $('install').hidden = true; toast('App instalada'); });
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));

if (authParts().key) loadCatalog(false); else showSetup();

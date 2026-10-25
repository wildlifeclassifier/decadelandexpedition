/* ============================================================================
   TDE 2.0 — Survey coverage dashboard, static build.
   A direct port of the Shiny app (app/global.R, ui.R, server.R). Section names
   below follow the R files so the two can be read side by side.
   Data: compact JSON / GeoJSON written by export_web.R into data/.
   ============================================================================ */
(() => {
'use strict';

// ---- Constants (global.R) ----------------------------------------------------
const SOURCES = [                                   // order = observations.json "sources"
  { k: 'birds',    label: 'Bird survey programme',     col: '#B54A6B' },
  { k: 'wetlands', label: 'Wetland rapid assessments', col: '#2F6DB3' },
  { k: 'partner',  label: 'Partner (RSG / BIOPOLIS)',  col: '#C98A1B' },
  { k: 'ranger',   label: 'Ranger sightings',          col: '#7E57C2' },
  { k: 'ncw',      label: 'NCW internal records',      col: '#5C6B66' }];
const GROUPS = ['Birds', 'Mammals', 'Reptiles', 'Amphibians', 'Invertebrates', 'Fish']; // 'Other' (idx 6) is never selectable, as in the app
const TIER_FIELD = 0, TIER_NAMES = ['field', 'internal', 'compiled'];
// hcl(h = seq(15, 345, len = 12), c = 70, l = 45) and (c = 30, l = 70), hue order = ecoregion name order
const PAL = { GULF: ['#AA4E48', '#CEA09E'], ARAB: ['#985E00', '#C4A58E'], SAND: ['#7C6B00', '#B5AB85'], EMED: ['#527600', '#A0B187'],
              NARB: ['#007E22', '#8BB594'], NAHS: ['#00835D', '#7BB7A5'], REDS: ['#008286', '#79B5B7'], ESCP: ['#007AA5', '#88B1C5'],
              SWCX: ['#3F69B5', '#9FABCC'], SWHX: ['#8852B2', '#B6A4CB'], MONT: ['#A8419C', '#C79FC1'], WETL: ['#B14178', '#CF9EB1'] };
const VIVID = c => PAL[c][0], MUTED = c => PAL[c][1];
// colorRampPalette(c("#DDEBEA","#7FB8B5","#2A7F7C","#0F4544"))(20)
const RAMP = ['#DDEBEA', '#CEE2E1', '#BFDAD9', '#B0D2D0', '#A1CAC8', '#92C2C0', '#83BAB7', '#76B2AF', '#68A9A6', '#5BA09D',
              '#4D9793', '#408E8B', '#328582', '#287B79', '#247270', '#206967', '#1B605E', '#175755', '#134E4C', '#0F4544'];
const SP_DOT_COL = '#C0392B', BG_DOT_COL = '#C4C9C6', TELEM_COL = '#3557A6', RANGE_FILL = '#EAD9A6', ACCENT = '#1F7A78';
const SP_FILL = { many: '#0F3D3B', some: '#1E6F6C', one: '#3E9A96', expected: '#EAD9A6' };
const BASEMAPS = {
  light:   { light: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
             dark:  'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
             attr: 'Tiles &copy; Esri', maxZoom: 16 },
  streets: { light: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', dark: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
             attr: '&copy; OpenStreetMap contributors', maxZoom: 19 } };

const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const isDark = () => document.documentElement.dataset.theme === 'dark' ||
  (document.documentElement.dataset.theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
const fmt = x => (x == null || Number.isNaN(x)) ? '—' : Math.round(x).toLocaleString('en-US');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const el = (id) => document.getElementById(id);
const dayToISO = d => d == null ? null : new Date(d * 86400000).toISOString().slice(0, 10);
function bearing(e, n) {
  const ew = e > 0 ? `${e} E` : e < 0 ? `${-e} W` : '', ns = n > 0 ? `${n} N` : n < 0 ? `${-n} S` : '';
  const out = `${ew} ${ns}`.trim(); return out === '' ? 'anchor' : out;
}
function quantile7(values, p) {   // R default (type 7)
  const a = Float64Array.from(values).sort(); if (!a.length) return NaN;
  const h = (a.length - 1) * p, lo = Math.floor(h); return lo + 1 < a.length ? a[lo] + (h - lo) * (a[lo + 1] - a[lo]) : a[lo];
}
function rampFill(v, maxV) {
  if (v == null || Number.isNaN(v) || v <= 0) return cssVar('--map-nodata');
  v = Math.min(v, maxV); return RAMP[Math.max(1, Math.ceil(20 * v / maxV)) - 1];
}

// ---- State -----------------------------------------------------------------
const S = {
  eco: new Set(), mode: 'status', showCells: true, showNon: true, focus: false,
  src: new Set([0, 1, 2, 3, 4]), grp: new Set([0, 1, 2, 3, 4, 5]),
  basemap: 'light', ovEco: true, ovPa: false, ovWet: false, ovSites: false,
  species: null, spDots: true, spBg: true, spTelem: true,
  selCell: null, selEco: null, tab: 'cell', sub: 'species', satType: 'cells', satGroup: 'All'
};
const D = {};            // raw data files
const X = {};            // indexes
let M = null;            // current cell metrics
let map, cellLayers = [], cellGroups = {}, layers = {}, siteMarkers = [], spReq = 0, restackQueued = false;
let ECO_DRAW_ORDER = [], ECO_LIST = [];

// ---- Data loading -------------------------------------------------------------
const FILES = ['grid', 'observations', 'obs_cell', 'species', 'cell_expected', 'eco', 'sites', 'wetlands',
               'ecoregions', 'protected_areas', 'countries'];
async function loadAll() {
  let done = 0;
  const one = async (name) => {
    const ext = ['ecoregions', 'protected_areas', 'countries'].includes(name) ? 'geojson' : 'json';
    const r = await fetch(`data/${name}.${ext}`); if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
    D[name] = await r.json(); done++;
    el('load-bar').style.width = `${Math.round(100 * done / FILES.length)}%`;
    el('load-msg').textContent = `Loading data… ${done} / ${FILES.length}`;
  };
  await Promise.all(FILES.map(one));
}
const lazy = {};
async function lazyLoad(name, path) {
  if (!lazy[name]) lazy[name] = fetch(path).then(r => { if (!r.ok) throw new Error(path); return r.json(); });
  return lazy[name];
}

// ---- Indexes ---------------------------------------------------------------------
function buildIndexes() {
  const O = D.observations, cells = D.grid.cells;
  X.cells = cells; X.cellIdx = new Map(cells.map((c, i) => [c.id, i]));
  ECO_LIST = D.grid.eco.map(e => ({ ...e, vivid: VIVID(e.code), muted: MUTED(e.code) }));  // already sorted by name
  X.ecoByCode = new Map(ECO_LIST.map(e => [e.code, e]));
  ECO_DRAW_ORDER = [...ECO_LIST].sort((a, b) => b.cell_deg - a.cell_deg).map(e => e.code);
  S.eco = new Set(ECO_LIST.map(e => e.code));

  // obs -> cell links as typed arrays + per-cell lists (counting sort)
  const lo = Int32Array.from(D.obs_cell.o), lc = Int32Array.from(D.obs_cell.c), nl = lo.length, nc = cells.length;
  X.linkObs = lo; X.linkCell = lc;
  const cnt = new Int32Array(nc + 1); for (let i = 0; i < nl; i++) cnt[lc[i] + 1]++;
  for (let i = 0; i < nc; i++) cnt[i + 1] += cnt[i];
  const order = new Int32Array(nl), pos = cnt.slice(0, nc);
  for (let i = 0; i < nl; i++) order[pos[lc[i]]++] = lo[i];
  X.cellStart = cnt; X.cellObs = order;             // obs indices of cell c: cellObs[cellStart[c] .. cellStart[c+1])
  X.cellCode = cells.map(c => c.code);

  // typed columns
  X.src = Int8Array.from(O.src); X.tier = Int8Array.from(O.tier); X.grp = Int8Array.from(O.grp);
  X.sp = Int32Array.from(O.sp); X.issp = Uint8Array.from(O.issp); X.cn = Int32Array.from(O.cn);
  X.lon = Float64Array.from(O.lon); X.lat = Float64Array.from(O.lat); X.n = O.n;
  X.spNameIdx = new Map(O.sp_names.map((s, i) => [s, i]));

  // species lookup and expected lists
  X.speciesByName = new Map(D.species.map(s => [s.species, s]));
  const E = D.cell_expected; X.expSpecies = E.species; X.expGroupIdx = E.group.map(g => GROUPS.indexOf(g));
  X.expSpObs = E.species.map(s => X.spNameIdx.has(s) ? X.spNameIdx.get(s) : -1);
  X.expCells = E.cells; X.expByName = new Map(E.species.map((s, i) => [s, i]));
  const cellExp = Array.from({ length: nc }, () => []);
  E.cells.forEach((arr, e) => arr.forEach(c => cellExp[c].push(e)));
  X.cellExp = cellExp;

  // sites: parse cell list once
  D.sites.forEach(s => { s.cellSet = new Set((s.cells || '').split(';').filter(Boolean)); });
  X.ecoSpecies = D.eco.species; X.ecoSummary = new Map(D.eco.summary.map(r => [r.code, r]));
  X.telemSpecies = new Set(D.species.filter(s => s.collared).map(s => s.species));
}

// ---- Filtered records & per-cell metrics (server.R: oc_f, cell_metrics) --------------
let mask = null;
function recomputeMask() {
  mask = new Uint8Array(X.n);
  for (let i = 0; i < X.n; i++) mask[i] = S.src.has(X.src[i]) && S.grp.has(X.grp[i]) ? 1 : 0;
}
function computeCellMetrics() {
  const nc = X.cells.length, nRec = new Int32Array(nc), nField = new Int32Array(nc), srcBits = new Uint8Array(nc);
  const spSets = new Array(nc);
  const lo = X.linkObs, lc = X.linkCell;
  for (let i = 0; i < lo.length; i++) {
    const o = lo[i]; if (!mask[o]) continue; const c = lc[i];
    nRec[c]++; if (X.tier[o] === TIER_FIELD) nField[c]++; srcBits[c] |= 1 << X.src[o];
    if (X.issp[o]) (spSets[c] || (spSets[c] = new Set())).add(X.sp[o]);
  }
  const nSp = new Int32Array(nc), nExp = new Int32Array(nc), nExpFound = new Int32Array(nc);
  for (let c = 0; c < nc; c++) {
    const set = spSets[c]; nSp[c] = set ? set.size : 0;
    for (const e of X.cellExp[c]) {
      if (!S.grp.has(X.expGroupIdx[e])) continue;
      nExp[c]++; if (set && X.expSpObs[e] >= 0 && set.has(X.expSpObs[e])) nExpFound[c]++;
    }
  }
  const sources = Array.from(srcBits, b => SOURCES.map((s, i) => (b >> i) & 1 ? s.k : null).filter(Boolean).sort().join(', '));
  M = { nRec, nField, nSp, nExp, nExpFound, spSets, sources,
        pct: Array.from(nExp, (e, c) => e > 0 ? 100 * nExpFound[c] / e : null) };
}
// records of the selected species per cell (species colour mode)
function speciesCellCounts(spIdx) {
  const out = new Int32Array(X.cells.length), lo = X.linkObs, lc = X.linkCell;
  for (let i = 0; i < lo.length; i++) if (mask[lo[i]] && X.sp[lo[i]] === spIdx) out[lc[i]]++;
  return out;
}

// ---- Cell styling (server.R: cell_style) -----------------------------------------------
function cellStyles() {
  const mode = S.species ? 'species' : S.mode, cells = X.cells, nc = cells.length;
  const noData = cssVar('--map-nodata'), context = cssVar('--map-context'), strokeS = cssVar('--cell-stroke-s'), strokeN = cssVar('--cell-stroke-n');
  let spN = null, spExp = null;
  if (mode === 'species') {
    const si = X.spNameIdx.has(S.species) ? X.spNameIdx.get(S.species) : -1;
    spN = si >= 0 ? speciesCellCounts(si) : new Int32Array(nc);
    spExp = new Uint8Array(nc);
    if (X.expByName.has(S.species)) for (const c of X.expCells[X.expByName.get(S.species)]) spExp[c] = 1;
  }
  let maxR = 20, maxN = Math.log1p(50);
  if (mode === 'richness') { const pos = Array.from(M.nSp).filter(v => v > 0); if (pos.length) maxR = Math.max(20, quantile7(pos, .95)); }
  if (mode === 'records')  { const pos = Array.from(M.nRec).filter(v => v > 0); if (pos.length) maxN = Math.log1p(Math.max(50, quantile7(pos, .95))); }
  const out = new Array(nc);
  for (let c = 0; c < nc; c++) {
    const cell = cells[c], s = cell.s === 1; let fill, op;
    switch (mode) {
      case 'status':   fill = s ? VIVID(cell.code) : MUTED(cell.code); op = s ? .85 : .28; break;
      case 'richness': fill = rampFill(M.nSp[c], maxR); op = s ? .9 : .55; break;
      case 'records':  fill = rampFill(Math.log1p(M.nRec[c]), maxN); op = s ? .9 : .55; break;
      case 'gap':      fill = M.pct[c] == null ? noData : rampFill(M.pct[c], 100); op = s ? .9 : .55; break;
      case 'species': {
        const n = spN[c];
        if (n >= 6) fill = SP_FILL.many; else if (n >= 2) fill = SP_FILL.some; else if (n >= 1) fill = SP_FILL.one;
        else if (spExp[c]) fill = SP_FILL.expected; else fill = null;
        op = fill ? 1 : 0; if (!fill) fill = noData; break;      // opaque fills so overlapping grids never blend
      }
    }
    if (S.focus && S.selEco && cell.code !== S.selEco) { fill = context; op = .6; }
    let weight = s ? .6 : .15, color = s ? strokeS : strokeN;
    if (S.selCell === cell.id) { weight = 2.5; color = isDark() ? '#FFFFFF' : '#111111'; }
    out[c] = { fillColor: fill, fillOpacity: op, color, weight, opacity: 1 };
  }
  return { styles: out, mode, spN, spExp };
}
let lastStyle = null;
function cellLabel(c) {
  const cell = X.cells[c], eco = X.ecoByCode.get(cell.code);
  let spLine = '';
  if (lastStyle && lastStyle.mode === 'species') {
    const n = lastStyle.spN[c];
    const txt = n > 0 ? `${n} ${n === 1 ? 'record' : 'records'}` : lastStyle.spExp[c] ? 'no records; inside expert range' : 'no records; outside expert range';
    spLine = `<span class="sp"><i>${esc(S.species)}</i>: ${txt}</span>`;
  }
  return `<div class="cell-label"><b>${esc(cell.id)}</b><span>${esc(eco.name)}</span><span>${esc(cell.status)} &middot; ${bearing(cell.e, cell.n)} from anchor</span>${spLine}` +
         `<span>all species: ${fmt(M.nSp[c])} &middot; ${fmt(M.nRec[c])} records &middot; ${M.sources[c] || 'no data'}</span></div>`;
}
function restyleCells() {
  lastStyle = cellStyles();
  for (let c = 0; c < cellLayers.length; c++) cellLayers[c].setStyle(lastStyle.styles[c]);
  renderLegend();
}

// ---- Map (server.R: output$map) -----------------------------------------------------
function buildMap() {
  map = L.map('map', { preferCanvas: true, minZoom: 4, maxZoom: 14, zoomSnap: 0, zoomDelta: .5, scrollWheelZoom: false,
                       zoomControl: true, attributionControl: true }).setView([24.2, 45.0], 5);
  map.attributionControl.setPrefix('TDE 2.0 · <a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
  if (window.installSmoothZoom) window.installSmoothZoom(map);
  map.createPane('p_country').style.zIndex = 350;            // below cells; non-interactive
  map.getPane('p_country').style.pointerEvents = 'none';

  layers.tiles = null;
  layers.country = L.geoJSON(D.countries, { pane: 'p_country', interactive: false, style: countryStyle }).addTo(map);

  // cells: one L.rectangle per cell, grouped by ecoregion x survey status
  for (const code of ECO_DRAW_ORDER) { cellGroups[code + '_n'] = L.layerGroup(); cellGroups[code + '_s'] = L.layerGroup(); }
  X.cells.forEach((cell, c) => {
    const r = L.rectangle([[cell.y1, cell.x1], [cell.y2, cell.x2]], { weight: .3, color: '#999', fillOpacity: .3, fillColor: '#ccc', cellIdx: c });
    r.bindTooltip(() => cellLabel(c), { sticky: true, direction: 'auto', opacity: .97 });
    r.on('click', () => selectCell(cell.id));
    r.on('mouseover', function () { this.setStyle({ weight: 2, color: isDark() ? '#fff' : '#111' }); this.bringToFront(); });
    r.on('mouseout', function () { if (lastStyle) this.setStyle(lastStyle.styles[c]); queueRestack(); });
    cellLayers.push(r); cellGroups[cell.code + (cell.s ? '_s' : '_n')].addLayer(r);
  });

  // ecoregion boundaries (fill off so clicks inside fall through to cells; the stroke is clickable)
  layers.eco = L.geoJSON(D.ecoregions, {
    style: f => ({ fill: false, color: cssVar('--eco-line'), opacity: .85, weight: f.properties.code === 'WETL' ? .35 : .9 }),
    onEachFeature: (f, l) => { l.bindTooltip(f.properties.eco_name, { sticky: true }); l.on('click', (e) => { L.DomEvent.stop(e); selectEco(f.properties.code); }); }
  });
  layers.pa = L.geoJSON(D.protected_areas, {
    style: { fillColor: '#6B8F3A', fillOpacity: .12, color: '#4F6E27', weight: 1, dashArray: '4 3' },
    onEachFeature: (f, l) => l.bindTooltip(`${f.properties.pa_name_en} (${f.properties.category}, ${f.properties.status_ar || ''})`, { sticky: true })
  });
  layers.wet = L.layerGroup(D.wetlands.map(w => L.circleMarker([w.lat, w.lon], {
    radius: w.surveyed ? 5 : 3, stroke: true, weight: 1, color: '#1F4E8C', fillColor: w.surveyed ? '#2F6DB3' : '#FFFFFF', fillOpacity: .9 })
    .bindTooltip(`${w.name_ar || 'Wetland ' + w.id}${w.surveyed ? ' (surveyed)' : ''}`)));
  siteMarkers = D.sites.map(s => L.circleMarker([s.lat, s.lon], {
    radius: Math.min(2 + Math.sqrt(s.n_species) * .9, 9), stroke: false, fillColor: SOURCES[s.src].col, fillOpacity: .75, siteSrc: s.src })
    .bindTooltip(`${SOURCES[s.src].label}: ${s.n_species} species, ${s.n_records} records${s.methods ? ' (' + s.methods + ')' : ''}`));
  layers.sites = L.layerGroup();
  layers.rangeFill = L.layerGroup(); layers.rangeLine = L.layerGroup(); layers.bg = L.layerGroup();
  layers.telem = L.layerGroup(); layers.spDots = L.layerGroup();

  syncCellVisibility(); setBasemap(); syncOverlays();
}
function countryStyle(f) {
  const none = S.basemap === 'none';
  return { fillColor: cssVar('--map-land'), fillOpacity: none ? 1 : 0, color: cssVar('--map-land-line'), weight: f.properties.ksa ? .9 : .5, opacity: none ? 1 : .6 };
}
function setBasemap() {
  if (layers.tiles) { map.removeLayer(layers.tiles); layers.tiles = null; }
  if (S.basemap !== 'none') {
    const b = BASEMAPS[S.basemap];
    layers.tiles = L.tileLayer(isDark() ? b.dark : b.light, { attribution: b.attr, maxZoom: b.maxZoom, maxNativeZoom: b.maxZoom }).addTo(map);
  }
  layers.country.setStyle(countryStyle);
}
const OVERLAY_ORDER = ['rangeFill', 'eco', 'pa', 'wet', 'sites', 'rangeLine', 'bg', 'telem', 'spDots'];
function queueRestack() {   // a hovered cell was raised above the overlays; put them back once per frame
  if (restackQueued) return; restackQueued = true;
  requestAnimationFrame(() => { restackQueued = false; restack(); });
}
function visibleGroups() {
  if (!S.showCells) return [];
  const out = [];
  for (const code of ECO_DRAW_ORDER) if (S.eco.has(code)) { if (S.showNon) out.push(code + '_n'); out.push(code + '_s'); }
  return out;
}
function syncCellVisibility() {
  const vis = new Set(visibleGroups());
  for (const g of Object.keys(cellGroups)) if (map.hasLayer(cellGroups[g])) map.removeLayer(cellGroups[g]);
  for (const g of visibleGroups()) map.addLayer(cellGroups[g]);         // re-added in draw order: small cells on top
  restack();
  if (lastStyle && lastStyle.mode === 'species') renderLegend();
}
function restack() {   // single canvas: anything drawn above cells must be re-raised after cells are re-added
  for (const k of OVERLAY_ORDER) if (map.hasLayer(layers[k])) layers[k].eachLayer(l => l.bringToFront && l.bringToFront());
}
function syncOverlays() {
  const toggle = (on, l) => { if (on && !map.hasLayer(l)) map.addLayer(l); if (!on && map.hasLayer(l)) map.removeLayer(l); };
  toggle(S.ovEco, layers.eco); toggle(S.ovPa, layers.pa); toggle(S.ovWet, layers.wet);
  layers.sites.clearLayers();                                   // sites of switched-off sources are dropped, as in the app
  for (const m of siteMarkers) if (S.src.has(m.options.siteSrc)) layers.sites.addLayer(m);
  toggle(S.ovSites, layers.sites);
  restack();
}

// ---- Species layers (server.R: range / points / telemetry observers) -----------------------
async function syncSpeciesLayers() {
  const req = ++spReq;      // any later call supersedes this one once it awaits
  for (const k of ['rangeFill', 'rangeLine', 'bg', 'telem', 'spDots']) { layers[k].clearLayers(); if (map.hasLayer(layers[k])) map.removeLayer(layers[k]); }
  const sp = S.species; if (!sp) { renderLegend(); return; }
  // background wash of all records (deduplicated by ~100 m), then the species' own records
  if (S.spBg) {
    const seen = new Set();
    for (let i = 0; i < X.n; i++) {
      if (!mask[i] || Number.isNaN(X.lon[i])) continue;
      const key = `${X.lon[i].toFixed(3)},${X.lat[i].toFixed(3)}`; if (seen.has(key)) continue; seen.add(key);
      layers.bg.addLayer(L.circleMarker([X.lat[i], X.lon[i]], { radius: 1.6, stroke: false, fillColor: BG_DOT_COL, fillOpacity: .55, interactive: false }));
    }
    map.addLayer(layers.bg);
  }
  if (S.spDots) {
    const si = X.spNameIdx.get(sp), O = D.observations;
    if (si != null) for (let i = 0; i < X.n; i++) {
      if (!mask[i] || X.sp[i] !== si || Number.isNaN(X.lon[i])) continue;
      const cn = X.cn[i] >= 0 ? ` · ${O.cn_names[X.cn[i]]}` : '', d = O.date[i] == null ? 'no date' : dayToISO(O.date[i]);
      layers.spDots.addLayer(L.circleMarker([X.lat[i], X.lon[i]], { radius: 4, stroke: true, color: '#FFFFFF', weight: 1, opacity: .9, fillColor: SP_DOT_COL, fillOpacity: .9 })
        .bindTooltip(`${SOURCES[X.src[i]].label} · ${d}${esc(cn)}`));
    }
    map.addLayer(layers.spDots);
  }
  const ranges = await lazyLoad('ranges', 'data/ranges.geojson'); if (spReq !== req) return;
  const r = ranges.features.find(f => f.properties.species === sp);
  if (r) {
    const cellsOn = visibleGroups().length > 0;
    layers.rangeFill.addLayer(L.geoJSON(r, { interactive: false, style: { fillColor: RANGE_FILL, fillOpacity: cellsOn ? .08 : .30, stroke: false } }));
    layers.rangeLine.addLayer(L.geoJSON(r, { style: { fill: false, color: '#8A6A1F', weight: 1.8, opacity: .9, dashArray: '7 5' } }).bindTooltip(`Expert range: ${sp}`, { sticky: true }));
    map.addLayer(layers.rangeFill); map.addLayer(layers.rangeLine);
  }
  if (S.spTelem && X.telemSpecies.has(sp)) {
    const t = await lazyLoad('telemetry', 'data/telemetry.geojson'); if (spReq !== req) return;
    const segs = t.features.filter(f => f.properties.species === sp);
    layers.telem.addLayer(L.geoJSON({ type: 'FeatureCollection', features: segs }, {
      style: { color: TELEM_COL, weight: 1.5, opacity: .75 },
      onEachFeature: (f, l) => {
        const p = f.properties;
        l.bindTooltip(`Collar ${p.device_id} · ${p.species_label} (${p.cluster}) · ${fmt(p.n_fix)} fixes · ${p.t0} – ${p.t1}`, { sticky: true });
        l.on('mouseover', () => l.setStyle({ weight: 3, opacity: 1})); l.on('mouseout', () => l.setStyle({ weight: 1.5, opacity: .75 }));
      } }));
    map.addLayer(layers.telem);
  }
  restack(); renderLegend();
}
function rangeFillOpacity() {
  const cellsOn = visibleGroups().length > 0;
  layers.rangeFill.eachLayer(g => g.setStyle({ fillOpacity: cellsOn ? .08 : .30 }));
}

// ---- Legend (server.R: output$legend) --------------------------------------------------
function renderLegend() {
  const mode = lastStyle ? lastStyle.mode : S.mode, noData = cssVar('--map-nodata');
  const sw = (col, txt, op = 1) => `<span class="lg"><i style="background:${col};opacity:${op}"></i>${txt}</span>`;
  const dot = (col, txt) => `<span class="lg"><i class="dot" style="background:${col}"></i>${txt}</span>`;
  const line = (col, txt) => `<span class="lg"><i class="tline" style="background:${col}"></i>${txt}</span>`;
  let h = '';
  switch (mode) {
    case 'status':   h = sw(VIVID('REDS'), 'survey cell (random + systematic)') + sw(MUTED('REDS'), 'non-survey cell', .4) + '<span class="lg-note">hue = ecoregion</span>'; break;
    case 'richness': h = sw(RAMP[1], 'few species') + sw(RAMP[9], '') + sw(RAMP[19], 'many') + sw(noData, 'no data'); break;
    case 'records':  h = sw(RAMP[1], 'few records') + sw(RAMP[9], '') + sw(RAMP[19], 'many (log scale)') + sw(noData, 'no data'); break;
    case 'gap':      h = sw(RAMP[1], '0% of expected species found') + sw(RAMP[19], '100%') + sw(noData, 'no expected list'); break;
    case 'species': {
      const cellsOn = visibleGroups().length > 0;
      if (cellsOn) h += sw(SP_FILL.one, '1 record') + sw(SP_FILL.some, '2–5') + sw(SP_FILL.many, '6+ records (cells)') + sw(SP_FILL.expected, 'expected, no records');
      if (S.spDots) h += dot(SP_DOT_COL, 'record of this species');
      if (S.spBg) h += dot(BG_DOT_COL, 'any wildlife record');
      if (S.spTelem && S.species && X.telemSpecies.has(S.species)) h += line(TELEM_COL, 'collar track');
      h += '<span class="lg-note">dashed line + sand fill = expert range</span>';
    }
  }
  el('legend').innerHTML = h;
}

// ---- Headline ---------------------------------------------------------------------
function renderHeadline() {
  let sample = 0, withData = 0, field = 0, links = 0; const spSet = new Set();
  X.cells.forEach((cell, c) => { if (cell.s) { sample++; if (M.nRec[c] > 0) withData++; if (M.nField[c] > 0) field++; } });
  const lo = X.linkObs;
  for (let i = 0; i < lo.length; i++) if (mask[lo[i]]) { links++; if (X.issp[lo[i]]) spSet.add(X.sp[lo[i]]); }
  el('headline').textContent = `${fmt(sample)} survey cells, ${fmt(withData)} with data (${fmt(field)} field-surveyed) · ${fmt(spSet.size)} species · ${fmt(links)} records`;
}

// ---- Tables (DT-like) ---------------------------------------------------------------
function Table(host, cfg) {
  const cols = cfg.cols, pageLen = cfg.pageLen || 10;
  let rows = [], q = '', sortK = cfg.sortK || null, sortDir = cfg.sortDir || 1, page = 0, built = false;
  function build() {
    host.innerHTML = `<div class="tbl"><div class="tbl-top"><input type="search" placeholder="filter" aria-label="filter rows"><span class="tbl-info"></span></div>
      <div class="tbl-scroll"><table class="dt"><thead><tr>${cols.map(c => `<th data-k="${c.k}" class="${c.num ? 'num' : ''}">${esc(c.l)}</th>`).join('')}</tr></thead><tbody></tbody></table></div>
      <div class="tbl-foot"><button type="button" class="prev">&#8249;</button><span class="pg"></span><button type="button" class="next">&#8250;</button></div></div>`;
    host.querySelector('input').addEventListener('input', e => { q = e.target.value.trim().toLowerCase(); page = 0; render(); });
    host.querySelectorAll('th').forEach(th => th.addEventListener('click', () => { const k = th.dataset.k; if (sortK === k) sortDir = -sortDir; else { sortK = k; sortDir = 1; } render(); }));
    host.querySelector('.prev').addEventListener('click', () => { page--; render(); });
    host.querySelector('.next').addEventListener('click', () => { page++; render(); });
    built = true;
  }
  function render() {
    if (!built) build();
    let v = q ? rows.filter(r => cols.some(c => String(r[c.k] ?? '').toLowerCase().includes(q))) : rows.slice();
    if (sortK) {
      const col = cols.find(c => c.k === sortK);
      v.sort((a, b) => { const x = a[sortK], y = b[sortK]; if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
        return (col && col.num ? x - y : String(x).localeCompare(String(y))) * sortDir; });
    }
    const n = v.length, pages = Math.max(1, Math.ceil(n / pageLen)); page = Math.min(Math.max(0, page), pages - 1);
    const slice = v.slice(page * pageLen, (page + 1) * pageLen);
    host.querySelectorAll('th').forEach(th => th.setAttribute('aria-sort', th.dataset.k === sortK ? (sortDir > 0 ? 'ascending' : 'descending') : 'none'));
    const tb = host.querySelector('tbody');
    tb.innerHTML = slice.map(r => `<tr class="${cfg.onRow ? 'clickable' : ''}">${cols.map(c => {
      const val = r[c.k]; const txt = c.render ? c.render(val, r) : (val == null ? '' : c.num ? fmt(val) : esc(val));
      return `<td class="${c.num ? 'num' : ''}${c.mono ? ' mono' : ''}">${txt}</td>`; }).join('')}</tr>`).join('');
    if (cfg.onRow) Array.from(tb.rows).forEach((tr, i) => tr.addEventListener('click', () => cfg.onRow(slice[i])));
    host.querySelector('.tbl-info').textContent = n ? `${page * pageLen + 1}–${Math.min(n, (page + 1) * pageLen)} of ${fmt(n)}${q ? ` (filtered from ${fmt(rows.length)})` : ''}` : (q ? `0 of ${fmt(rows.length)}` : '');
    host.querySelector('.pg').textContent = `${page + 1} / ${pages}`;
    host.querySelector('.prev').disabled = page === 0; host.querySelector('.next').disabled = page >= pages - 1;
    host.querySelector('.tbl-foot').hidden = pages <= 1;
  }
  return {
    set(newRows) { rows = newRows; page = 0; if (!built) build(); render(); },
    note(msg) { host.innerHTML = `<div class="dt-note">${esc(msg)}</div>`; built = false; }
  };
}
const SRC_LABEL = i => SOURCES[i].label;
const check = v => v ? '✓' : '';

// ---- Cell tab (server.R: cell_*) ----------------------------------------------------
const T = {};
function cellObsIdx(c) { const out = []; for (let i = X.cellStart[c]; i < X.cellStart[c + 1]; i++) if (mask[X.cellObs[i]]) out.push(X.cellObs[i]); return out; }
function renderCell() {
  const id = S.selCell, head = el('cell-head'), stats = el('cell-stats');
  if (!id) { head.innerHTML = '<div class="empty">Click a cell on the map, or type a cell id under Find.</div>'; stats.innerHTML = ''; el('cell-sub').hidden = true; return; }
  el('cell-sub').hidden = false;
  const c = X.cellIdx.get(id), cell = X.cells[c], eco = X.ecoByCode.get(cell.code), O = D.observations;
  head.innerHTML = `<div class="panel-head"><span class="swatch big" style="background:${VIVID(cell.code)}"></span>
    <div><h4 class="mono">${esc(id)}</h4><div class="sub">${esc(eco.name)} · ${esc(cell.status)} · ${bearing(cell.e, cell.n)} from anchor</div></div>
    <button class="goto" type="button" id="goto-eco">ecoregion →</button></div>`;
  el('goto-eco').addEventListener('click', () => setTab('eco'));
  const idx = cellObsIdx(c), grpCount = new Map(), srcSet = new Set();
  for (const o of idx) { srcSet.add(X.src[o]); if (X.issp[o]) { const g = O.groups[X.grp[o]]; (grpCount.get(g) || grpCount.set(g, new Set()).get(g)).add(X.sp[o]); } }
  const grp = [...grpCount.entries()].map(([g, s]) => [g, s.size]).sort((a, b) => b[1] - a[1]);
  const stat = (v, l) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`;
  stats.innerHTML = `<div class="stat-row">${stat(fmt(M.nSp[c]), 'species')}${stat(fmt(M.nRec[c]), 'records')}${stat(M.nExp[c] > 0 ? `${M.nExpFound[c]} / ${M.nExp[c]}` : '—', 'expected found')}${stat(fmt(srcSet.size), 'sources')}</div>
    <div class="chips">${grp.map(([g, n]) => `<span class="chip">${g}<b>${n}</b></span>`).join('')}${cell.npa > 0 ? `<span class="chip pa">${esc(cell.pa)}</span>` : ''}${cell.nwet > 0 ? `<span class="chip wet">${cell.nwet} registry wetland${cell.nwet > 1 ? 's' : ''}</span>` : ''}</div>`;
  renderCellSub();
}
function renderCellSub() {
  const id = S.selCell; if (!id) return;
  const c = X.cellIdx.get(id), O = D.observations, idx = cellObsIdx(c), expHere = new Set(X.cellExp[c].map(e => X.expSpecies[e]));
  const recorded = M.spSets[c] || new Set();
  if (S.sub === 'species') {
    const by = new Map();
    for (const o of idx) { if (!X.issp[o]) continue; const name = O.sp_names[X.sp[o]];
      const r = by.get(name) || by.set(name, { species: name, group: O.groups[X.grp[o]], common: null, records: 0, src: new Set() }).get(name);
      r.records++; r.src.add(SOURCES[X.src[o]].k); if (r.common == null && X.cn[o] >= 0) r.common = O.cn_names[X.cn[o]]; }
    const rows = [...by.values()].map(r => ({ ...r, sources: [...r.src].sort().join(', '), expected: check(expHere.has(r.species)) }))
      .sort((a, b) => a.group.localeCompare(b.group) || a.species.localeCompare(b.species));
    if (!rows.length) T.cellSpecies.note('No species recorded in this cell with the current filters.'); else T.cellSpecies.set(rows);
  } else if (S.sub === 'sites') {
    const rows = D.sites.filter(s => s.cellSet.has(id) && S.src.has(s.src))
      .sort((a, b) => ((b.tier === TIER_FIELD) - (a.tier === TIER_FIELD)) || (b.n_species - a.n_species))
      .map(s => ({ site: s.name || s.key, source: SRC_LABEL(s.src), tier: TIER_NAMES[s.tier], species: s.n_species, records: s.n_records, visits: s.n_visits,
                   last: s.last, methods: s.methods, lat: +s.lat.toFixed(4), lon: +s.lon.toFixed(4) }));
    if (!rows.length) T.cellSites.note('No survey sites in this cell.'); else T.cellSites.set(rows);
  } else if (S.sub === 'records') {
    renderCellRecords(c, idx);
  } else if (S.sub === 'expected') {
    const rows = X.cellExp[c].filter(e => S.grp.has(X.expGroupIdx[e])).map(e => { const sp = X.expSpecies[e], s = X.speciesByName.get(sp);
      return { species: sp, group: X.expGroupIdx[e] >= 0 ? GROUPS[X.expGroupIdx[e]] : '', iucn: s ? s.iucn : null, recorded: check(X.expSpObs[e] >= 0 && recorded.has(X.expSpObs[e])) }; })
      .sort((a, b) => b.recorded.localeCompare(a.recorded) || a.group.localeCompare(b.group) || a.species.localeCompare(b.species));
    if (!rows.length) T.cellExpected.note('No expert-range species for this cell.'); else T.cellExpected.set(rows);
  }
}
async function renderCellRecords(c, idx) {
  const O = D.observations, code = X.cells[c].code;
  if (!idx.length) { T.cellRecords.note('No records.'); return; }
  T.cellRecords.note('Loading record details…');
  let attrs = {}; try { attrs = await lazyLoad('attrs_' + code, `data/attrs/${code}.json`); } catch (e) { /* details stay empty */ }
  if (S.selCell !== X.cells[c].id || S.sub !== 'records') return;
  const rows = idx.map(o => {
    const a = attrs[o]; let details = '';
    if (a) details = Object.entries(a).map(([k, v]) => `${k}:${v}`).join(',');
    return { source: SRC_LABEL(X.src[o]), project: O.projects[O.proj[o]] ?? '', season: O.seasons[O.seas[o]] ?? '', date: dayToISO(O.date[o]),
             method: O.methods[O.meth[o]] ?? '', group: O.groups[X.grp[o]], species: O.sp_names[X.sp[o]] ?? '', common_name: X.cn[o] >= 0 ? O.cn_names[X.cn[o]] : '',
             site: O.site_ids[O.site[o]] ?? '', details, id: O.id[o] };
  }).sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.species.localeCompare(b.species));
  T.cellRecords.set(rows);
}

// ---- Ecoregion tab (server.R: eco_*) --------------------------------------------------
function ecoObsIdx(code) {   // masked obs->cell links inside this ecoregion's cells (one entry per link, as in R)
  const out = [], cellOut = [], lo = X.linkObs, lc = X.linkCell;
  for (let i = 0; i < lo.length; i++) if (mask[lo[i]] && X.cellCode[lc[i]] === code) { out.push(lo[i]); cellOut.push(lc[i]); }
  return { obs: out, cell: cellOut };
}
function ecoSelectHtml(selected) {
  return `<select id="eco-pick" aria-label="choose an ecoregion">${selected ? '' : '<option value="">choose an ecoregion</option>'}${ECO_LIST.map(e => `<option value="${e.code}" ${e.code === selected ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</select>`;
}
function renderEco() {
  const code = S.selEco, head = el('eco-head'), stats = el('eco-stats');
  if (!code) {
    head.innerHTML = `<div class="empty">Click an ecoregion boundary or a cell, or choose one:</div>${ecoSelectHtml('')}`; stats.innerHTML = ''; el('eco-body').hidden = true;
    el('eco-pick').addEventListener('change', e => { if (e.target.value) selectEco(e.target.value, false); }); return;
  }
  el('eco-body').hidden = false;
  const e = X.ecoByCode.get(code), sum = X.ecoSummary.get(code), O = D.observations;
  head.innerHTML = `<div class="panel-head"><span class="swatch big" style="background:${VIVID(code)}"></span>
    <div><h4>${esc(e.name)}</h4><div class="sub">${code} · ${fmt(e.area_km2)} km² · ${fmt(sum.n_cells)} cells</div></div>${ecoSelectHtml(code)}</div>`;
  el('eco-pick').addEventListener('change', ev => selectEco(ev.target.value, false));

  const eo = ecoObsIdx(code), spSet = new Set(); for (const o of eo.obs) if (X.issp[o]) spSet.add(X.sp[o]);
  let sample = 0, withData = 0, field = 0;
  X.cells.forEach((cell, c) => { if (cell.code === code && cell.s) { sample++; if (M.nRec[c] > 0) withData++; if (M.nField[c] > 0) field++; } });
  const expRows = X.ecoSpecies.filter(r => r.code === code && r.expected && S.grp.has(GROUPS.indexOf(r.group)));
  const found = expRows.filter(r => X.spNameIdx.has(r.species) && spSet.has(X.spNameIdx.get(r.species))).length;
  const stat = (v, l) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`;
  stats.innerHTML = `<div class="stat-row">${stat(`${withData} / ${sample}`, 'survey cells with data')}${stat(fmt(field), 'field-surveyed')}${stat(fmt(spSet.size), 'species recorded')}${stat(expRows.length ? `${found} / ${expRows.length}` : '—', 'expected found')}</div>`;

  renderEcoCurve(code); renderEcoBreakdown(code, eo);
  // species table: recorded (grouped) full-joined with expected
  const by = new Map();
  eo.obs.forEach((o, i) => { if (!X.issp[o]) return; const name = O.sp_names[X.sp[o]];
    const r = by.get(name) || by.set(name, { species: name, group: O.groups[X.grp[o]], common: null, cells: new Set(), records: 0, src: new Set() }).get(name);
    r.records++; r.cells.add(eo.cell[i]); r.src.add(SOURCES[X.src[o]].k); if (r.common == null && X.cn[o] >= 0) r.common = O.cn_names[X.cn[o]]; });
  const rows = [...by.values()].map(r => ({ species: r.species, group: r.group, common: r.common, cells: r.cells.size, records: r.records, sources: [...r.src].sort().join(', '), expected: '' }));
  const have = new Set(rows.map(r => r.species));
  for (const r of expRows) { if (have.has(r.species)) rows.find(x => x.species === r.species).expected = '✓';
    else rows.push({ species: r.species, group: r.group, common: null, cells: 0, records: 0, sources: '', expected: '✓' }); }
  rows.sort((a, b) => b.records - a.records || a.species.localeCompare(b.species));
  T.ecoSpecies.set(rows);
}
function plotFont() { return { family: 'IBM Plex Sans, sans-serif', size: 11, color: cssVar('--fg') }; }
function plotBase() { return { paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)', font: plotFont() }; }
function axisBase() { return { gridcolor: cssVar('--line'), zeroline: false, linecolor: cssVar('--line'), tickfont: { color: cssVar('--muted') } }; }
const PLOT_CFG = { displayModeBar: false, responsive: true };
function renderEcoCurve(code) {
  const host = el('eco-curve');
  const s = D.eco.saturation.filter(r => r.code === code && r.taxon_group === S.satGroup && r.type === S.satType);
  const nExp = X.ecoSpecies.filter(r => r.code === code && r.expected && (S.satGroup === 'All' || r.group === S.satGroup)).length;
  const xl = S.satType === 'cells' ? 'cells sampled' : 'records';
  if (!s.length) { Plotly.react(host, [], { ...plotBase(), title: { text: 'No data for this group', font: { size: 12, color: cssVar('--muted') } }, xaxis: { visible: false }, yaxis: { visible: false }, margin: { l: 10, r: 10, t: 30, b: 10 } }, PLOT_CFG); return; }
  const x = s.map(r => r.n), traces = [];
  if (S.satType === 'cells') {
    traces.push({ x, y: s.map(r => Math.max(0, r.s_mean - (r.s_sd || 0))), mode: 'lines', line: { width: 0 }, hoverinfo: 'skip', showlegend: false });
    traces.push({ x, y: s.map(r => r.s_mean + (r.s_sd || 0)), mode: 'lines', line: { width: 0 }, fill: 'tonexty', fillcolor: VIVID(code) + '33', name: '± 1 sd', hoverinfo: 'skip' });
  }
  traces.push({ x, y: s.map(r => r.s_mean), mode: 'lines', name: 'species accumulated', line: { color: VIVID(code), width: 2.5 }, hovertemplate: `%{y:.0f} species after %{x} ${xl}<extra></extra>` });
  if (nExp > 0) traces.push({ x: [x[0], x[x.length - 1]], y: [nExp, nExp], mode: 'lines', name: `expected (${nExp})`, line: { color: cssVar('--fg'), width: 1, dash: 'dash' }, hoverinfo: 'name' });
  Plotly.react(host, traces, { ...plotBase(), xaxis: { ...axisBase(), title: { text: xl } }, yaxis: { ...axisBase(), title: { text: 'species' }, rangemode: 'tozero' },
    legend: { orientation: 'h', y: 1.14, font: { size: 10 } }, margin: { l: 45, r: 10, t: 30, b: 40 }, hovermode: 'x' }, PLOT_CFG);
}
function renderEcoBreakdown(code, eo) {
  const host = el('eco-breakdown'), O = D.observations, seen = new Set(), cnt = new Map();
  for (const o of eo.obs) { if (!X.issp[o]) continue; const key = `${X.grp[o]}|${X.src[o]}|${X.sp[o]}`; if (seen.has(key)) continue; seen.add(key);
    const k = `${X.grp[o]}|${X.src[o]}`; cnt.set(k, (cnt.get(k) || 0) + 1); }
  if (!cnt.size) { Plotly.react(host, [], { ...plotBase(), xaxis: { visible: false }, yaxis: { visible: false }, margin: { l: 10, r: 10, t: 8, b: 20 } }, PLOT_CFG); return; }
  const traces = SOURCES.map((src, si) => ({ type: 'bar', orientation: 'h', name: src.k, marker: { color: src.col },
    y: GROUPS.slice().reverse(), x: GROUPS.slice().reverse().map(g => cnt.get(`${O.groups.indexOf(g)}|${si}`) || 0),
    hovertemplate: '%{x} species (%{fullData.name})<extra></extra>' })).filter(t => t.x.some(v => v > 0));
  Plotly.react(host, traces, { ...plotBase(), barmode: 'stack', xaxis: { ...axisBase(), title: '' }, yaxis: { ...axisBase(), title: '', tickfont: { size: 10, color: cssVar('--muted') }, categoryorder: 'array', categoryarray: GROUPS.slice().reverse() },
    legend: { orientation: 'h', y: -0.28, x: 0, font: { size: 10 } }, margin: { l: 80, r: 10, t: 8, b: 20 } }, PLOT_CFG);
}

// ---- Overview tab -------------------------------------------------------------------
function overviewData() {
  const O = D.observations, rows = new Map();
  for (const e of ECO_LIST) rows.set(e.code, { code: e.code, eco_name: e.name, survey_cells: 0, with_data: 0, field: 0, records: 0, spSet: new Set() });
  X.cells.forEach((cell, c) => { const r = rows.get(cell.code); if (cell.s) { r.survey_cells++; if (M.nRec[c] > 0) r.with_data++; if (M.nField[c] > 0) r.field++; r.records += M.nRec[c]; } });
  const lo = X.linkObs, lc = X.linkCell;
  for (let i = 0; i < lo.length; i++) if (mask[lo[i]] && X.issp[lo[i]]) rows.get(X.cellCode[lc[i]]).spSet.add(X.sp[lo[i]]);
  for (const r of rows.values()) {
    const exp = X.ecoSpecies.filter(x => x.code === r.code && x.expected && S.grp.has(GROUPS.indexOf(x.group)));
    r.species = r.spSet.size; r.expected = exp.length;
    r.found = exp.filter(x => X.spNameIdx.has(x.species) && r.spSet.has(X.spNameIdx.get(x.species))).length;
    r.pct_with_data = Math.round(100 * r.with_data / r.survey_cells); r.pct_expected = r.expected > 0 ? Math.round(100 * r.found / r.expected) : null;
  }
  return [...rows.values()].sort((a, b) => a.pct_with_data - b.pct_with_data);
}
function renderOverview() {
  const d = overviewData();
  const bar = (v, col) => v == null ? '' : `<span class="bar" style="background:linear-gradient(90deg, ${col} ${v}%, transparent ${v}%)">${v}</span>`;
  T.overview.set(d.map(r => ({ code: r.code, ecoregion: r.eco_name, survey_cells: r.survey_cells, with_data: r.with_data, field: r.field, pct_with_data: r.pct_with_data,
                                species: r.species, records: r.records, pct_expected: r.pct_expected })));
  const noData = cssVar('--map-nodata');
  Plotly.react(el('overview-plot'), [
    { type: 'bar', orientation: 'h', name: 'field-surveyed', y: d.map(r => r.code), x: d.map(r => r.field), marker: { color: ACCENT }, text: d.map(r => r.eco_name), textposition: 'none', hovertemplate: '%{text}: %{x} cells %{fullData.name}<extra></extra>' },
    { type: 'bar', orientation: 'h', name: 'internal data only', y: d.map(r => r.code), x: d.map(r => r.with_data - r.field), marker: { color: '#9ED1CE' }, text: d.map(r => r.eco_name), textposition: 'none', hovertemplate: '%{text}: %{x} cells %{fullData.name}<extra></extra>' },
    { type: 'bar', orientation: 'h', name: 'no data', y: d.map(r => r.code), x: d.map(r => r.survey_cells - r.with_data), marker: { color: noData }, text: d.map(r => r.eco_name), textposition: 'none', hovertemplate: '%{text}: %{x} cells %{fullData.name}<extra></extra>' }],
    { ...plotBase(), barmode: 'stack', xaxis: { ...axisBase(), title: { text: 'survey cells', standoff: 4 } }, yaxis: { ...axisBase(), title: '', automargin: true, tickfont: { size: 10, color: cssVar('--muted') }, categoryorder: 'array', categoryarray: d.map(r => r.code) },
      legend: { orientation: 'h', y: -0.32, x: 0, font: { size: 10 } }, margin: { l: 10, r: 10, t: 5, b: 30 } }, PLOT_CFG);
}

// ---- Selection & navigation -----------------------------------------------------------
function setTab(tab) {
  S.tab = tab;
  document.querySelectorAll('.tabs [role=tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  for (const t of ['cell', 'eco', 'overview', 'about']) el('panel-' + t).hidden = t !== tab;
  if (tab === 'eco') renderEco(); if (tab === 'overview') renderOverview(); if (tab === 'cell') renderCell();
}
function setSub(sub) {
  S.sub = sub;
  document.querySelectorAll('.subtabs [role=tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.sub === sub)));
  for (const t of ['species', 'sites', 'records', 'expected']) el('cell-tbl-' + t).hidden = t !== sub;
  renderCellSub();
}
function selectCell(id, fly = false) {
  S.selCell = id; S.selEco = X.cells[X.cellIdx.get(id)].code;
  restyleCells(); setTab('cell');
  if (fly) { const cell = X.cells[X.cellIdx.get(id)]; map.flyTo([cell.lat, cell.lon], 9); }
}
function selectEco(code, goTab = true) {
  S.selEco = code; if (S.focus) restyleCells();
  if (goTab) setTab('eco'); else renderEco();
}
function refreshAll() {   // after a filter change: everything recomputes from the record level
  recomputeMask(); computeCellMetrics(); restyleCells(); renderHeadline();
  if (S.tab === 'cell') renderCell(); else if (S.tab === 'eco') renderEco(); else if (S.tab === 'overview') renderOverview();
  if (S.species) syncSpeciesLayers();
  syncOverlays();
}

// ---- Sidebar wiring (ui.R) --------------------------------------------------------------
function buildSidebar() {
  el('eco-checks').innerHTML = ECO_LIST.map(e => `<label class="check"><input type="checkbox" data-eco="${e.code}" checked><span class="swatch" style="background:${e.vivid}"></span>${esc(e.name)}</label>`).join('');
  el('eco-checks').addEventListener('change', e => { const c = e.target.dataset.eco; if (e.target.checked) S.eco.add(c); else S.eco.delete(c); syncCellVisibility(); rangeFillOpacity(); });
  el('eco-all').addEventListener('click', () => { S.eco = new Set(ECO_LIST.map(e => e.code)); el('eco-checks').querySelectorAll('input').forEach(i => i.checked = true); syncCellVisibility(); rangeFillOpacity(); });
  el('eco-none').addEventListener('click', () => { S.eco = new Set(); el('eco-checks').querySelectorAll('input').forEach(i => i.checked = false); syncCellVisibility(); rangeFillOpacity(); });

  el('colour-mode').addEventListener('change', e => { S.mode = e.target.value; restyleCells(); });
  el('show-cells').addEventListener('change', e => { S.showCells = e.target.checked; syncCellVisibility(); rangeFillOpacity(); });
  el('show-nonsample').addEventListener('change', e => { S.showNon = e.target.checked; syncCellVisibility(); rangeFillOpacity(); });
  el('focus-eco').addEventListener('change', e => { S.focus = e.target.checked; restyleCells(); });

  el('src-checks').innerHTML = SOURCES.map((s, i) => `<label class="check"><input type="checkbox" data-src="${i}" checked>${esc(s.label)}</label>`).join('');
  el('src-checks').addEventListener('change', e => { const i = +e.target.dataset.src; if (e.target.checked) S.src.add(i); else S.src.delete(i); refreshAll(); });
  el('grp-checks').innerHTML = GROUPS.map((g, i) => `<label class="check"><input type="checkbox" data-grp="${i}" checked>${g}</label>`).join('');
  el('grp-checks').addEventListener('change', e => { const i = +e.target.dataset.grp; if (e.target.checked) S.grp.add(i); else S.grp.delete(i); refreshAll(); });

  el('basemap').addEventListener('change', e => { S.basemap = e.target.value; setBasemap(); });
  el('ov-eco').addEventListener('change', e => { S.ovEco = e.target.checked; syncOverlays(); });
  el('ov-pa').addEventListener('change', e => { S.ovPa = e.target.checked; syncOverlays(); });
  el('ov-wet').addEventListener('change', e => { S.ovWet = e.target.checked; syncOverlays(); });
  el('ov-sites').addEventListener('change', e => { S.ovSites = e.target.checked; syncOverlays(); });

  el('sp-dots').addEventListener('change', e => { S.spDots = e.target.checked; syncSpeciesLayers(); });
  el('sp-bg').addEventListener('change', e => { S.spBg = e.target.checked; syncSpeciesLayers(); });
  el('sp-telem').addEventListener('change', e => { S.spTelem = e.target.checked; syncSpeciesLayers(); });

  el('find-cell').addEventListener('input', e => { const id = e.target.value.trim().toUpperCase(); if (X.cellIdx.has(id)) selectCell(id, true); });
  el('menu-btn').addEventListener('click', () => { const sb = el('sidebar'); sb.hidden = !sb.hidden; el('menu-btn').setAttribute('aria-expanded', String(!sb.hidden)); });

  document.querySelectorAll('.tabs [role=tab]').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
  document.querySelectorAll('.subtabs [role=tab]').forEach(b => b.addEventListener('click', () => setSub(b.dataset.sub)));
  el('sat-type').addEventListener('change', e => { S.satType = e.target.value; if (S.selEco) renderEcoCurve(S.selEco); });
  el('sat-group').innerHTML = ['All', ...GROUPS].map(g => `<option>${g}</option>`).join('');
  el('sat-group').addEventListener('change', e => { S.satGroup = e.target.value; if (S.selEco) renderEcoCurve(S.selEco); });

  buildSpeciesCombo();
  el('download-links').innerHTML = 'In the deploy bundle: <code>download/tde_reference.gpkg</code>, <code>download/geojson/*.geojson</code>, <code>download/csv/*.csv</code>.';
}
// species finder: a small combobox over the species table (recorded or ranged)
function buildSpeciesCombo() {
  const input = el('find-species'), list = el('species-list'), clear = el('find-species-clear');
  const opts = D.species.filter(s => s.n_records > 0 || s.has_range).map(s => ({
    value: s.species, label: s.species + (s.common ? ` (${s.common})` : '') + (s.collared ? ' · collared' : ''),
    key: (s.species + ' ' + (s.common || '')).toLowerCase(), common: s.common, collared: s.collared }));
  let active = -1, shown = [];
  function show(q) {
    q = q.trim().toLowerCase();
    shown = (q ? opts.filter(o => o.key.includes(q)) : opts).slice(0, 50); active = -1;
    list.innerHTML = shown.map((o, i) => `<div data-i="${i}"><i>${esc(o.value)}</i>${o.common ? ` <span class="cn">(${esc(o.common)})</span>` : ''}${o.collared ? '<span class="tag">collared</span>' : ''}</div>`).join('') || '<div class="cn">no match</div>';
    list.hidden = false;
  }
  function choose(o) { input.value = o ? o.value : ''; list.hidden = true; clear.hidden = !o; setSpecies(o ? o.value : null); }
  input.addEventListener('input', () => show(input.value));
  input.addEventListener('focus', () => show(input.value));
  input.addEventListener('keydown', e => {
    if (list.hidden) return;
    if (e.key === 'ArrowDown') { active = Math.min(active + 1, shown.length - 1); } else if (e.key === 'ArrowUp') { active = Math.max(active - 1, 0); }
    else if (e.key === 'Enter') { if (active >= 0) choose(shown[active]); else if (shown.length === 1) choose(shown[0]); return; }
    else if (e.key === 'Escape') { list.hidden = true; return; } else return;
    e.preventDefault(); list.querySelectorAll('div').forEach((d, i) => d.classList.toggle('active', i === active));
  });
  list.addEventListener('mousedown', e => { const d = e.target.closest('[data-i]'); if (d) { e.preventDefault(); choose(shown[+d.dataset.i]); } });
  document.addEventListener('mousedown', e => { if (!e.target.closest('.combo')) list.hidden = true; });
  clear.addEventListener('click', () => choose(null));
  input.addEventListener('blur', () => { if (S.species && input.value !== S.species) input.value = S.species; if (!S.species) input.value = ''; });
}
function setSpecies(sp) {
  S.species = sp; const input = el('find-species'); input.value = sp || ''; el('find-species-clear').hidden = !sp;
  restyleCells(); syncSpeciesLayers();
}

// ---- Theme changes ------------------------------------------------------------------------
function onThemeChange() {
  setBasemap(); layers.eco.setStyle({ color: cssVar('--eco-line') }); restyleCells();
  if (S.tab === 'eco' && S.selEco) renderEco(); if (S.tab === 'overview') renderOverview();
}

// ---- Boot -----------------------------------------------------------------------------------
async function boot() {
  try { await loadAll(); } catch (e) { el('load-msg').textContent = `Could not load data (${e.message}). The data/ folder must sit next to this page.`; return; }
  buildIndexes(); recomputeMask(); computeCellMetrics();
  T.cellSpecies = Table(el('cell-tbl-species'), { pageLen: 12, cols: [{ k: 'species', l: 'species' }, { k: 'group', l: 'group' }, { k: 'common', l: 'common' }, { k: 'records', l: 'records', num: true }, { k: 'sources', l: 'sources' }, { k: 'expected', l: 'expected' }], onRow: r => setSpecies(r.species) });
  T.cellSites = Table(el('cell-tbl-sites'), { pageLen: 8, cols: [{ k: 'site', l: 'site' }, { k: 'source', l: 'source' }, { k: 'tier', l: 'tier' }, { k: 'species', l: 'species', num: true }, { k: 'records', l: 'records', num: true }, { k: 'visits', l: 'visits', num: true }, { k: 'last', l: 'last' }, { k: 'methods', l: 'methods' }, { k: 'lat', l: 'lat', num: true, render: v => v }, { k: 'lon', l: 'lon', num: true, render: v => v }] });
  T.cellRecords = Table(el('cell-tbl-records'), { pageLen: 10, cols: [{ k: 'source', l: 'source' }, { k: 'project', l: 'project' }, { k: 'season', l: 'season' }, { k: 'date', l: 'date' }, { k: 'method', l: 'method' }, { k: 'group', l: 'group' }, { k: 'species', l: 'species' }, { k: 'common_name', l: 'common name' }, { k: 'site', l: 'site' },
    { k: 'details', l: 'details', render: v => v && v.length > 60 ? `<span class="ellip" title="${esc(v)}">${esc(v)}</span>` : esc(v) }, { k: 'id', l: 'record id', mono: true }] });
  T.cellExpected = Table(el('cell-tbl-expected'), { pageLen: 12, cols: [{ k: 'species', l: 'species' }, { k: 'group', l: 'group' }, { k: 'iucn', l: 'iucn' }, { k: 'recorded', l: 'recorded' }], onRow: r => setSpecies(r.species) });
  T.ecoSpecies = Table(el('eco-tbl-species'), { pageLen: 12, cols: [{ k: 'species', l: 'species' }, { k: 'group', l: 'group' }, { k: 'common', l: 'common' }, { k: 'cells', l: 'cells', num: true }, { k: 'records', l: 'records', num: true }, { k: 'sources', l: 'sources' }, { k: 'expected', l: 'expected' }], onRow: r => setSpecies(r.species) });
  T.overview = Table(el('overview-tbl'), { pageLen: 12, cols: [{ k: 'code', l: 'code', render: (v, r) => `<span title="${esc(r.ecoregion)}">${v}</span>` }, { k: 'survey_cells', l: 'survey cells', num: true }, { k: 'with_data', l: 'with data', num: true }, { k: 'field', l: 'field', num: true },
    { k: 'pct_with_data', l: '% covered', num: true, render: v => `<span class="bar" style="background:linear-gradient(90deg, var(--accent-soft) ${v}%, transparent ${v}%)">${v}</span>` }, { k: 'species', l: 'species', num: true }, { k: 'records', l: 'records', num: true },
    { k: 'pct_expected', l: '% expected found', num: true, render: v => v == null ? '' : `<span class="bar" style="background:linear-gradient(90deg, var(--sand-soft) ${v}%, transparent ${v}%)">${v}</span>` }], onRow: r => selectEco(r.code) });
  buildSidebar(); buildMap(); restyleCells(); renderHeadline(); renderCell();
  const narrow = matchMedia('(max-width: 760px)');
  const setNarrow = m => { el('sidebar').hidden = m.matches; el('menu-btn').setAttribute('aria-expanded', String(!m.matches)); };
  setNarrow(narrow); narrow.addEventListener('change', setNarrow);     // phones open on the map; controls fold behind a button
  el('loading').hidden = true;
  map.invalidateSize();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', onThemeChange);
  new MutationObserver(onThemeChange).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  window.TDE = { S, D, X, metrics: () => M, map };   // for inspection from the console
}
document.addEventListener('DOMContentLoaded', boot);
})();

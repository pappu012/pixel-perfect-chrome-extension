'use strict';

const $ = id => document.getElementById(id);

let layers          = [];
let selectedId      = null;
let currentTab      = null;
const thumbnailCache = new Map(); // id → small data URL

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ── Thumbnail generator ───────────────────────────────────────────────────────

function createThumbnail(imageData) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const SIZE = 90;
      const c = document.createElement('canvas');
      c.width = c.height = SIZE;
      const ctx = c.getContext('2d');
      const min = Math.min(img.width, img.height);
      const sx  = (img.width  - min) / 2;
      const sy  = (img.height - min) / 2;
      ctx.drawImage(img, sx, sy, min, min, 0, 0, SIZE, SIZE);
      resolve(c.toDataURL('image/jpeg', 0.72));
    };
    img.onerror = () => resolve(null);
    img.src = imageData;
  });
}

// ── Messaging ─────────────────────────────────────────────────────────────────

async function send(msg) {
  if (!currentTab) return null;
  try {
    return await chrome.tabs.sendMessage(currentTab.id, msg);
  } catch {
    try {
      await chrome.scripting.executeScript({ target: { tabId: currentTab.id }, files: ['content.js'] });
      return await chrome.tabs.sendMessage(currentTab.id, msg);
    } catch {
      showError('Cannot overlay this page (Chrome system pages are restricted).');
      return null;
    }
  }
}

// ── Storage helpers ───────────────────────────────────────────────────────────

function metaOnly(arr) {
  return arr.map(({ id, name, visible, opacity, x, y, scale, locked, invert }) =>
    ({ id, name, visible, opacity, x, y, scale, locked, invert }));
}

async function saveMeta() {
  await chrome.storage.local.set({ pp_layers: metaOnly(layers), pp_selected: selectedId });
}

async function syncContent() {
  await send({ type: 'PP_SYNC_META', layers: metaOnly(layers), selectedId });
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderLayerList() {
  const grid = $('layer-grid');
  $('layers-title').textContent = `LAYERS (${layers.length})`;

  if (!layers.length) {
    grid.innerHTML = '<div class="grid-empty">No layers &mdash; click Upload to begin</div>';
    $('layer-controls').style.display = 'none';
    return;
  }

  grid.innerHTML = '';
  for (const layer of [...layers].reverse()) {
    const item = document.createElement('div');
    item.className   = 'thumb-item' + (layer.id === selectedId ? ' selected' : '');
    item.dataset.id   = layer.id;
    item.dataset.name = layer.name;

    const thumb = thumbnailCache.get(layer.id);
    item.innerHTML = `
      ${thumb ? `<img class="thumb-img" src="${thumb}" alt="">` : '<div class="thumb-blank"></div>'}
      <button class="thumb-del" data-action="del" title="Delete layer">&times;</button>
      ${!layer.visible ? '<div class="thumb-dim"></div>' : ''}`;
    item.addEventListener('click', handleItemClick);
    grid.appendChild(item);
  }

  const sel = layers.find(l => l.id === selectedId);
  $('layer-controls').style.display = sel ? 'block' : 'none';
  if (sel) fillControls(sel);
}

function fillControls(layer) {
  $('btn-show').classList.toggle('active', layer.visible);
  $('btn-lock').classList.toggle('active', layer.locked);
  $('btn-invert').classList.toggle('active', layer.invert);

  $('pos-x').value       = Math.round(layer.x);
  $('pos-y').value       = Math.round(layer.y);
  $('scale-input').value = layer.scale.toFixed(2);

  const pct = Math.round(layer.opacity * 100);
  $('opacity-slider').value       = pct;
  $('opacity-value').textContent  = pct + '%';
}

// ── Layer actions ─────────────────────────────────────────────────────────────

function handleItemClick(e) {
  const action = e.target.closest('[data-action]')?.dataset.action;
  const id     = e.currentTarget.dataset.id;
  if (action === 'del') { deleteLayer(id); return; }
  selectLayer(id);
}

function selectLayer(id) {
  selectedId = id;
  chrome.storage.local.set({ pp_selected: id });
  renderLayerList();
  syncContent();
}

function getSelected() { return layers.find(l => l.id === selectedId) || null; }

async function applyChange() {
  await saveMeta();
  await syncContent();
}

async function deleteLayer(id) {
  layers = layers.filter(l => l.id !== id);
  thumbnailCache.delete(id);
  if (selectedId === id) {
    selectedId = layers.length ? layers[layers.length - 1].id : null;
  }
  renderLayerList();
  await chrome.storage.local.remove([`pp_img_${id}`, `pp_thumb_${id}`]);
  await saveMeta();
  await send({ type: 'PP_REMOVE_LAYER', id });
}

// ── File handling ─────────────────────────────────────────────────────────────

async function processFile(file) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      const imageData = e.target.result;
      const id        = uid();
      const layer     = { id, name: file.name, visible: true, opacity: 0.5, x: 0, y: 0, scale: 1, locked: true, invert: false };

      layers.push(layer);
      selectedId = id;

      // Generate and cache thumbnail before rendering
      const thumb = await createThumbnail(imageData);
      if (thumb) {
        thumbnailCache.set(id, thumb);
        chrome.storage.local.set({ [`pp_thumb_${id}`]: thumb });
      }

      renderLayerList();

      await chrome.storage.local.set({ [`pp_img_${id}`]: imageData });
      await saveMeta();
      await send({ type: 'PP_SYNC_META', layers: metaOnly(layers), selectedId });
      await send({ type: 'PP_SET_IMAGE', id, data: imageData });
      resolve();
    };
    reader.readAsDataURL(file);
  });
}

// ── Upload / URL / Paste ──────────────────────────────────────────────────────

const fileInput = $('file-input');

$('btn-upload').addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', async (e) => {
  for (const file of Array.from(e.target.files)) {
    if (file.type.startsWith('image/')) await processFile(file);
  }
  fileInput.value = '';
});

// URL bar toggle
$('btn-url').addEventListener('click', () => {
  const bar = $('url-bar');
  bar.style.display = bar.style.display === 'none' ? 'flex' : 'none';
  if (bar.style.display === 'flex') $('url-input').focus();
});

$('btn-url-load').addEventListener('click', loadFromUrl);
$('url-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') loadFromUrl(); });

async function loadFromUrl() {
  const url = $('url-input').value.trim();
  if (!url) return;
  try {
    const res  = await fetch(url);
    const blob = await res.blob();
    if (!blob.type.startsWith('image/')) { showError('URL is not an image.'); return; }
    const filename = url.split('/').pop().split('?')[0] || 'image';
    await processFile(new File([blob], filename, { type: blob.type }));
    $('url-bar').style.display = 'none';
    $('url-input').value = '';
  } catch {
    showError('Failed to load image — check the URL or CORS policy.');
  }
}

// Paste from clipboard
$('btn-paste').addEventListener('click', async () => {
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      for (const type of item.types) {
        if (type.startsWith('image/')) {
          const blob = await item.getType(type);
          await processFile(new File([blob], 'pasted-image.png', { type }));
          return;
        }
      }
    }
    showError('No image in clipboard. Copy an image first.');
  } catch {
    showError('Clipboard access denied. Try copying an image then clicking Paste.');
  }
});

// ── Action buttons ────────────────────────────────────────────────────────────

$('btn-show').addEventListener('click', async () => {
  const layer = getSelected(); if (!layer) return;
  layer.visible = !layer.visible;
  renderLayerList();
  await applyChange();
});

$('btn-lock').addEventListener('click', async () => {
  const layer = getSelected(); if (!layer) return;
  layer.locked = !layer.locked;
  renderLayerList();
  await applyChange();
});

$('btn-invert').addEventListener('click', async () => {
  const layer = getSelected(); if (!layer) return;
  layer.invert = !layer.invert;
  renderLayerList();
  await applyChange();
});

// ── Position inputs ───────────────────────────────────────────────────────────

$('pos-x').addEventListener('change', async (e) => {
  const layer = getSelected(); if (!layer) return;
  layer.x = parseInt(e.target.value, 10) || 0;
  await applyChange();
});
$('pos-x').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });

$('pos-y').addEventListener('change', async (e) => {
  const layer = getSelected(); if (!layer) return;
  layer.y = parseInt(e.target.value, 10) || 0;
  await applyChange();
});
$('pos-y').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });

$('btn-reset-pos').addEventListener('click', async () => {
  const layer = getSelected(); if (!layer) return;
  layer.x = 0; layer.y = 0;
  $('pos-x').value = 0; $('pos-y').value = 0;
  await applyChange();
});

// ── Nav pad ───────────────────────────────────────────────────────────────────

document.querySelectorAll('.nav-btn[data-dir]').forEach(btn => {
  btn.addEventListener('click', async (e) => {
    const layer = getSelected(); if (!layer) return;
    const step = e.shiftKey ? 10 : 1;
    const dir  = btn.dataset.dir;
    if (dir === 'up')    layer.y -= step;
    if (dir === 'down')  layer.y += step;
    if (dir === 'left')  layer.x -= step;
    if (dir === 'right') layer.x += step;
    $('pos-x').value = Math.round(layer.x);
    $('pos-y').value = Math.round(layer.y);
    await applyChange();
  });
});

$('btn-nav-center').addEventListener('click', async () => {
  const layer = getSelected(); if (!layer) return;
  layer.x = 0; layer.y = 0;
  $('pos-x').value = 0; $('pos-y').value = 0;
  await applyChange();
});

// ── Scale input ───────────────────────────────────────────────────────────────

$('scale-input').addEventListener('change', async (e) => {
  const layer = getSelected(); if (!layer) return;
  const val   = Math.max(0.1, Math.min(5, parseFloat(e.target.value) || 1));
  layer.scale = val;
  e.target.value = val.toFixed(2);
  await applyChange();
});
$('scale-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });

// ── Opacity ───────────────────────────────────────────────────────────────────

$('opacity-slider').addEventListener('input', async (e) => {
  const layer = getSelected(); if (!layer) return;
  layer.opacity = parseInt(e.target.value, 10) / 100;
  $('opacity-value').textContent = e.target.value + '%';
  await applyChange();
});

// ── Error bar ─────────────────────────────────────────────────────────────────

function showError(msg, ms = 4000) {
  const bar = $('error-bar');
  bar.textContent = msg;
  bar.style.display = 'block';
  clearTimeout(showError._t);
  showError._t = setTimeout(() => { bar.style.display = 'none'; }, ms);
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab  = tab;

  const stored = await chrome.storage.local.get(['pp_layers', 'pp_selected']);
  layers     = stored.pp_layers   || [];
  selectedId = stored.pp_selected || (layers.length ? layers[layers.length - 1].id : null);

  // Load thumbnails into cache
  if (layers.length) {
    const keys   = layers.map(l => `pp_thumb_${l.id}`);
    const thumbs = await chrome.storage.local.get(keys);
    layers.forEach(l => {
      const t = thumbs[`pp_thumb_${l.id}`];
      if (t) thumbnailCache.set(l.id, t);
    });
  }

  renderLayerList();

  const res = await send({ type: 'PP_GET_STATE' });
  if (!res) return;

  await send({ type: 'PP_SYNC_META', layers: metaOnly(layers), selectedId });

  const hasImg  = new Set(res.layers.filter(l => l.hasImage).map(l => l.id));
  const missing = layers.map(l => l.id).filter(id => !hasImg.has(id));
  if (missing.length) {
    const imgs = await chrome.storage.local.get(missing.map(id => `pp_img_${id}`));
    for (const id of missing) {
      const data = imgs[`pp_img_${id}`];
      if (data) await send({ type: 'PP_SET_IMAGE', id, data });
    }
  }
}

init();

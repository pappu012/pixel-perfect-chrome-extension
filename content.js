(function () {
  'use strict';

  // Guard + remove any v1 overlay
  if (window.__pp2) return;
  window.__pp2 = true;
  const old = document.getElementById('__pp_root');
  if (old) old.remove();

  const domMap = new Map();   // id → { root, wrapper, img, handle }
  const imgCache = new Map(); // id → dataUrl
  let layers = [];
  let selectedId = null;
  let activeDrag = null;

  const GRIP = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 12 12" fill="white">
    <circle cx="2.5" cy="2.5" r="1.2"/><circle cx="6"   cy="2.5" r="1.2"/><circle cx="9.5" cy="2.5" r="1.2"/>
    <circle cx="2.5" cy="6"   r="1.2"/><circle cx="6"   cy="6"   r="1.2"/><circle cx="9.5" cy="6"   r="1.2"/>
    <circle cx="2.5" cy="9.5" r="1.2"/><circle cx="6"   cy="9.5" r="1.2"/><circle cx="9.5" cy="9.5" r="1.2"/>
  </svg>`;

  function css(el, props) {
    for (const [k, v] of Object.entries(props)) el.style.setProperty(k, String(v), 'important');
  }

  function createDom(id) {
    const root    = document.createElement('div');
    const wrapper = document.createElement('div');
    const img     = document.createElement('img');
    const handle  = document.createElement('div');
    handle.innerHTML = GRIP;

    wrapper.appendChild(img);
    wrapper.appendChild(handle);
    root.appendChild(wrapper);
    document.documentElement.appendChild(root);

    handle.addEventListener('mousedown', (e) => {
      const layer = layers.find(l => l.id === id);
      if (!layer || layer.locked) return;
      activeDrag = { id, mx: e.clientX, my: e.clientY, ox: layer.x, oy: layer.y };
      css(handle, { cursor: 'grabbing' });
      e.preventDefault();
      e.stopPropagation();
    }, true);

    const dom = { root, wrapper, img, handle };
    domMap.set(id, dom);
    return dom;
  }

  function applyLayer(layer) {
    const idx  = layers.findIndex(l => l.id === layer.id);
    const dom  = domMap.get(layer.id) || createDom(layer.id);
    const { root, wrapper, img, handle } = dom;

    const imgData = imgCache.get(layer.id);
    if (imgData && dom.loadedId !== layer.id) {
      img.src = imgData;
      dom.loadedId = layer.id;
    }

    const show = layer.id === selectedId && layer.visible && !!imgData;
    css(root, {
      position: 'fixed', top: '0', left: '0', width: '0', height: '0',
      'z-index': 2147483600 + idx,
      'pointer-events': 'none',
      display: show ? 'block' : 'none',
    });
    css(wrapper, {
      position: 'absolute',
      top: layer.y + 'px',
      left: layer.x + 'px',
      display: 'inline-block',
      'line-height': '0',
      'font-size': '0',
    });
    css(img, {
      display: 'block', position: 'relative',
      transform: `scale(${layer.scale})`,
      'transform-origin': 'top left',
      opacity: layer.opacity,
      filter: layer.invert ? 'invert(1)' : 'none',
      'pointer-events': 'none',
      'max-width': 'none', 'max-height': 'none',
      border: 'none', padding: '0', margin: '0', 'user-select': 'none',
    });
    css(handle, {
      display: 'flex', position: 'absolute', top: '0', left: '0',
      width: '22px', height: '22px',
      background: layer.locked ? 'rgba(100,116,139,0.9)' : 'rgba(99,102,241,0.9)',
      cursor: layer.locked ? 'not-allowed' : 'grab',
      'pointer-events': layer.locked ? 'none' : 'all',
      'border-radius': '0 0 6px 0', 'z-index': '1',
      'align-items': 'center', 'justify-content': 'center',
      'box-shadow': '0 2px 6px rgba(0,0,0,0.4)', 'user-select': 'none',
    });
  }

  function removeDom(id) {
    const dom = domMap.get(id);
    if (dom) { dom.root.remove(); domMap.delete(id); }
    imgCache.delete(id);
  }

  function syncAll(newLayers, newSelectedId) {
    const newIds = new Set(newLayers.map(l => l.id));
    for (const id of domMap.keys()) if (!newIds.has(id)) removeDom(id);
    layers = [...newLayers];
    selectedId = newSelectedId || null;
    layers.forEach(l => applyLayer(l));
  }

  // ── Global drag ────────────────────────────────────────────────────────────

  document.addEventListener('mousemove', (e) => {
    if (!activeDrag) return;
    const layer = layers.find(l => l.id === activeDrag.id);
    if (!layer) { activeDrag = null; return; }
    layer.x = activeDrag.ox + (e.clientX - activeDrag.mx);
    layer.y = activeDrag.oy + (e.clientY - activeDrag.my);
    applyLayer(layer);
  }, true);

  document.addEventListener('mouseup', () => {
    if (!activeDrag) return;
    activeDrag = null;
    chrome.storage.local.set({ pp_layers: layers });
    layers.forEach(l => applyLayer(l)); // reset cursors
  }, true);

  // ── Init from storage ──────────────────────────────────────────────────────

  chrome.storage.local.get(['pp_layers'], (result) => {
    const stored = result.pp_layers || [];
    if (!stored.length) return;
    const imgKeys = stored.map(l => `pp_img_${l.id}`);
    chrome.storage.local.get(imgKeys, (imgs) => {
      stored.forEach(l => { const d = imgs[`pp_img_${l.id}`]; if (d) imgCache.set(l.id, d); });
      chrome.storage.local.get(['pp_selected'], (sel) => {
        syncAll(stored, sel.pp_selected || null);
      });
    });
  });

  // ── Messages ───────────────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    switch (msg.type) {
      case 'PP_SYNC_META':
        syncAll(msg.layers, msg.selectedId);
        break;

      case 'PP_SET_IMAGE': {
        imgCache.set(msg.id, msg.data);
        const dom = domMap.get(msg.id);
        if (dom) { dom.img.src = msg.data; dom.loadedId = msg.id; }
        const layer = layers.find(l => l.id === msg.id);
        if (layer) applyLayer(layer);
        break;
      }

      case 'PP_REMOVE_LAYER':
        removeDom(msg.id);
        layers = layers.filter(l => l.id !== msg.id);
        break;

      case 'PP_GET_STATE':
        sendResponse({ layers: layers.map(l => ({ ...l, hasImage: imgCache.has(l.id) })) });
        return true;
    }
    sendResponse({ ok: true });
    return true;
  });
})();

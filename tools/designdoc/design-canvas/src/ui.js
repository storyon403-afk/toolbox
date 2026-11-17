/* Shared icon components: local SVG paths, no fonts or external assets. */
(() => {
  const paths = {
    layers: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16M5.5 8h1M5.5 12h1"/>',
    inspector: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M15 4v16M17.5 8h1M17.5 12h1"/>',
    chevronLeft: '<path d="m14 6-6 6 6 6"/>', chevronRight: '<path d="m10 6 6 6-6 6"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
    undo: '<path d="m8 4-5 5 5 5M3 9h11a6 6 0 0 1 0 12"/>', redo: '<path d="m16 4 5 5-5 5m5-5H10a6 6 0 0 0 0 12"/>',
    import: '<path d="M12 3v12m-4-4 4 4 4-4M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',
    export: '<path d="M12 15V3m-4 4 4-4 4 4M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',
    play: '<path d="m8 4 12 8-12 8Z"/>', cursor: '<path d="m5 3 14 10-7 1-3 7Z"/>',
    hand: '<path d="M8 12V6a2 2 0 0 1 4 0v5-8a2 2 0 0 1 4 0v8-5a2 2 0 0 1 4 0v9c0 4-3 7-7 7-3 0-5-1-7-4l-3-5a2 2 0 0 1 3-2l2 3"/>',
    rect: '<rect x="4" y="4" width="16" height="16" rx="2"/>', ellipse: '<circle cx="12" cy="12" r="8"/>',
    text: '<path d="M4 7V4h16v3M12 4v16M8 20h8"/>', image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m21 15-5-5L4 21"/>',
    plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>',
    fit: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/><rect x="8" y="8" width="8" height="8" rx="1"/>',
    focus: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/><circle cx="12" cy="12" r="3"/>',
    snap: '<path d="M8 3v18M16 3v18M3 8h18M3 16h18"/>',
    frame: '<path d="M6 3v18M18 3v18M3 6h18M3 18h18"/>',
    component: '<path d="m12 3 9 9-9 9-9-9Z"/>', group: '<rect x="3" y="3" width="18" height="18" rx="2" stroke-dasharray="3 3"/><rect x="7" y="7" width="10" height="10" rx="1"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>', more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 8a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4M12 16h.01"/>',
    code: '<path d="m7 6-6 6 6 6m10-12 6 6-6 6M14 3l-4 18"/>', prototype: '<circle cx="5" cy="5" r="2"/><rect x="15" y="15" width="6" height="6" rx="1"/><path d="M5 7v7a4 4 0 0 0 4 4h6m-4-4 4 4-4 4"/>',
    design: '<path d="m14 4 6 6M4 20l4-1L21 6a2.8 2.8 0 0 0-4-4L4 15Z"/>',
    copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
    trash: '<path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/>',
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
    eyeOff: '<path d="m3 3 18 18M10 5c7-1 12 7 12 7s-1 2-3 4M6 6c-2 2-4 6-4 6s4 7 10 7c2 0 4-1 5-2M10 10a3 3 0 0 0 4 4"/>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4M12 14v3"/>',
    unlock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0M12 14v3"/>',
    left: '<path d="M4 3v18M8 7h12v3H8zm0 7h8v3H8z"/>', center: '<path d="M12 3v18M4 7h16v3H4zm3 7h10v3H7z"/>', right: '<path d="M20 3v18M4 7h12v3H4zm4 7h8v3H8z"/>',
    top: '<path d="M3 4h18M7 8h3v12H7zm7 0h3v8h-3z"/>', middle: '<path d="M3 12h18M7 4h3v16H7zm7 3h3v10h-3z"/>', bottom: '<path d="M3 20h18M7 4h3v12H7zm7 4h3v8h-3z"/>',
    up: '<path d="M4 4h16M12 20V8m-5 5 5-5 5 5"/>', down: '<path d="M4 20h16M12 4v12m-5-5 5 5 5-5"/>'
  };
  function icon(name) {
    const span = document.createElement('span'); span.className = 'ui-icon'; span.setAttribute('aria-hidden', 'true');
    span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${paths[name] || paths.component}</svg>`;
    return span;
  }
  function mount(root = document) { root.querySelectorAll('[data-icon]').forEach(node => node.replaceChildren(icon(node.dataset.icon))); }
  globalThis.FormaUI = { icon, mount };
})();

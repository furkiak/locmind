// Minimal icon set (24x24 outline glyphs, stroke = currentColor).
const P = {
    mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 11v1a7 7 0 0 1-14 0v-1"/><path d="M12 19v3"/>',
    'mic-off': '<path d="M2 2l20 20"/><path d="M9 9v3a3 3 0 0 0 5.1 2.1"/><path d="M15 9.3V5a3 3 0 0 0-5.9-.7"/><path d="M19 11v1c0 .9-.2 1.7-.5 2.4"/><path d="M5 11v1a7 7 0 0 0 11 5.7"/><path d="M12 19v3"/>',
    video: '<rect x="2" y="6" width="14" height="12" rx="3"/><path d="M16 10.5l5.2-3.2a.6.6 0 0 1 .8.5v8.4a.6.6 0 0 1-.8.5L16 13.5"/>',
    'video-off': '<path d="M2 2l20 20"/><path d="M16 16v.5a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 2 16.5v-9A2.5 2.5 0 0 1 4.5 5H6"/><path d="M10 5h3.5A2.5 2.5 0 0 1 16 7.5V10l5.2-3.2a.6.6 0 0 1 .8.5v8.4"/>',
    chat: '<path d="M21 11.5a8.4 8.4 0 0 1-12.4 7.4L3 20.5l1.7-5A8.4 8.4 0 1 1 21 11.5z"/>',
    smile: '<circle cx="12" cy="12" r="9.5"/><path d="M8 14.2s1.5 2.3 4 2.3 4-2.3 4-2.3"/><path d="M9 9.5h.01M15 9.5h.01" stroke-width="2.6"/>',
    pen: '<path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4.5 1L4.5 14.5z"/><path d="M14 6l4 4"/>',
    note: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/>',
    music: '<path d="M9 18V6l11-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
    monitor: '<rect x="2.5" y="4" width="19" height="13" rx="2.5"/><path d="M8 21h8M12 17v4"/>',
    'monitor-off': '<rect x="2.5" y="4" width="19" height="13" rx="2.5"/><path d="M8 21h8M12 17v4M4 4l16 16"/>',
    sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
    users: '<path d="M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-6A3.5 3.5 0 0 0 3 18.5V20"/><circle cx="9.5" cy="8" r="3.5"/><path d="M21 20v-1.5a3.5 3.5 0 0 0-2.5-3.35M15.5 4.7a3.5 3.5 0 0 1 0 6.6"/>',
    x: '<path d="M18 6L6 18M6 6l12 12"/>',
    send: '<path d="M21.5 2.5L10.5 13.5"/><path d="M21.5 2.5l-7 19-4-8.5-8.5-4z"/>',
    download: '<path d="M12 3v12"/><path d="M7 11l5 5 5-5"/><path d="M4 20h16"/>',
    trash: '<path d="M4 7h16"/><path d="M9 7V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V7"/><path d="M6 7l1 13a1.5 1.5 0 0 0 1.5 1.4h7A1.5 1.5 0 0 0 17 20l1-13"/><path d="M10 11v6M14 11v6"/>',
    lock: '<rect x="4" y="10.5" width="16" height="10.5" rx="3"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
    skip: '<path d="M5 5l10 7-10 7z" fill="currentColor"/><path d="M19 5v14"/>',
    volume: '<path d="M11 5L6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20.5 20.5L16 16"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    home: '<path d="M3.5 10.5L12 3.5l8.5 7"/><path d="M5.5 9.5V20a1 1 0 0 0 1 1H10v-6h4v6h3.5a1 1 0 0 0 1-1V9.5"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5" stroke-width="3"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14.5-4.2L4 8.5"/><path d="M4 4v4.5h4.5"/><path d="M4 13a8 8 0 0 0 14.5 4.2L20 15.5"/><path d="M20 20v-4.5h-4.5"/>',
    eraser: '<path d="M20 20H9.5L4.3 14.8a2 2 0 0 1 0-2.8l8-8a2 2 0 0 1 2.8 0l5.4 5.4a2 2 0 0 1 0 2.8L13 19"/><path d="M7.5 9.5l7 7"/>',
    ball: '<circle cx="12" cy="12" r="9.5"/><path d="M12 7.2l3.8 2.8-1.4 4.4H9.6L8.2 10z"/><path d="M12 7.2V2.8M15.8 10l4.4-1.4M14.4 14.4l2.6 3.8M9.6 14.4l-2.6 3.8M8.2 10L3.8 8.6"/>',
    moon: '<path d="M20.5 13.5A8.5 8.5 0 1 1 10.5 3.5a6.7 6.7 0 0 0 10 10z"/>',
    'wifi-off': '<path d="M2 2l20 20"/><path d="M8.5 16.4a5 5 0 0 1 7 0"/><path d="M5 12.9a10 10 0 0 1 3.3-2.1M19 12.9a10 10 0 0 0-4.5-2.6"/><path d="M2 8.8a15 15 0 0 1 4.3-2.6M22 8.8A15 15 0 0 0 11 5"/><path d="M12 20h.01" stroke-width="3"/>',
    pin: '<path d="M12 21s7-5.6 7-11.2a7 7 0 1 0-14 0C5 15.4 12 21 12 21z"/><circle cx="12" cy="10" r="2.5"/>',
    chevron: '<path d="M9 5l7 7-7 7"/>',
    globe: '<circle cx="12" cy="12" r="9.5"/><path d="M2.5 12h19"/><path d="M12 2.5a14 14 0 0 1 0 19 14 14 0 0 1 0-19z"/>',
    alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01" stroke-width="2.6"/>',
    info: '<circle cx="12" cy="12" r="9.5"/><path d="M12 11v6M12 7.5h.01" stroke-width="2.6"/>',
    star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
    clock: '<circle cx="12" cy="12" r="9.5"/><path d="M12 7v5l3.5 2"/>',
    grid: '<rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="8" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/><rect x="13" y="13" width="8" height="8" rx="2"/>',
    upload: '<path d="M12 16V4"/><path d="M7 8.5l5-5 5 5"/><path d="M4 20h16"/>',
    hand: '<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11"/><path d="M11 10.5V4a1.5 1.5 0 0 1 3 0v6.5"/><path d="M14 10.5V5.5a1.5 1.5 0 0 1 3 0V14"/><path d="M8 13l-1.6-2a1.6 1.6 0 0 0-2.5 2l3.4 4.6A7 7 0 0 0 13 21h.5a5 5 0 0 0 5-5V8.5a1.5 1.5 0 0 1 3 0"/>',
    walk: '<circle cx="13" cy="4.5" r="2"/><path d="M9 21l2.5-6.5L14 17v4"/><path d="M7 11.5l3-3.5 4 1.5 2 3 2.5 1"/><path d="M11.5 14.5L10 8"/>',
    poll: '<path d="M5 20V11"/><path d="M12 20V4"/><path d="M19 20v-6"/>',
    slash: '<circle cx="12" cy="12" r="9.5"/><path d="M5.3 5.3l13.4 13.4"/>',
    crown: '<path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z"/>',
    megaphone: '<path d="M3 10.5v3a1 1 0 0 0 1 1h3l9 5V4.5l-9 5H4a1 1 0 0 0-1 1z"/><path d="M7 14.5l1.5 5h2.5l-1-5"/><path d="M19.5 9.5a3 3 0 0 1 0 5"/>',
    follow: '<path d="M4 12h12"/><path d="M12 6l6 6-6 6"/><path d="M20 5v14"/>'
};

export function icon(name, cls = '') {
    return `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[name] || ''}</svg>`;
}

/** Replaces every <i data-icon="x"></i> below `root` with the inline SVG. */
export function hydrateIcons(root = document) {
    root.querySelectorAll('i[data-icon]').forEach(el => {
        if (el.firstChild) return;
        el.innerHTML = icon(el.dataset.icon);
    });
}

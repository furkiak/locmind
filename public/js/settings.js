import { S, bus, setSetting } from './state.js';
import { t, setLang, getLang } from './i18n.js';
import { byId, $$, clear, setRangeFill } from './dom.js';
import { openModal } from './ui.js';
import { setMasterVolume, listMics, startMic } from './audio.js';

export function applyTheme() {
    let theme = S.settings.theme || 'auto';
    if (theme === 'auto') theme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    document.documentElement.dataset.theme = theme;
    document.documentElement.classList.toggle('reduce-motion', !!S.settings.reduceMotion);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme === 'light' ? '#eef2fa' : '#070a14';
    bus.emit('theme');
}

function applyMinimap() { byId('minimap-wrap').classList.toggle('is-off', !S.settings.minimap); }

async function fillMics() {
    const sel = byId('set-mic');
    const mics = await listMics();
    clear(sel);
    sel.appendChild(new Option(t('default_mic'), ''));
    mics.forEach((m, i) => sel.appendChild(new Option(m.label || `${t('microphone')} ${i + 1}`, m.deviceId)));
    sel.value = S.settings.micId || '';
}

export function initSettings() {
    applyTheme();
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { if (S.settings.theme === 'auto') applyTheme(); });
    applyMinimap();

    byId('btn-settings').addEventListener('click', openSettings);
    $$('#set-lang button').forEach(b => b.addEventListener('click', () => setLang(b.dataset.lang)));
    $$('#set-theme button').forEach(b => b.addEventListener('click', () => { setSetting('theme', b.dataset.themeVal); applyTheme(); syncControls(); }));

    const vol = byId('set-volume');
    vol.addEventListener('input', () => { setSetting('volume', +vol.value); setRangeFill(vol); setMasterVolume(+vol.value); });
    for (const [id, key, after] of [['set-sfx', 'sfx'], ['set-spatial', 'spatial'], ['set-minimap', 'minimap', applyMinimap], ['set-motion', 'reduceMotion', applyTheme]]) {
        byId(id).addEventListener('change', e => { setSetting(key, e.target.checked); if (after) after(); });
    }
    byId('set-mic').addEventListener('change', async e => { setSetting('micId', e.target.value); await startMic(); });
    bus.on('lang', syncControls);
}

function syncControls() {
    $$('#set-lang button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.lang === getLang())));
    $$('#set-theme button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.themeVal === (S.settings.theme || 'auto'))));
    const vol = byId('set-volume'); vol.value = S.settings.volume; setRangeFill(vol);
    byId('set-sfx').checked = !!S.settings.sfx;
    byId('set-spatial').checked = !!S.settings.spatial;
    byId('set-minimap').checked = !!S.settings.minimap;
    byId('set-motion').checked = !!S.settings.reduceMotion;
}

export async function openSettings() {
    syncControls();
    await fillMics();
    openModal('modal-settings');
}

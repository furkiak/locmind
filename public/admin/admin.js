// Locmind admin panel. Talks to /api/admin/* with the admin token as a bearer token.

import { h, clear } from '/js/dom.js';
import { hydrateIcons } from '/js/icons.js';
import { LineChart, sparkline } from '/admin/chart.js';

const W = window.LocWorld;
const $ = id => document.getElementById(id);

// ------------------------------------------------------------------ i18n

const STRINGS = {
    en: {
        title: 'Locmind Admin', loginHint: 'Paste the admin token printed in the server log or stored in data/secrets.json.',
        token: 'Admin token', remember: 'Keep me signed in on this device', signIn: 'Sign in', backToWorld: 'Back to the world',
        overview: 'Overview', players: 'Players', rooms: 'Rooms', music: 'Music', bans: 'Bans', settings: 'Settings',
        live: 'Live', offline: 'Offline', signOut: 'Sign out', playersOnline: 'Players online', announce: 'Announcement',
        announcePlaceholder: 'Send an announcement to everyone', send: 'Send',
        chartPlayers: 'Players online', chartNetwork: 'Realtime traffic (KB/s)', chartCpu: 'CPU (% of one core)',
        chartMemory: 'Memory (RSS, MB)', chartLoop: 'Event loop delay p99 (ms)', chartTurn: 'Voice relay (TURN, KB/s)',
        system: 'System', relay: 'Voice relay', dataTable: 'Data table (last 5 minutes)',
        filterPlayers: 'Filter by name, room or IP', roomsHint: 'Permanent rooms survive restarts and stay open when empty.',
        newPermanent: 'New permanent room', slot: 'Plot', name: 'Name', topic: 'Topic', password: 'Password', optional: 'Optional',
        color: 'Colour', create: 'Create', musicHint: 'Drop audio files into media/music on the server, or let players upload them.',
        uploadQuota: 'Upload storage', bansHint: 'Bans apply to the IP address. Ban someone from the Players list.',
        settingsHint: 'Changes apply immediately and are saved in the data folder.', motd: 'Message of the day',
        motdHint: 'Shown on the sign-in screen.', serverPassword: 'Server password', serverPasswordHint: 'Leave empty for an open server.',
        envPassword: 'SERVER_PASSWORD is set in the environment and takes precedence.',
        uploads: 'Player uploads', uploadsHint: 'Allow players to add their own audio files to the music library.',
        wordFilter: 'Word filter', wordFilterPlaceholder: 'One word per line or comma separated', wordFilterHint: 'Matching words are masked in chat.',
        save: 'Save', cancel: 'Cancel', saved: 'Settings saved', sent: 'Announcement sent',
        badToken: 'That token is not valid.', locked: 'Too many attempts. Try again in a few minutes.', network: 'Server unreachable.',
        uptime: 'Up {t}', peak: 'Peak {n} in the last {m} min',
        tRooms: 'Rooms', tCpu: 'CPU', tMemory: 'Memory', tLoop: 'Event loop p99', tTraffic: 'Traffic out', tRelay: 'Relay sessions',
        healthy: 'Healthy', busy: 'Busy', overloaded: 'Overloaded', ofCore: 'of one core', heap: 'heap {v}', inbound: '{v} in',
        relayOff: 'TURN is turned off', node: 'Node.js', platform: 'Platform', cores: 'CPU cores', load: 'Load average',
        httpReq: 'HTTP requests', wsConn: 'WebSocket connections', wsRejected: 'Rejected upgrades', messages: 'Messages in / out',
        relayPort: 'Port', relayTls: 'TLS port', relayIp: 'Relay address', relayPorts: 'Relay ports', allocations: 'Active sessions',
        relayed: 'Data relayed', dropped: 'Packets dropped', authFail: 'Auth failures', off: 'off',
        time: 'Time', player: 'Player', room: 'Room', ip: 'IP', connected: 'Connected', idle: 'Idle', media: 'Media', backlog: 'Backlog',
        noPlayers: 'Nobody is online right now.', noMatch: 'No player matches the filter.', world: 'World',
        mute: 'Mute', unmute: 'Unmute', kick: 'Kick', ban: 'Ban', mutedUntil: 'muted', mic: 'mic', cam: 'cam', screen: 'screen',
        kickTitle: 'Kick {n}?', kickText: 'They can join again right away.', kickMsg: 'Message (optional)',
        banTitle: 'Ban {n}?', banText: 'Everyone connected from {ip} is removed and blocked.', duration: 'Duration', reason: 'Reason (optional)',
        muteTitle: 'Mute {n} in chat?', muteText: 'They can still talk and listen.',
        m15: '15 minutes', h1: '1 hour', d1: '1 day', d7: '7 days', forever: 'Permanent', m5: '5 minutes',
        kicked: '{n} was kicked', banned: '{n} was banned', muted: '{n} was muted', unmuted: '{n} can chat again',
        type: 'Type', owner: 'Owner', people: 'People', lock: 'Locked', builtin: 'Built-in', permanent: 'Permanent', playerRoom: 'Player',
        close: 'Close', closeTitle: 'Close {n}?', closeText: 'Everyone inside is moved out. Whiteboard and notes are discarded.',
        closed: 'Room closed', created: 'Room created', replaces: 'replaces {n}', free: 'free', noRooms: 'No rooms yet.',
        track: 'Title', artist: 'Artist', source: 'Source', size: 'Size', by: 'Added by', server: 'Server', upload: 'Upload',
        noTracks: 'The library is empty. Copy audio files into media/music.', remove: 'Delete', removeTitle: 'Delete {n}?',
        removeText: 'The file is removed from the disk.', removed: 'Track deleted', quota: '{used} of {total} used',
        since: 'Since', until: 'Until', unban: 'Unban', noBans: 'No active bans.', unbanned: 'Ban lifted',
        'error.invalid-slot': 'Pick a plot.', 'error.invalid-name': 'Give the room a name.', 'error.not-found': 'Not found.',
        'error.rate-limit': 'Slow down a little.', failed: 'Something went wrong.', ago: '{t} ago', now: 'now', preview: 'Play'
    },
    tr: {
        title: 'Locmind Yönetim', loginHint: 'Sunucu günlüğünde yazan ya da data/secrets.json içinde saklanan yönetici anahtarını yapıştırın.',
        token: 'Yönetici anahtarı', remember: 'Bu cihazda oturumum açık kalsın', signIn: 'Giriş yap', backToWorld: 'Dünyaya dön',
        overview: 'Genel bakış', players: 'Oyuncular', rooms: 'Odalar', music: 'Müzik', bans: 'Yasaklar', settings: 'Ayarlar',
        live: 'Canlı', offline: 'Bağlantı yok', signOut: 'Çıkış', playersOnline: 'Çevrim içi oyuncu', announce: 'Duyuru',
        announcePlaceholder: 'Herkese bir duyuru gönder', send: 'Gönder',
        chartPlayers: 'Çevrim içi oyuncu', chartNetwork: 'Gerçek zamanlı trafik (KB/sn)', chartCpu: 'İşlemci (tek çekirdeğin %’si)',
        chartMemory: 'Bellek (RSS, MB)', chartLoop: 'Olay döngüsü gecikmesi p99 (ms)', chartTurn: 'Ses aktarımı (TURN, KB/sn)',
        system: 'Sistem', relay: 'Ses aktarımı', dataTable: 'Veri tablosu (son 5 dakika)',
        filterPlayers: 'İsim, oda ya da IP ile süz', roomsHint: 'Kalıcı odalar yeniden başlatmalardan sonra da durur, boşken kapanmaz.',
        newPermanent: 'Yeni kalıcı oda', slot: 'Arsa', name: 'Ad', topic: 'Konu', password: 'Şifre', optional: 'İsteğe bağlı',
        color: 'Renk', create: 'Oluştur', musicHint: 'Ses dosyalarını sunucudaki media/music klasörüne bırakın ya da oyuncuların yüklemesine izin verin.',
        uploadQuota: 'Yükleme alanı', bansHint: 'Yasaklar IP adresine uygulanır. Oyuncular listesinden yasaklayabilirsiniz.',
        settingsHint: 'Değişiklikler hemen uygulanır ve data klasörüne kaydedilir.', motd: 'Günün mesajı',
        motdHint: 'Giriş ekranında gösterilir.', serverPassword: 'Sunucu şifresi', serverPasswordHint: 'Herkese açık sunucu için boş bırakın.',
        envPassword: 'Ortamda SERVER_PASSWORD tanımlı ve önceliklidir.',
        uploads: 'Oyuncu yüklemeleri', uploadsHint: 'Oyuncuların müzik kitaplığına kendi ses dosyalarını eklemesine izin ver.',
        wordFilter: 'Kelime filtresi', wordFilterPlaceholder: 'Her satıra bir kelime ya da virgülle ayırın', wordFilterHint: 'Eşleşen kelimeler sohbette gizlenir.',
        save: 'Kaydet', cancel: 'Vazgeç', saved: 'Ayarlar kaydedildi', sent: 'Duyuru gönderildi',
        badToken: 'Bu anahtar geçersiz.', locked: 'Çok fazla deneme. Birkaç dakika sonra tekrar deneyin.', network: 'Sunucuya ulaşılamıyor.',
        uptime: '{t} süredir açık', peak: 'Son {m} dakikada en çok {n}',
        tRooms: 'Odalar', tCpu: 'İşlemci', tMemory: 'Bellek', tLoop: 'Olay döngüsü p99', tTraffic: 'Giden trafik', tRelay: 'Aktarım oturumu',
        healthy: 'Sağlıklı', busy: 'Yoğun', overloaded: 'Aşırı yük', ofCore: 'tek çekirdek', heap: 'heap {v}', inbound: '{v} gelen',
        relayOff: 'TURN kapalı', node: 'Node.js', platform: 'Platform', cores: 'İşlemci çekirdeği', load: 'Sistem yükü',
        httpReq: 'HTTP istekleri', wsConn: 'WebSocket bağlantıları', wsRejected: 'Reddedilen bağlantılar', messages: 'Mesaj gelen / giden',
        relayPort: 'Port', relayTls: 'TLS portu', relayIp: 'Aktarım adresi', relayPorts: 'Aktarım portları', allocations: 'Etkin oturum',
        relayed: 'Aktarılan veri', dropped: 'Düşen paket', authFail: 'Kimlik hatası', off: 'kapalı',
        time: 'Saat', player: 'Oyuncu', room: 'Oda', ip: 'IP', connected: 'Bağlı', idle: 'Boşta', media: 'Medya', backlog: 'Kuyruk',
        noPlayers: 'Şu anda kimse çevrim içi değil.', noMatch: 'Süzgece uyan oyuncu yok.', world: 'Dünya',
        mute: 'Sustur', unmute: 'Susturmayı kaldır', kick: 'At', ban: 'Yasakla', mutedUntil: 'susturuldu', mic: 'mikrofon', cam: 'kamera', screen: 'ekran',
        kickTitle: '{n} atılsın mı?', kickText: 'Hemen tekrar katılabilir.', kickMsg: 'Mesaj (isteğe bağlı)',
        banTitle: '{n} yasaklansın mı?', banText: '{ip} adresinden bağlanan herkes çıkarılır ve engellenir.', duration: 'Süre', reason: 'Sebep (isteğe bağlı)',
        muteTitle: '{n} sohbette susturulsun mu?', muteText: 'Konuşmaya ve dinlemeye devam edebilir.',
        m15: '15 dakika', h1: '1 saat', d1: '1 gün', d7: '7 gün', forever: 'Kalıcı', m5: '5 dakika',
        kicked: '{n} atıldı', banned: '{n} yasaklandı', muted: '{n} susturuldu', unmuted: '{n} tekrar yazabilir',
        type: 'Tür', owner: 'Sahip', people: 'Kişi', lock: 'Kilitli', builtin: 'Yerleşik', permanent: 'Kalıcı', playerRoom: 'Oyuncu',
        close: 'Kapat', closeTitle: '{n} kapatılsın mı?', closeText: 'İçerideki herkes dışarı alınır. Beyaz tahta ve notlar silinir.',
        closed: 'Oda kapatıldı', created: 'Oda oluşturuldu', replaces: '{n} yerine', free: 'boş', noRooms: 'Henüz oda yok.',
        track: 'Parça', artist: 'Sanatçı', source: 'Kaynak', size: 'Boyut', by: 'Ekleyen', server: 'Sunucu', upload: 'Yükleme',
        noTracks: 'Kitaplık boş. Ses dosyalarını media/music klasörüne kopyalayın.', remove: 'Sil', removeTitle: '{n} silinsin mi?',
        removeText: 'Dosya diskten silinir.', removed: 'Parça silindi', quota: '{total} alanın {used} kadarı dolu',
        since: 'Başlangıç', until: 'Bitiş', unban: 'Yasağı kaldır', noBans: 'Etkin yasak yok.', unbanned: 'Yasak kaldırıldı',
        'error.invalid-slot': 'Bir arsa seçin.', 'error.invalid-name': 'Odaya bir ad verin.', 'error.not-found': 'Bulunamadı.',
        'error.rate-limit': 'Biraz yavaşlayın.', failed: 'Bir şeyler ters gitti.', ago: '{t} önce', now: 'şimdi', preview: 'Çal'
    }
};
const lang = (new URLSearchParams(location.search).get('lang') || (navigator.language || 'en')).slice(0, 2).toLowerCase() === 'tr' ? 'tr' : 'en';
document.documentElement.lang = lang;
const t = (key, vars = {}) => String((STRINGS[lang][key] ?? STRINGS.en[key] ?? key)).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
function translate() {
    document.querySelectorAll('[data-t]').forEach(el => { el.textContent = t(el.dataset.t); });
    document.querySelectorAll('[data-tp]').forEach(el => { el.placeholder = t(el.dataset.tp); });
    document.title = t('title');
}

// ------------------------------------------------------------------ formatting

const nf = new Intl.NumberFormat(lang, { maximumFractionDigits: 1 });
const fmtBytes = b => {
    if (b >= 1 << 30) return `${nf.format(b / (1 << 30))} GB`;
    if (b >= 1 << 20) return `${nf.format(b / (1 << 20))} MB`;
    if (b >= 1 << 10) return `${nf.format(b / (1 << 10))} KB`;
    return `${b} B`;
};
const fmtKBs = v => v >= 1024 ? `${nf.format(v / 1024)} MB/s` : `${nf.format(v)} KB/s`;
const fmtCount = v => Intl.NumberFormat(lang, { notation: v >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(v);
function fmtDuration(sec) {
    sec = Math.max(0, Math.round(sec));
    const d = Math.floor(sec / 86400), hh = Math.floor(sec % 86400 / 3600), mm = Math.floor(sec % 3600 / 60);
    if (d) return `${d}d ${hh}h`;
    if (hh) return `${hh}h ${mm}m`;
    if (mm) return `${mm}m`;
    return `${sec}s`;
}
const since = ts => (Date.now() - ts < 5000 ? t('now') : t('ago', { t: fmtDuration((Date.now() - ts) / 1000) }));
const dateTime = ts => new Date(ts).toLocaleString(lang, { dateStyle: 'medium', timeStyle: 'short' });

// ------------------------------------------------------------------ auth + api

const TOKEN_KEY = 'locmind.admin';
let token = sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY) || '';

class ApiError extends Error {
    constructor(status, code) { super(code); this.status = status; this.code = code; }
}

async function api(method, url, body) {
    let res;
    try {
        res = await fetch(url, {
            method,
            headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
            body: body ? JSON.stringify(body) : undefined,
            cache: 'no-store'
        });
    } catch (_) {
        setLive(false);
        throw new ApiError(0, 'network');
    }
    setLive(true);
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && url !== '/api/admin/login') { signOut(); throw new ApiError(401, 'unauthorized'); }
    if (!res.ok) throw new ApiError(res.status, data.error || 'failed');
    return data;
}

function setLive(ok) {
    const el = document.querySelector('.live');
    if (!el) return;
    el.classList.toggle('is-off', !ok);
    $('liveText').textContent = t(ok ? 'live' : 'offline');
}

function toast(text, kind = '') {
    const el = h('div', { class: `toast ${kind}`, role: kind === 'error' ? 'alert' : 'status' }, text);
    $('toasts').append(el);
    setTimeout(() => el.remove(), 3800);
}
const fail = err => toast(err.code === 'network' ? t('network') : t(`error.${err.code}`) !== `error.${err.code}` ? t(`error.${err.code}`) : t('failed'), 'error');

function showLogin(message = '') {
    stopPolling();
    $('app').hidden = true;
    $('login').hidden = false;
    $('loginError').hidden = !message;
    $('loginError').textContent = message;
    $('tokenInput').focus();
}

function signOut() {
    token = '';
    sessionStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_KEY);
    showLogin();
}

$('loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    token = $('tokenInput').value.trim();
    try {
        await api('POST', '/api/admin/login');
        (($('rememberInput').checked) ? localStorage : sessionStorage).setItem(TOKEN_KEY, token);
        $('tokenInput').value = '';
        start();
    } catch (err) {
        showLogin(err.status === 429 ? t('locked') : err.code === 'network' ? t('network') : t('badToken'));
    }
});
$('logoutBtn').addEventListener('click', signOut);

$('themeBtn').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    try {
        const s = JSON.parse(localStorage.getItem('locmind.settings') || '{}');
        s.theme = next;
        localStorage.setItem('locmind.settings', JSON.stringify(s));
    } catch (_) { /* storage unavailable */ }
    for (const c of Object.values(charts)) c.render();
});

// ------------------------------------------------------------------ views

const VIEWS = ['overview', 'players', 'rooms', 'music', 'bans', 'settings'];
let view = 'overview';
const loaders = {};

function go(name) {
    if (!VIEWS.includes(name)) name = 'overview';
    view = name;
    for (const v of VIEWS) $(`view-${v}`).hidden = v !== name;
    document.querySelectorAll('.nav button').forEach(b => b.classList.toggle('is-active', b.dataset.view === name));
    if (location.hash.slice(1) !== name) history.replaceState(null, '', `#${name}`);
    refresh();
}
document.querySelectorAll('.nav button').forEach(b => b.addEventListener('click', () => go(b.dataset.view)));
window.addEventListener('hashchange', () => go(location.hash.slice(1)));

let pollTimer = null;
function refresh() {
    clearTimeout(pollTimer);
    const work = [loaders.overview(), view !== 'overview' && loaders[view] ? loaders[view]() : null];
    Promise.allSettled(work).finally(() => {
        if (!$('app').hidden) pollTimer = setTimeout(refresh, view === 'overview' ? 5000 : view === 'players' ? 3000 : 10000);
    });
}
function stopPolling() { clearTimeout(pollTimer); pollTimer = null; }
document.addEventListener('visibilitychange', () => { if (!document.hidden && !$('app').hidden) refresh(); });

// ------------------------------------------------------------------ sheet (confirm dialogs)

function sheet({ title, text, fields = [], ok, danger = true }) {
    const dlg = $('sheet');
    $('sheetTitle').textContent = title;
    $('sheetText').textContent = text || '';
    const body = clear($('sheetBody'));
    const inputs = {};
    for (const f of fields) {
        let input;
        if (f.options) {
            input = h('select', { class: 'input' }, f.options.map(([value, label]) => h('option', { value }, label)));
            if (f.value !== undefined) input.value = f.value;
        } else input = h('input', { class: 'input', maxlength: f.max || 160, placeholder: f.placeholder || '' });
        inputs[f.name] = input;
        body.append(h('label', { class: 'field' }, h('span', {}, f.label), input));
    }
    const okBtn = $('sheetOk');
    okBtn.textContent = ok;
    okBtn.className = `btn ${danger ? 'btn-danger' : 'btn-primary'}`;
    return new Promise(resolve => {
        dlg.addEventListener('close', () => {
            resolve(dlg.returnValue === 'ok' ? Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, el.value])) : null);
        }, { once: true });
        dlg.returnValue = '';
        dlg.showModal();
    });
}

// ------------------------------------------------------------------ overview

const charts = {};
let lastOverview = null;

function setupCharts() {
    const c1 = 'var(--series-1)', c2 = 'var(--series-2)';
    charts.players = new LineChart($('chartPlayers'), { series: [{ key: 'players', label: t('players'), color: c1 }], format: v => nf.format(v), minTop: 4, describe: t('chartPlayers') });
    charts.network = new LineChart($('chartNetwork'), {
        series: [{ key: 'outKBs', label: lang === 'tr' ? 'Giden' : 'Out', color: c1 }, { key: 'inKBs', label: lang === 'tr' ? 'Gelen' : 'In', color: c2 }],
        format: fmtKBs, minTop: 4, describe: t('chartNetwork')
    });
    charts.cpu = new LineChart($('chartCpu'), { series: [{ key: 'cpu', label: 'CPU', color: c1 }], format: v => `${nf.format(v)}%`, minTop: 10, describe: t('chartCpu') });
    charts.memory = new LineChart($('chartMemory'), { series: [{ key: 'rssMB', label: 'RSS', color: c1 }], format: v => `${nf.format(v)} MB`, minTop: 64, describe: t('chartMemory') });
    charts.loop = new LineChart($('chartLoop'), { series: [{ key: 'loopP99', label: 'p99', color: c1 }], format: v => `${nf.format(v)} ms`, minTop: 20, describe: t('chartLoop') });
    charts.turn = new LineChart($('chartTurn'), { series: [{ key: 'turnKBs', label: 'TURN', color: c1 }], format: fmtKBs, minTop: 4, describe: t('chartTurn') });
}

function loopStatus(ms) {
    if (ms < 30) return ['good', t('healthy')];
    if (ms < 120) return ['warning', t('busy')];
    return ['critical', t('overloaded')];
}

function tile(label, value, sub, values, status) {
    const spark = h('div', { class: 'spark-host' });
    sparkline(spark, values);
    return h('div', { class: 'glass tile' },
        h('span', { class: 'label' }, label),
        h('span', { class: 'value' }, value),
        status ? h('span', { class: `status ${status[0]}` }, status[1]) : h('span', { class: 'sub' }, sub),
        spark);
}

function kv(list, rows) {
    clear(list);
    for (const [k, v] of rows) list.append(h('dt', {}, k), h('dd', {}, v));
}

loaders.overview = async () => {
    const o = await api('GET', '/api/admin/overview');
    lastOverview = o;
    $('serverName').textContent = o.name;
    $('serverVersion').textContent = `v${o.version}`;
    $('uptimeLine').textContent = t('uptime', { t: fmtDuration(o.uptime) });
    $('navPlayers').textContent = o.current.players || '';

    const hist = o.history.map(p => ({ ...p, rssMB: Math.round(p.rss / 1048576) }));
    const cur = o.current;
    $('heroPlayers').textContent = nf.format(cur.players);
    const peak = hist.reduce((m, p) => Math.max(m, p.players), 0);
    const minutes = Math.max(1, Math.round((hist.length ? Date.now() - hist[0].t : 0) / 60000));
    $('heroSub').textContent = t('peak', { n: peak, m: minutes });

    const last12 = key => hist.slice(-12).map(p => p[key] || 0);
    clear($('tiles')).append(
        tile(t('tRooms'), nf.format(cur.rooms), '', last12('rooms')),
        tile(t('tCpu'), `${nf.format(cur.cpu || 0)}%`, t('ofCore'), last12('cpu')),
        tile(t('tMemory'), fmtBytes(cur.rss), t('heap', { v: fmtBytes(cur.heap || 0) }), last12('rssMB')),
        tile(t('tLoop'), `${nf.format(cur.loopP99 || 0)} ms`, '', last12('loopP99'), loopStatus(cur.loopP99 || 0)),
        tile(t('tTraffic'), fmtKBs(cur.outKBs || 0), t('inbound', { v: fmtKBs(cur.inKBs || 0) }), last12('outKBs')),
        tile(t('tRelay'), o.turn ? nf.format(o.turn.allocations) : '—', o.turn ? fmtKBs(cur.turnKBs || 0) : t('relayOff'), last12('turnAllocations'))
    );

    for (const c of Object.values(charts)) c.update(hist);

    kv($('systemList'), [
        [t('node'), o.node], [t('platform'), o.platform], [t('cores'), String(o.cpus)],
        [t('load'), o.load.map(v => v.toFixed(2)).join(' · ')],
        [t('httpReq'), `${fmtCount(o.http.total)} (4xx ${fmtCount(o.http['4xx'])}, 5xx ${fmtCount(o.http['5xx'])})`],
        [t('wsConn'), `${fmtCount(o.hub.clients)} / ${fmtCount(o.hub.connections)}`],
        [t('wsRejected'), fmtCount(o.hub.rejected)],
        [t('messages'), `${fmtCount(o.hub.messagesIn)} / ${fmtCount(o.hub.messagesOut)}`]
    ]);
    kv($('turnList'), o.turn ? [
        [t('relayPort'), `${o.turn.port} udp/tcp`], [t('relayTls'), o.turn.tlsPort ? String(o.turn.tlsPort) : t('off')],
        [t('relayIp'), o.turn.publicIp], [t('relayPorts'), o.turn.relayPorts], [t('allocations'), fmtCount(o.turn.allocations)],
        [t('relayed'), fmtBytes(o.turn.bytesRelayed)], [t('dropped'), fmtCount(o.turn.packetsDropped)], [t('authFail'), fmtCount(o.turn.authFailures)]
    ] : [[t('relay'), t('relayOff')]]);

    // accessible table view of the last five minutes
    const rows = hist.slice(-60);
    const table = clear($('historyTable'));
    table.append(h('thead', {}, h('tr', {}, [t('time'), t('players'), 'CPU %', 'RSS MB', 'p99 ms', 'Out KB/s', 'In KB/s', 'TURN KB/s'].map(x => h('th', {}, x)))));
    table.append(h('tbody', {}, rows.reverse().map(p => h('tr', {},
        h('td', {}, new Date(p.t).toLocaleTimeString(lang)), h('td', {}, p.players), h('td', {}, p.cpu), h('td', {}, p.rssMB),
        h('td', {}, p.loopP99), h('td', {}, p.outKBs), h('td', {}, p.inKBs), h('td', {}, p.turnKBs)))));

    if (view === 'settings' && !settingsLoaded) fillSettings(o);
    if (o.uploadQuota) updateQuota(o.uploadsUsed, o.uploadQuota);
};

$('announceForm').addEventListener('submit', async e => {
    e.preventDefault();
    const text = $('announceInput').value.trim();
    if (!text) return;
    try { await api('POST', '/api/admin/announce', { text }); $('announceInput').value = ''; toast(t('sent')); }
    catch (err) { fail(err); }
});

// ------------------------------------------------------------------ players

function avatarEl(av) {
    const m = /^e:(.+):(\w+)$/.exec(av || '');
    if (m) return h('span', { class: 'avatar', style: { background: (W.ROOM_COLORS[m[2]] || '#5E5CE6') } }, m[1]);
    if (/^usr\d+\.png$/.test(av || '')) return h('span', { class: 'avatar' }, h('img', { src: `/${av}`, alt: '' }));
    return h('span', { class: 'avatar' }, '🙂');
}

let playersCache = [];
loaders.players = async () => {
    const { players } = await api('GET', '/api/admin/players');
    playersCache = players;
    renderPlayers();
};

function renderPlayers() {
    const q = $('playerFilter').value.trim().toLowerCase();
    const list = playersCache
        .filter(p => !q || [p.nickname, p.room || '', p.ip].some(s => s.toLowerCase().includes(q)))
        .sort((a, b) => a.nickname.localeCompare(b.nickname));
    $('playersSummary').textContent = `${playersCache.length} ${t('players').toLowerCase()}`;
    const table = clear($('playersTable'));
    table.append(h('thead', {}, h('tr', {}, [t('player'), t('room'), t('ip'), t('connected'), t('idle'), t('media'), t('backlog'), ''].map(x => h('th', {}, x)))));
    const tbody = h('tbody');
    if (!list.length) tbody.append(h('tr', { class: 'empty' }, h('td', { colspan: 8 }, playersCache.length ? t('noMatch') : t('noPlayers'))));
    for (const p of list) {
        const media = [p.muted ? null : t('mic'), p.cam ? t('cam') : null, p.screen ? t('screen') : null].filter(Boolean);
        tbody.append(h('tr', {},
            h('td', {}, h('div', { class: 'who' }, avatarEl(p.avatar), h('div', {}, h('strong', {}, p.nickname), h('span', {}, p.status || 'available')),
                p.chatMutedUntil ? h('span', { class: 'tag warn' }, t('mutedUntil')) : null)),
            h('td', {}, p.room || t('world')),
            h('td', { class: 'num mono' }, p.ip || ''),
            h('td', { class: 'num' }, fmtDuration((Date.now() - p.joinedAt) / 1000)),
            h('td', { class: 'num' }, since(p.lastActive)),
            h('td', {}, media.map(m => h('span', { class: 'tag' }, m))),
            h('td', { class: 'num' }, p.backlog ? fmtBytes(p.backlog) : '—'),
            h('td', { class: 'actions' },
                h('button', { class: 'btn btn-sm', type: 'button', onclick: () => mutePlayer(p) }, p.chatMutedUntil ? t('unmute') : t('mute')),
                h('button', { class: 'btn btn-sm', type: 'button', onclick: () => kickPlayer(p) }, t('kick')),
                h('button', { class: 'btn btn-sm btn-danger', type: 'button', onclick: () => banPlayer(p) }, t('ban')))
        ));
    }
    table.append(tbody);
}
$('playerFilter').addEventListener('input', renderPlayers);

async function kickPlayer(p) {
    const r = await sheet({ title: t('kickTitle', { n: p.nickname }), text: t('kickText'), fields: [{ name: 'message', label: t('kickMsg') }], ok: t('kick') });
    if (!r) return;
    try { await api('POST', `/api/admin/players/${encodeURIComponent(p.id)}/kick`, { message: r.message }); toast(t('kicked', { n: p.nickname })); loaders.players(); }
    catch (err) { fail(err); }
}

async function banPlayer(p) {
    const r = await sheet({
        title: t('banTitle', { n: p.nickname }), text: t('banText', { ip: p.ip }), ok: t('ban'),
        fields: [
            { name: 'minutes', label: t('duration'), value: '1440', options: [['15', t('m15')], ['60', t('h1')], ['1440', t('d1')], ['10080', t('d7')], ['0', t('forever')]] },
            { name: 'reason', label: t('reason'), max: 120 }
        ]
    });
    if (!r) return;
    try { await api('POST', `/api/admin/players/${encodeURIComponent(p.id)}/ban`, { minutes: Number(r.minutes), reason: r.reason }); toast(t('banned', { n: p.nickname })); loaders.players(); }
    catch (err) { fail(err); }
}

async function mutePlayer(p) {
    if (p.chatMutedUntil) {
        try { await api('POST', `/api/admin/players/${encodeURIComponent(p.id)}/mute`, { minutes: 0 }); toast(t('unmuted', { n: p.nickname })); loaders.players(); }
        catch (err) { fail(err); }
        return;
    }
    const r = await sheet({
        title: t('muteTitle', { n: p.nickname }), text: t('muteText'), ok: t('mute'),
        fields: [{ name: 'minutes', label: t('duration'), value: '15', options: [['5', t('m5')], ['15', t('m15')], ['60', t('h1')], ['1440', t('d1')]] }]
    });
    if (!r) return;
    try { await api('POST', `/api/admin/players/${encodeURIComponent(p.id)}/mute`, { minutes: Number(r.minutes) }); toast(t('muted', { n: p.nickname })); loaders.players(); }
    catch (err) { fail(err); }
}

// ------------------------------------------------------------------ rooms

let roomColor = 'indigo';
function buildColorPicker() {
    const host = clear($('roomColors'));
    for (const [name, hex] of Object.entries(W.ROOM_COLORS)) {
        const b = h('button', { type: 'button', role: 'radio', 'aria-label': name, 'aria-checked': String(name === roomColor), style: { background: hex } });
        b.addEventListener('click', () => { roomColor = name; host.querySelectorAll('button').forEach(x => x.setAttribute('aria-checked', String(x === b))); });
        host.append(b);
    }
}

function slotLabel(id) { return id.replace('slot_', '#'); }

loaders.rooms = async () => {
    const { rooms } = await api('GET', '/api/admin/rooms');
    const byId = new Map(rooms.map(r => [r.id, r]));
    const select = $('roomSlot');
    const keep = select.value;
    clear(select);
    for (const s of W.buildSlots().filter(s => s.type === 'conference')) {
        const r = byId.get(s.id);
        select.append(h('option', { value: s.id }, `${slotLabel(s.id)} · ${r ? t('replaces', { n: r.name }) : t('free')}`));
    }
    if (keep) select.value = keep;

    const table = clear($('roomsTable'));
    table.append(h('thead', {}, h('tr', {}, [t('name'), t('slot'), t('type'), t('owner'), t('people'), t('topic'), ''].map(x => h('th', {}, x)))));
    const tbody = h('tbody');
    const sorted = rooms.slice().sort((a, b) => (b.builtin - a.builtin) || (b.permanent - a.permanent) || a.name.localeCompare(b.name));
    if (!sorted.length) tbody.append(h('tr', { class: 'empty' }, h('td', { colspan: 7 }, t('noRooms'))));
    for (const r of sorted) {
        tbody.append(h('tr', {},
            h('td', {}, h('span', { class: 'dot', style: { background: W.ROOM_COLORS[r.color] || '#8e8e93' } }), r.name, r.hasPassword ? h('span', { class: 'tag', title: t('lock') }, '🔒') : null),
            h('td', { class: 'num' }, r.builtin ? '—' : slotLabel(r.id)),
            h('td', {}, h('span', { class: 'tag' }, r.builtin ? t('builtin') : r.permanent ? t('permanent') : t('playerRoom'))),
            h('td', {}, r.ownerName || '—'),
            h('td', { class: 'num' }, String(r.occupants)),
            h('td', { class: 'muted' }, r.topic || r.playing || ''),
            h('td', { class: 'actions' }, r.builtin ? null : h('button', { class: 'btn btn-sm btn-danger', type: 'button', onclick: () => closeRoom(r) }, t('close')))
        ));
    }
    table.append(tbody);
};

async function closeRoom(r) {
    const ok = await sheet({ title: t('closeTitle', { n: r.name }), text: t('closeText'), ok: t('close') });
    if (!ok) return;
    try { await api('DELETE', `/api/admin/rooms/${encodeURIComponent(r.id)}`); toast(t('closed')); loaders.rooms(); }
    catch (err) { fail(err); }
}

$('roomForm').addEventListener('submit', async e => {
    e.preventDefault();
    try {
        await api('POST', '/api/admin/rooms', { slotId: $('roomSlot').value, name: $('roomName').value, topic: $('roomTopic').value, password: $('roomPassword').value, color: roomColor });
        toast(t('created'));
        $('roomName').value = $('roomTopic').value = $('roomPassword').value = '';
        loaders.rooms();
    } catch (err) { fail(err); }
});

// ------------------------------------------------------------------ music

function updateQuota(used, total) {
    const pct = total ? Math.min(100, used / total * 100) : 0;
    const meter = $('quotaMeter');
    meter.querySelector('i').style.width = `${pct}%`;
    meter.classList.toggle('warning', pct >= 75 && pct < 95);
    meter.classList.toggle('critical', pct >= 95);
    $('quotaText').textContent = t('quota', { used: fmtBytes(used), total: fmtBytes(total) });
}

let previewAudio = null;
loaders.music = async () => {
    const { tracks } = await api('GET', '/api/admin/music');
    const table = clear($('musicTable'));
    table.append(h('thead', {}, h('tr', {}, [t('track'), t('artist'), t('source'), t('size'), t('by'), ''].map(x => h('th', {}, x)))));
    const tbody = h('tbody');
    if (!tracks.length) tbody.append(h('tr', { class: 'empty' }, h('td', { colspan: 6 }, t('noTracks'))));
    for (const tr of tracks) {
        tbody.append(h('tr', {},
            h('td', {}, h('strong', {}, tr.title)),
            h('td', { class: 'muted' }, tr.artist || '—'),
            h('td', {}, h('span', { class: 'tag' }, tr.source === 'upload' ? t('upload') : t('server'))),
            h('td', { class: 'num' }, fmtBytes(tr.size)),
            h('td', {}, tr.uploadedBy || '—'),
            h('td', { class: 'actions' },
                h('button', { class: 'btn btn-sm', type: 'button', onclick: e => preview(tr, e.currentTarget) }, t('preview')),
                h('button', { class: 'btn btn-sm btn-danger', type: 'button', onclick: () => removeTrack(tr) }, t('remove')))
        ));
    }
    table.append(tbody);
};

function preview(track, btn) {
    if (previewAudio && previewAudio.dataset.id === track.id) { previewAudio.pause(); previewAudio = null; btn.textContent = t('preview'); return; }
    if (previewAudio) previewAudio.pause();
    document.querySelectorAll('#musicTable .btn:not(.btn-danger)').forEach(b => { b.textContent = t('preview'); });
    previewAudio = new Audio(`/media/music/${encodeURIComponent(track.id)}`);
    previewAudio.dataset.id = track.id;
    previewAudio.volume = .6;
    previewAudio.play().catch(() => {});
    previewAudio.addEventListener('ended', () => { btn.textContent = t('preview'); previewAudio = null; });
    btn.textContent = '■';
}

async function removeTrack(tr) {
    const ok = await sheet({ title: t('removeTitle', { n: tr.title }), text: t('removeText'), ok: t('remove') });
    if (!ok) return;
    try { await api('DELETE', `/api/admin/music/${encodeURIComponent(tr.id)}`); toast(t('removed')); loaders.music(); }
    catch (err) { fail(err); }
}

// ------------------------------------------------------------------ bans

loaders.bans = async () => {
    const { bans } = await api('GET', '/api/admin/bans');
    $('navBans').textContent = bans.length || '';
    const table = clear($('bansTable'));
    table.append(h('thead', {}, h('tr', {}, [t('ip'), t('player'), t('reason').replace(/ \(.*\)/, ''), t('since'), t('until'), ''].map(x => h('th', {}, x)))));
    const tbody = h('tbody');
    if (!bans.length) tbody.append(h('tr', { class: 'empty' }, h('td', { colspan: 6 }, t('noBans'))));
    for (const b of bans.slice().sort((x, y) => y.createdAt - x.createdAt)) {
        tbody.append(h('tr', {},
            h('td', { class: 'mono' }, b.ip),
            h('td', {}, b.name || '—'),
            h('td', { class: 'muted' }, b.reason || '—'),
            h('td', { class: 'num' }, dateTime(b.createdAt)),
            h('td', { class: 'num' }, b.until ? dateTime(b.until) : t('forever')),
            h('td', { class: 'actions' }, h('button', { class: 'btn btn-sm', type: 'button', onclick: () => unban(b) }, t('unban')))
        ));
    }
    table.append(tbody);
};

async function unban(b) {
    try { await api('DELETE', `/api/admin/bans/${encodeURIComponent(b.id)}`); toast(t('unbanned')); loaders.bans(); }
    catch (err) { fail(err); }
}

// ------------------------------------------------------------------ settings

let settingsLoaded = false;
function fillSettings(o) {
    const s = o.settings;
    $('setMotd').value = s.motd || '';
    $('setPassword').value = s.serverPassword || '';
    $('setUploads').checked = s.allowUploads === null ? true : !!s.allowUploads;
    $('setFilter').value = s.wordFilter || '';
    $('envPasswordNote').textContent = o.envPassword ? t('envPassword') : t('serverPasswordHint');
    $('setPassword').disabled = !!o.envPassword;
    settingsLoaded = true;
}
loaders.settings = async () => {
    if (!settingsLoaded && lastOverview) fillSettings(lastOverview);
};

$('settingsForm').addEventListener('submit', async e => {
    e.preventDefault();
    const patch = { motd: $('setMotd').value, allowUploads: $('setUploads').checked, wordFilter: $('setFilter').value };
    if (!$('setPassword').disabled) patch.serverPassword = $('setPassword').value;
    try {
        const r = await api('PUT', '/api/admin/settings', patch);
        if (lastOverview) lastOverview.settings = r.settings;
        toast(t('saved'));
    } catch (err) { fail(err); }
});

// ------------------------------------------------------------------ boot

function start() {
    $('login').hidden = true;
    $('app').hidden = false;
    if (!charts.players) setupCharts();
    loaders.bans().catch(() => {});
    go(location.hash.slice(1) || 'overview');
}

translate();
hydrateIcons();
buildColorPicker();
if (token) {
    api('POST', '/api/admin/login').then(start, err => showLogin(err.code === 'network' ? t('network') : ''));
} else showLogin();

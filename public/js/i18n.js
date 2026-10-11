import { S, setSetting, bus } from './state.js';

const DICT = {
    en: {
        tagline: 'A virtual universe to talk, build and play.',
        nickname: 'Nickname', nickname_ph: 'What should we call you?', avatar: 'Avatar',
        tos_read: 'I have read and accept the', tos_link: 'privacy notice',
        join: 'Enter Locmind', mic_hint: 'Microphone is optional — you can listen and chat without one.',
        nick_required: 'Please choose a nickname.', tos_required: 'Please accept the privacy notice to continue.',
        joining: 'Connecting…',
        score_reset: 'Reset score', rooms: 'Rooms', settings: 'Settings', close: 'Close', chat: 'Chat', chat_ph: 'Say something…', send: 'Send',
        reconnecting: 'Reconnecting…', reconnected: 'Back online', conn_lost: 'Connection lost', reconnect: 'Reconnect',
        whiteboard: 'Whiteboard', eraser: 'Eraser', download_png: 'Save as PNG', clear_all: 'Clear board', clear_confirm: 'Clear the whiteboard for everyone?',
        notes: 'Shared notes', notes_ph: 'Everyone in the room can read and edit this…', export_txt: 'Export .txt',
        music: 'Room music', now_playing: 'Now playing', skip: 'Skip', music_ph: 'YouTube link or search…', queue: 'Up next', queue_empty: 'The queue is empty',
        added_by: 'added by {name}', search_failed: 'Search is unavailable right now — paste a YouTube link instead.', search_none: 'No results.',
        invalid_link: 'That does not look like a YouTube link.', queue_full: 'The queue is full.', nothing_playing: 'Nothing playing',
        create_room: 'Create a room', room_name: 'Room name', room_name_ph: 'Weekly sync', room_pass: 'Password', optional: '(optional)', room_color: 'Colour',
        cancel: 'Cancel', create: 'Create', room_locked: 'This room is locked', room_locked_desc: 'Enter the password to come in.', password: 'Password', enter: 'Enter',
        wrong_password: 'Wrong password.', unlocked: 'Unlocked!', ok: 'OK', done: 'Done',
        language: 'Language', appearance: 'Appearance', auto: 'Auto', light: 'Light', dark: 'Dark', microphone: 'Microphone', default_mic: 'System default',
        master_volume: 'Master volume', sfx: 'Sound effects', spatial: 'Stereo spatial audio', minimap: 'Show minimap', reduce_motion: 'Reduce motion',
        afk_title: 'Are you still there?', afk_desc: 'You have been inactive for a while. You will be disconnected in', afk_here: "I'm here",
        kicked_afk: 'You were disconnected because of inactivity.', kicked_default: 'You were disconnected from the server.', kicked_full: 'The universe is full right now. Please try again in a moment.',
        kicked_timeout: 'The server did not answer. Please try again.', kicked_error: 'Something went wrong while connecting.',
        stadium: 'Stadium',
        dock_mic_on: 'Mute (F)', dock_mic_off: 'Unmute (F)', dock_mic_denied: 'Microphone unavailable — tap to retry (F)', dock_cam_on: 'Camera off (C)', dock_cam_off: 'Camera on (C)',
        dock_chat: 'Chat (Enter)', dock_emoji: 'Reactions (Q)', dock_board: 'Whiteboard (G)', dock_notes: 'Notes (H)', dock_music: 'Music (M)',
        dock_share: 'Share screen', dock_share_stop: 'Stop sharing', dock_kick: 'Kick (Space)', dock_log: 'Chat history (T)',
        zone_public: 'Public · proximity voice', zone_room: 'Room · {name}', zone_stadium: 'Stadium · everyone hears everyone', zone_locked: 'Locked room',
        hint_build: 'Press {key} or tap here to build a room', hint_kick: 'Run into the ball or press {key} to kick',
        people_nearby: 'Nearby', people_room: 'In this room', you: 'you', people_none: 'Nobody in earshot',
        rooms_title: 'Active rooms', rooms_none: 'No rooms yet — stand on a free plot and press E to create one.', rooms_locate: 'Show me', rooms_inside: '{n} inside', rooms_by: 'by {name}', rooms_builtin: 'Always open',
        reactions: 'Reactions', images: 'Stickers', scope_room: 'room',
        need_room: 'Step inside a room to use this.', mic_error_https: 'Microphone needs HTTPS (or localhost).',
        room_created: 'Room "{name}" is ready.', welcome: 'Welcome, {name}!',
        'err_not-in-slot': 'Stand on a free plot first.', 'err_slot-taken': 'Somebody already built a room here.', 'err_too-many-rooms': 'You already own two rooms.',
        'err_invalid-name': 'Please give the room a name.', 'err_rate-limit': 'Slow down a little…', 'err_server-error': 'Something went wrong.', 'err_invalid-slot': 'You cannot build here.',
        goal: 'GOAL!', goal_by: '{name} scores for {team}', goal_team_blue: 'Blue', goal_team_red: 'Red', goal_plain: '{team} scores!',
        screen_of: '{name} — screen', fullscreen: 'Fullscreen', note_edited: 'Saved',
        // v3
        avatar_custom: 'Make your own', status: 'Status', status_available: 'Available', status_busy: 'Busy', status_away: 'Away', status_dnd: 'Do not disturb',
        status_text_ph: 'What are you up to?', profile: 'Profile',
        server_password: 'Server password', server_password_required: 'This server needs a password.', wrong_server_password: 'Wrong server password.',
        kicked_banned: 'You are banned from this server.', kicked_admin: 'The server operator removed you.', kicked_replaced: 'You opened Locmind in another tab or on another device.',
        net_quality: 'Connection: {ms} ms', dock_ptt: 'Push to talk: hold V', dock_dm: 'Messages (N)', dock_gallery: 'Cameras (L)',
        dock_hand_up: 'Raise hand (Y)', dock_hand_down: 'Lower hand (Y)', dock_roomtools: 'Room tools (O)',
        zone_stage: 'On stage · the whole hall hears you', zone_audience: 'Auditorium · whisper to neighbours',
        notify_unsupported: 'This browser cannot show notifications.', notify_denied: 'Notifications are blocked for this site.',
        auditorium: 'Auditorium', stage: 'Stage', meters_away: '{n} m away', message: 'Message', wave: 'Wave', walk_to: 'Walk there', no_path: 'There is no way to get there.',
        follow: 'Follow', unfollow: 'Stop', volume: 'Volume', lower_hand: 'Lower hand', remove_from_room: 'Remove from room', block: 'Block', unblock: 'Unblock',
        removed_from_room: '{name} was removed from the room.', blocked: 'You will not see or hear {name} any more.', unblocked: '{name} is unblocked.',
        waved_at: 'You waved at {name}.', waved_you: '{name} waved at you', dm_empty: 'Pick someone on the map and press Message.', dm_offline: '{name} is offline.',
        dm_from: 'Message from {name}', dm_ph: 'Write a private message…', messages: 'Messages', chat_muted: 'You are muted in chat.',
        announcement: 'Announcement', chat_muted_until: 'You are muted in chat until {time}.', chat_unmuted: 'You can chat again.', room_kicked: 'You were removed from {name}.',
        rooms_permanent: 'Permanent', rooms_go: 'Take me there', mentioned_by: '{name} mentioned you',
        room_tools: 'Room', hands: 'Raised hands', hands_none: 'Nobody is waiting to speak.', poll: 'Poll', poll_votes: '{n} votes', poll_closed: 'closed',
        poll_close: 'End poll', poll_question: 'Ask a question…', poll_option: 'Option {n}', yes: 'Yes', no: 'No', poll_add_option: 'Option', poll_start: 'Start poll',
        poll_invalid: 'A poll needs a question and two options.', poll_new: 'New poll', timer: 'Timer', timer_stop: 'Stop', timer_label: 'What is the timer for? (optional)',
        minutes: 'minutes', n_min: '{n} min', timer_start: 'Start', timer_done: '{label} is up!', topic: 'Topic', topic_ph: 'What is this room about?',
        password_keep: 'Leave empty to keep the password', password_none: 'Optional', password_remove: 'Remove password', room_saved: 'Room updated.', save: 'Save',
        remove: 'Remove', room_alone: 'Nobody else is here.', owner_settings: 'Owner settings',
        library: 'Library', library_ph: 'Search the library…', upload: 'Upload a song', loading: 'Loading…', library_empty: 'The library is empty. Upload a song or ask the operator to add some.',
        uploaded_by: 'added by {name}', music_tap_to_play: 'Tap anywhere to start the music.', upload_too_big: 'That file is too big (max {mb} MB).', upload_done: '“{title}” was added to the library.',
        upload_quota: 'The server has no room for more uploads.', upload_disabled: 'Uploads are turned off on this server.', upload_failed: 'The upload failed.', upload_not_audio: 'That is not an audio file.',
        youtube_disabled: 'YouTube is turned off on this server.', need_stage: 'Step onto the stage to share your screen.', gallery: 'Cameras', gallery_empty: 'Nobody has a camera on.',
        ptt: 'Push to talk', ptt_hint: 'hold V', notify: 'Desktop notifications',
        'err_not-owner': 'Only the room owner can do that.', 'err_not-in-room': 'They are not in your room.', 'err_invalid-poll': 'A poll needs a question and two options.',
        'err_poll-running': 'Another poll is still running.', 'err_invalid': 'That did not work.', 'err_room-banned': 'You were removed from this room. Try again later.',
        terms_body: '<p><b>What Locmind processes</b></p><ul><li>Your nickname, avatar, status and position on the map — kept in server memory only while you are online.</li><li>Chat, private messages, reactions, polls and the music queue — kept in memory and never written to disk. Whiteboards and notes of player-built rooms vanish with the room; permanent rooms set up by the operator keep theirs on the server.</li><li>Voice, camera and screen sharing travel directly between participants (WebRTC, peer-to-peer). The server never records them; its built-in relay (TURN) may forward encrypted traffic when a direct connection is impossible.</li><li>Songs you upload are stored on this server so everybody can play them.</li></ul><p>Your browser remembers your nickname, avatar and preferences locally. No cookies, no analytics and no third-party services are used, unless the operator turns on YouTube music, which then uses the YouTube embedded player and Google’s terms.</p><p>Be kind: do not share other people’s personal data, harass anyone or post unlawful content. Room owners and the operator may remove disruptive users.</p>'
    },
    tr: {
        tagline: 'Konuşmak, kurmak ve oynamak için sanal bir evren.',
        nickname: 'Takma ad', nickname_ph: 'Sana ne diyelim?', avatar: 'Avatar',
        tos_read: 'Şunu okudum ve kabul ediyorum:', tos_link: 'aydınlatma metni',
        join: "Locmind'e gir", mic_hint: 'Mikrofon isteğe bağlı — mikrofonsuz da dinleyip yazabilirsin.',
        nick_required: 'Lütfen bir takma ad seç.', tos_required: 'Devam etmek için aydınlatma metnini kabul et.',
        joining: 'Bağlanıyor…',
        score_reset: 'Skoru sıfırla', rooms: 'Odalar', settings: 'Ayarlar', close: 'Kapat', chat: 'Sohbet', chat_ph: 'Bir şey yaz…', send: 'Gönder',
        reconnecting: 'Yeniden bağlanıyor…', reconnected: 'Tekrar çevrimiçi', conn_lost: 'Bağlantı koptu', reconnect: 'Yeniden bağlan',
        whiteboard: 'Beyaz tahta', eraser: 'Silgi', download_png: 'PNG olarak kaydet', clear_all: 'Tahtayı temizle', clear_confirm: 'Beyaz tahta herkes için temizlensin mi?',
        notes: 'Ortak notlar', notes_ph: 'Odadaki herkes bunu okuyup düzenleyebilir…', export_txt: '.txt olarak aktar',
        music: 'Oda müziği', now_playing: 'Şimdi çalıyor', skip: 'Geç', music_ph: 'YouTube bağlantısı veya arama…', queue: 'Sırada', queue_empty: 'Sıra boş',
        added_by: '{name} ekledi', search_failed: 'Arama şu an kullanılamıyor — bunun yerine bir YouTube bağlantısı yapıştır.', search_none: 'Sonuç yok.',
        invalid_link: 'Bu bir YouTube bağlantısına benzemiyor.', queue_full: 'Sıra dolu.', nothing_playing: 'Çalan bir şey yok',
        create_room: 'Oda kur', room_name: 'Oda adı', room_name_ph: 'Haftalık toplantı', room_pass: 'Şifre', optional: '(isteğe bağlı)', room_color: 'Renk',
        cancel: 'Vazgeç', create: 'Oluştur', room_locked: 'Bu oda kilitli', room_locked_desc: 'İçeri girmek için şifreyi yaz.', password: 'Şifre', enter: 'Gir',
        wrong_password: 'Yanlış şifre.', unlocked: 'Kilit açıldı!', ok: 'Tamam', done: 'Bitti',
        language: 'Dil', appearance: 'Görünüm', auto: 'Otomatik', light: 'Açık', dark: 'Koyu', microphone: 'Mikrofon', default_mic: 'Sistem varsayılanı',
        master_volume: 'Ana ses', sfx: 'Ses efektleri', spatial: 'Stereo uzamsal ses', minimap: 'Mini haritayı göster', reduce_motion: 'Hareketi azalt',
        afk_title: 'Orada mısın?', afk_desc: 'Bir süredir hareketsizsin. Bağlantın şu kadar saniye sonra kesilecek:', afk_here: 'Buradayım',
        kicked_afk: 'Hareketsizlik nedeniyle bağlantın kesildi.', kicked_default: 'Sunucuyla bağlantın kesildi.', kicked_full: 'Evren şu an dolu. Lütfen birazdan tekrar dene.',
        kicked_timeout: 'Sunucu yanıt vermedi. Lütfen tekrar dene.', kicked_error: 'Bağlanırken bir şeyler ters gitti.',
        stadium: 'Stadyum',
        dock_mic_on: 'Sessize al (F)', dock_mic_off: 'Sesi aç (F)', dock_mic_denied: 'Mikrofon kullanılamıyor — tekrar denemek için dokun (F)', dock_cam_on: 'Kamerayı kapat (C)', dock_cam_off: 'Kamerayı aç (C)',
        dock_chat: 'Sohbet (Enter)', dock_emoji: 'Tepkiler (Q)', dock_board: 'Beyaz tahta (G)', dock_notes: 'Notlar (H)', dock_music: 'Müzik (M)',
        dock_share: 'Ekranı paylaş', dock_share_stop: 'Paylaşımı durdur', dock_kick: 'Şut (Boşluk)', dock_log: 'Sohbet geçmişi (T)',
        zone_public: 'Herkese açık · yakınlık sesi', zone_room: 'Oda · {name}', zone_stadium: 'Stadyum · herkes herkesi duyar', zone_locked: 'Kilitli oda',
        hint_build: 'Oda kurmak için {key} tuşuna bas ya da buraya dokun', hint_kick: 'Topa koş ya da şut için {key} tuşuna bas',
        people_nearby: 'Yakındakiler', people_room: 'Bu odada', you: 'sen', people_none: 'Menzilde kimse yok',
        rooms_title: 'Aktif odalar', rooms_none: 'Henüz oda yok — boş bir arsada dur ve oda kurmak için E tuşuna bas.', rooms_locate: 'Göster', rooms_inside: '{n} kişi içeride', rooms_by: '{name} kurdu', rooms_builtin: 'Her zaman açık',
        reactions: 'Tepkiler', images: 'Çıkartmalar', scope_room: 'oda',
        need_room: 'Bunu kullanmak için bir odanın içine gir.', mic_error_https: 'Mikrofon için HTTPS (veya localhost) gerekir.',
        room_created: '"{name}" odası hazır.', welcome: 'Hoş geldin, {name}!',
        'err_not-in-slot': 'Önce boş bir arsanın üstüne gel.', 'err_slot-taken': 'Burada biri zaten oda kurmuş.', 'err_too-many-rooms': 'Zaten iki odan var.',
        'err_invalid-name': 'Lütfen odaya bir ad ver.', 'err_rate-limit': 'Biraz yavaş…', 'err_server-error': 'Bir şeyler ters gitti.', 'err_invalid-slot': 'Burada oda kuramazsın.',
        goal: 'GOOOL!', goal_by: '{name}, {team} için attı', goal_team_blue: 'Mavi', goal_team_red: 'Kırmızı', goal_plain: '{team} gol attı!',
        screen_of: '{name} — ekran', fullscreen: 'Tam ekran', note_edited: 'Kaydedildi',
        // v3
        avatar_custom: 'Kendin yap', status: 'Durum', status_available: 'Müsait', status_busy: 'Meşgul', status_away: 'Uzakta', status_dnd: 'Rahatsız etmeyin',
        status_text_ph: 'Ne yapıyorsun?', profile: 'Profil',
        server_password: 'Sunucu şifresi', server_password_required: 'Bu sunucu şifre istiyor.', wrong_server_password: 'Sunucu şifresi yanlış.',
        kicked_banned: 'Bu sunucudan yasaklandın.', kicked_admin: 'Sunucu yöneticisi seni çıkardı.', kicked_replaced: "Locmind'i başka bir sekmede ya da cihazda açtın.",
        net_quality: 'Bağlantı: {ms} ms', dock_ptt: 'Bas-konuş: V tuşunu basılı tut', dock_dm: 'Mesajlar (N)', dock_gallery: 'Kameralar (L)',
        dock_hand_up: 'El kaldır (Y)', dock_hand_down: 'Eli indir (Y)', dock_roomtools: 'Oda araçları (O)',
        zone_stage: 'Sahnedesin · tüm salon seni duyar', zone_audience: 'Oditoryum · yanındakilerle fısılda',
        notify_unsupported: 'Bu tarayıcı bildirim gösteremiyor.', notify_denied: 'Bu site için bildirimler engellenmiş.',
        auditorium: 'Oditoryum', stage: 'Sahne', meters_away: '{n} m uzakta', message: 'Mesaj', wave: 'El salla', walk_to: 'Oraya yürü', no_path: 'Oraya giden bir yol yok.',
        follow: 'Takip et', unfollow: 'Bırak', volume: 'Ses', lower_hand: 'Eli indir', remove_from_room: 'Odadan çıkar', block: 'Engelle', unblock: 'Engeli kaldır',
        removed_from_room: '{name} odadan çıkarıldı.', blocked: '{name} artık görünmeyecek ve duyulmayacak.', unblocked: '{name} engeli kaldırıldı.',
        waved_at: '{name} adlı kişiye el salladın.', waved_you: '{name} sana el salladı', dm_empty: "Haritadan birini seç ve Mesaj'a bas.", dm_offline: '{name} çevrim dışı.',
        dm_from: '{name} mesaj gönderdi', dm_ph: 'Özel bir mesaj yaz…', messages: 'Mesajlar', chat_muted: 'Sohbette susturuldun.',
        announcement: 'Duyuru', chat_muted_until: 'Saat {time} kadar sohbette susturuldun.', chat_unmuted: 'Tekrar yazabilirsin.', room_kicked: '{name} odasından çıkarıldın.',
        rooms_permanent: 'Kalıcı', rooms_go: 'Beni oraya götür', mentioned_by: '{name} senden bahsetti',
        room_tools: 'Oda', hands: 'Kalkan eller', hands_none: 'Söz bekleyen yok.', poll: 'Anket', poll_votes: '{n} oy', poll_closed: 'kapandı',
        poll_close: 'Anketi bitir', poll_question: 'Bir soru sor…', poll_option: 'Seçenek {n}', yes: 'Evet', no: 'Hayır', poll_add_option: 'Seçenek', poll_start: 'Anketi başlat',
        poll_invalid: 'Anket için bir soru ve iki seçenek gerekli.', poll_new: 'Yeni anket', timer: 'Zamanlayıcı', timer_stop: 'Durdur', timer_label: 'Zamanlayıcı ne için? (isteğe bağlı)',
        minutes: 'dakika', n_min: '{n} dk', timer_start: 'Başlat', timer_done: '{label} süresi doldu!', topic: 'Konu', topic_ph: 'Bu oda ne hakkında?',
        password_keep: 'Şifreyi korumak için boş bırak', password_none: 'İsteğe bağlı', password_remove: 'Şifreyi kaldır', room_saved: 'Oda güncellendi.', save: 'Kaydet',
        remove: 'Çıkar', room_alone: 'Burada senden başka kimse yok.', owner_settings: 'Oda sahibi ayarları',
        library: 'Kitaplık', library_ph: 'Kitaplıkta ara…', upload: 'Şarkı yükle', loading: 'Yükleniyor…', library_empty: 'Kitaplık boş. Bir şarkı yükle ya da yöneticiden eklemesini iste.',
        uploaded_by: '{name} ekledi', music_tap_to_play: 'Müziği başlatmak için herhangi bir yere dokun.', upload_too_big: 'Dosya çok büyük (en fazla {mb} MB).', upload_done: '“{title}” kitaplığa eklendi.',
        upload_quota: 'Sunucuda yeni yüklemeler için yer kalmadı.', upload_disabled: 'Bu sunucuda yükleme kapalı.', upload_failed: 'Yükleme başarısız oldu.', upload_not_audio: 'Bu bir ses dosyası değil.',
        youtube_disabled: 'Bu sunucuda YouTube kapalı.', need_stage: 'Ekran paylaşmak için sahneye çık.', gallery: 'Kameralar', gallery_empty: 'Kimsenin kamerası açık değil.',
        ptt: 'Bas-konuş', ptt_hint: 'V basılı', notify: 'Masaüstü bildirimleri',
        'err_not-owner': 'Bunu yalnızca oda sahibi yapabilir.', 'err_not-in-room': 'Bu kişi senin odanda değil.', 'err_invalid-poll': 'Anket için bir soru ve iki seçenek gerekli.',
        'err_poll-running': 'Başka bir anket hâlâ sürüyor.', 'err_invalid': 'Bu işe yaramadı.', 'err_room-banned': 'Bu odadan çıkarıldın. Daha sonra tekrar dene.',
        terms_body: '<p><b>Locmind neleri işler?</b></p><ul><li>Takma adın, avatarın, durumun ve haritadaki konumun — yalnızca çevrimiçi olduğun sürece sunucu belleğinde tutulur.</li><li>Sohbet, özel mesajlar, tepkiler, anketler ve müzik sırası — bellekte tutulur, diske yazılmaz. Oyuncuların kurduğu odaların beyaz tahta ve notları oda ile birlikte silinir; yöneticinin kurduğu kalıcı odalar bunları sunucuda saklar.</li><li>Ses, kamera ve ekran paylaşımı katılımcılar arasında doğrudan (WebRTC, eşler arası) akar. Sunucu bunları kaydetmez; doğrudan bağlantı mümkün değilse şifreli trafik sunucunun kendi aktarıcısından (TURN) geçebilir.</li><li>Yüklediğin şarkılar herkes çalabilsin diye bu sunucuda saklanır.</li></ul><p>Tarayıcın takma adını, avatarını ve tercihlerini yalnızca yerel olarak hatırlar. Çerez, analitik ya da üçüncü taraf hizmet kullanılmaz; yalnızca yönetici YouTube müziğini açarsa YouTube gömülü oynatıcısı ve Google’ın koşulları devreye girer.</p><p>Kişisel Verilerin Korunması Kanunu (KVKK) kapsamında bilgilendirme budur. Lütfen saygılı ol: başkalarının kişisel verilerini paylaşma, kimseyi rahatsız etme, hukuka aykırı içerik paylaşma. Oda sahipleri ve işletmeci sorun çıkaran kullanıcıları uzaklaştırabilir.</p>'
    }
};

export function detectLang() {
    const saved = S.settings.lang;
    if (saved && DICT[saved]) return saved;
    return (navigator.language || 'en').toLowerCase().startsWith('tr') ? 'tr' : 'en';
}

let lang = detectLang();
export const getLang = () => lang;

export function t(key, vars) {
    let s = (DICT[lang] && DICT[lang][key]) || DICT.en[key] || key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(v);
    return s;
}

export function applyI18n(root = document) {
    root.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
    root.querySelectorAll('[data-i18n-html]').forEach(el => { el.innerHTML = t(el.dataset.i18nHtml); }); // own, static strings only
    root.querySelectorAll('[data-i18n-placeholder]').forEach(el => { el.placeholder = t(el.dataset.i18nPlaceholder); });
    root.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = t(el.dataset.i18nTitle); });
}

export function setLang(next) {
    if (!DICT[next]) return;
    lang = next;
    document.documentElement.lang = next;
    setSetting('lang', next);
    applyI18n();
    document.querySelectorAll('[data-lang]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.lang === next)));
    bus.emit('lang', next);
}

export function initI18n() {
    document.documentElement.lang = lang;
    applyI18n();
    document.querySelectorAll('[data-lang]').forEach(b => {
        b.setAttribute('aria-pressed', String(b.dataset.lang === lang));
        b.addEventListener('click', () => setLang(b.dataset.lang));
    });
}

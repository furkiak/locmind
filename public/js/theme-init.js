// Runs before first paint so the page never flashes the wrong appearance.
(function () {
    try {
        var s = JSON.parse(localStorage.getItem('locmind.settings') || '{}');
        var t = s.theme || 'auto';
        if (t === 'auto') t = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
        document.documentElement.dataset.theme = t;
        if (s.reduceMotion) document.documentElement.classList.add('reduce-motion');
    } catch (e) { /* storage unavailable: keep the default dark theme */ }
})();

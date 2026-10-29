// SciLex Okuyucu: SciLex AI'den gelen dinleme paketlerini çalar; okunan cümleyi vurgular.
(function () {
  'use strict';
  const $ = function (id) { return document.getElementById(id); };
  const audio = $('audio');
  const paneMain = $('pane-main'), paneOther = $('pane-other');
  const RATES = [0.8, 1, 1.15, 1.3, 1.5, 1.75, 2];

  const S = {
    book: null, man: null, page: 0, urls: [], spans: [], times: [], cur: -1,
    follow: true, userScrollAt: 0, mode: 'main', rate: 1, sleepTimer: null, sleepAtPageEnd: false,
    saveTimer: null, raf: 0, wantPlay: false
  };

  function pref(key, def) {
    try { const v = localStorage.getItem('scilex.' + key); return v === null ? def : JSON.parse(v); }
    catch (e) { return def; }
  }
  function setPref(key, v) { try { localStorage.setItem('scilex.' + key, JSON.stringify(v)); } catch (e) {} }

  function toast(msg, ms) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.add('hidden'); }, ms || 2600);
  }
  function fmt(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    const m = Math.floor(sec / 60), s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }
  function esc(s) {
    return String(s || '').replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  // ------------------------------------------------------------ kitaplık
  async function showLibrary() {
    await savePosition();
    audio.pause();
    S.book = null;
    $('reader').classList.add('hidden');
    $('library').classList.remove('hidden');
    const list = await SciStore.books();
    const box = $('lib-list');
    box.innerHTML = '';
    $('lib-hint').classList.toggle('hidden', list.length > 0);
    list.forEach(function (b) {
      const pages = (b.manifest.pages || []).length || 1;
      const pct = Math.round(100 * Math.min(1, (b.pos.page || 0) / pages));
      const el = document.createElement('div');
      el.className = 'book';
      const langs = [b.manifest.audio_language, b.manifest.other_language].filter(Boolean).join(' · ');
      const first = (b.manifest.pages[0] || {}).n, last = (b.manifest.pages[pages - 1] || {}).n;
      el.innerHTML = '<div class="info"><div class="t">' + esc(b.title) + '</div>' +
        '<div class="m">🔊 ' + esc(langs) + ' · PDF s. ' + first + (last !== first ? '–' + last : '') +
        ' · ' + pages + ' sayfa</div><div class="bar-mini"><i style="width:' + pct + '%"></i></div></div>' +
        '<button class="del" aria-label="Sil">🗑</button>';
      el.addEventListener('click', function (ev) {
        if (ev.target.classList.contains('del')) {
          ev.stopPropagation();
          if (confirm('"' + b.title + '" bu telefondan silinsin mi?')) {
            SciStore.remove(b.id).then(showLibrary);
          }
          return;
        }
        openBook(b.id);
      });
      box.appendChild(el);
    });
  }

  async function importFile(file) {
    if (!file) return;
    toast('Paket açılıyor…', 60000);
    try {
      const files = await SciUnzip(await file.arrayBuffer());
      const mf = files.get('manifest.json');
      if (!mf) throw new Error('Bu dosya bir SciLex dinleme paketi değil.');
      const manifest = JSON.parse(await mf.text());
      if (manifest.format !== 'scilex-listen') throw new Error('Bu dosya bir SciLex dinleme paketi değil.');
      await SciStore.persist();
      const book = await SciStore.addBook(manifest, files);
      toast('Eklendi: ' + book.title);
      await showLibrary();
    } catch (e) {
      toast('Açılamadı: ' + (e && e.message ? e.message : e), 6000);
    }
  }

  // ------------------------------------------------------------ okuyucu
  async function openBook(id) {
    const book = await SciStore.book(id);
    if (!book) return;
    S.book = book;
    S.man = book.manifest;
    $('library').classList.add('hidden');
    $('reader').classList.remove('hidden');
    $('r-title').textContent = book.title;
    $('mode-main').textContent = S.man.audio_language || 'Dinlenen';
    $('mode-other').textContent = S.man.other_language || 'Öbür dil';
    $('mode-other').disabled = !S.man.other_language;
    const sel = $('page-select');
    sel.innerHTML = '';
    S.man.pages.forEach(function (p, i) {
      const o = document.createElement('option');
      o.value = i;
      o.textContent = 'PDF sayfa ' + p.n + (p.audio ? '' : ' (ses yok)');
      sel.appendChild(o);
    });
    setMode(S.man.other_language ? pref('mode', 'main') : 'main');
    await loadPage(Math.min(book.pos.page || 0, S.man.pages.length - 1), book.pos.time || 0, false);
  }

  function revokeUrls() {
    S.urls.forEach(function (u) { URL.revokeObjectURL(u); });
    S.urls = [];
  }

  async function fillImages(root) {
    const imgs = root.querySelectorAll('img');
    for (const img of imgs) {
      const name = img.getAttribute('src');
      if (!name || /^(blob|data|https?):/.test(name)) continue;
      const blob = await SciStore.file(S.book.id, name);
      if (blob) {
        const u = URL.createObjectURL(blob);
        S.urls.push(u);
        img.src = u;
      } else {
        img.remove();
      }
    }
  }

  function mathReady() { return !!(window.MathJax && MathJax.typesetPromise); }

  const TEX_SYM = { alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ',
    eta: 'η', theta: 'θ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ',
    phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω', Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ',
    Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω', infty: '∞', partial: '∂', nabla: '∇', int: '∫', sum: '∑',
    prod: '∏', cdot: '·', times: '×', pm: '±', leq: '≤', le: '≤', geq: '≥', ge: '≥', neq: '≠', approx: '≈',
    to: '→', rightarrow: '→', hbar: 'ħ', sqrt: '√', ldots: '…', cdots: '⋯', propto: '∝', in: '∈' };
  function texToHtml(tex) {
    let h = esc(tex)
      .replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, '($1)/($2)')
      .replace(/\\(left|right|big|Big|mathrm|mathbf|mathit|text|operatorname|displaystyle)\b/g, '')
      .replace(/\\([A-Za-z]+)/g, function (m0, name) { return TEX_SYM[name] || name; })
      .replace(/\^\{([^{}]*)\}/g, '<sup>$1</sup>').replace(/_\{([^{}]*)\}/g, '<sub>$1</sub>')
      .replace(/\^(.)/g, '<sup>$1</sup>').replace(/_(.)/g, '<sub>$1</sub>')
      .replace(/\\[,;!: ]/g, ' ').replace(/[{}]/g, '');
    return h;
  }

  // MathJax yüklenemezse (ilk açılış internetsiz) formüller okunaklı düz yazıyla gösterilir.
  function plainMath(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) {
      if (/\\[\(\[]/.test(walker.currentNode.nodeValue)) nodes.push(walker.currentNode);
    }
    nodes.forEach(function (node) {
      const frag = document.createDocumentFragment();
      const re = /\\\(([\s\S]*?)\\\)|\\\[([\s\S]*?)\\\]/g;
      let last = 0, m;
      const text = node.nodeValue;
      while ((m = re.exec(text))) {
        if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
        const el = document.createElement(m[2] !== undefined ? 'div' : 'span');
        el.className = 'tex';
        el.innerHTML = texToHtml((m[1] !== undefined ? m[1] : m[2]).trim());
        frag.appendChild(el);
        last = re.lastIndex;
      }
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      node.parentNode.replaceChild(frag, node);
    });
  }

  function typeset(nodes) {
    if (mathReady()) return MathJax.typesetPromise(nodes).catch(function () {});
    const page = S.page;
    let waited = 0;
    const timer = setInterval(function () {
      waited += 250;
      if (S.page !== page) { clearInterval(timer); return; }
      if (mathReady()) { clearInterval(timer); MathJax.typesetPromise(nodes).catch(function () {}); }
      else if (waited >= 4000) { clearInterval(timer); nodes.forEach(plainMath); }
    }, 250);
    return Promise.resolve();
  }

  async function loadPage(i, startTime, play) {
    if (!S.man || i < 0 || i >= S.man.pages.length) return;
    audio.pause();
    revokeUrls();
    S.page = i;
    S.cur = -1;
    const p = S.man.pages[i];
    const head = '<div class="page-sep">— PDF SAYFA ' + p.n + ' —</div>';
    paneMain.innerHTML = head + (p.main || '<p class="empty">Bu sayfada seslendirilen metin yok.</p>');
    paneOther.innerHTML = head + (p.other || '<p class="empty">Bu sayfanın öbür dildeki metni yok.</p>');
    paneMain.scrollTop = 0;
    paneOther.scrollTop = 0;
    S.spans = [];
    paneMain.querySelectorAll('span.s').forEach(function (el) { S.spans[+el.dataset.s] = el; });
    S.times = p.sentences || [];
    await Promise.all([fillImages(paneMain), fillImages(paneOther)]);
    typeset([paneMain, paneOther]);
    $('page-select').value = i;
    $('r-sub').textContent = 'PDF s. ' + p.n + ' · ' + (i + 1) + '/' + S.man.pages.length +
      (S.man.audio_language ? ' · 🔊 ' + S.man.audio_language : '');
    if (p.audio) {
      const blob = await SciStore.file(S.book.id, p.audio);
      if (blob) {
        const u = URL.createObjectURL(blob);
        S.urls.push(u);
        audio.src = u;
        audio.playbackRate = S.rate;
        if (startTime) {
          const seekTo = startTime;
          audio.addEventListener('loadedmetadata', function once() {
            audio.removeEventListener('loadedmetadata', once);
            try { audio.currentTime = seekTo; } catch (e) {}
          });
        }
        if (play) playAudio();
      }
    } else {
      audio.removeAttribute('src');
      audio.load();
      if (play) setTimeout(function () { nextPage(true); }, 1200);
    }
    updateMediaSession();
    updateUi();
    savePosition();
  }

  function playAudio() {
    const pr = audio.play();
    if (pr && pr.catch) pr.catch(function () { updateUi(); });
  }

  function nextPage(play) {
    if (S.page + 1 < S.man.pages.length) loadPage(S.page + 1, 0, play);
    else { audio.pause(); toast('Paketin sonuna geldiniz.'); }
  }
  function prevPage(play) {
    if (S.page > 0) loadPage(S.page - 1, 0, play);
  }

  function sentenceAt(t) {
    const times = S.times;
    let lo = 0, hi = times.length - 1, found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const r = times[mid];
      if (!r) { // seslendirilemeyen cümle: doğrusal ara
        for (let k = 0; k < times.length; k++) {
          if (times[k] && times[k][0] <= t && t < (times[k + 1] ? times[k + 1][0] : Infinity)) return k;
        }
        return -1;
      }
      if (t < r[0]) hi = mid - 1;
      else { found = mid; lo = mid + 1; }
    }
    return found;
  }

  function highlight(k) {
    if (k === S.cur) return;
    if (S.cur >= 0 && S.spans[S.cur]) S.spans[S.cur].classList.remove('on');
    S.cur = k;
    const el = S.spans[k];
    if (!el) return;
    el.classList.add('on');
    if (!S.follow || Date.now() - S.userScrollAt < 4000) return;
    if (S.mode !== 'other') {
      const top = el.offsetTop - paneMain.offsetTop;
      const target = top - paneMain.clientHeight * 0.3;
      paneMain.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
    }
    if (S.mode !== 'main' && paneMain.scrollHeight > 0) {
      const ratio = (el.offsetTop - paneMain.offsetTop) / Math.max(1, paneMain.scrollHeight);
      const target = ratio * paneOther.scrollHeight - paneOther.clientHeight * 0.3;
      paneOther.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
    }
  }

  function tick() {
    S.raf = 0;
    highlight(sentenceAt(audio.currentTime));
    updateProgress();
    if (!audio.paused) S.raf = requestAnimationFrame(tick);
  }

  function seekSentence(delta) {
    let k = S.cur;
    if (k < 0) k = sentenceAt(audio.currentTime);
    k += delta;
    while (k >= 0 && k < S.times.length && !S.times[k]) k += delta > 0 ? 1 : -1;
    if (k < 0) { audio.currentTime = 0; return; }
    if (k >= S.times.length) { nextPage(!audio.paused); return; }
    audio.currentTime = S.times[k][0];
    highlight(k);
  }

  function updateProgress() {
    const d = audio.duration || (S.man && S.man.pages[S.page] ? S.man.pages[S.page].duration : 0) || 0;
    $('t-cur').textContent = fmt(audio.currentTime);
    $('t-dur').textContent = fmt(d);
    if (!S.seeking) $('seek').value = d ? Math.round(1000 * audio.currentTime / d) : 0;
  }

  function updateUi() {
    $('btn-play').textContent = audio.paused ? '▶' : '❚❚';
    $('btn-rate').textContent = (S.rate === 1 ? '1' : String(S.rate).replace('.', ',')) + '×';
    updateProgress();
  }

  function setMode(mode) {
    S.mode = mode;
    setPref('mode', mode);
    const v = $('views');
    v.classList.remove('mode-main', 'mode-split', 'mode-other');
    v.classList.add('mode-' + mode);
    document.querySelectorAll('#seg-mode button').forEach(function (b) {
      b.classList.toggle('on', b.dataset.mode === mode);
    });
    if (S.cur >= 0) { const k = S.cur; S.cur = -1; highlight(k); }
  }

  function setFont(px) {
    px = Math.max(14, Math.min(30, px));
    document.documentElement.style.setProperty('--font', px + 'px');
    setPref('font', px);
  }

  function setSleep(min) {
    clearTimeout(S.sleepTimer);
    S.sleepTimer = null;
    S.sleepAtPageEnd = min === -1;
    let label = '';
    if (min > 0) {
      const until = Date.now() + min * 60000;
      S.sleepTimer = setTimeout(function () { audio.pause(); toast('Uyku zamanlayıcı: durduruldu.'); setSleep(0); },
        min * 60000);
      label = '☾ ' + new Date(until).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
    } else if (min === -1) {
      label = '☾ sayfa sonu';
    }
    $('sleep-badge').textContent = label;
    document.querySelectorAll('#seg-sleep button').forEach(function (b) {
      b.classList.toggle('on', +b.dataset.min === min);
    });
  }

  async function savePosition() {
    if (!S.book) return;
    const pos = { page: S.page, time: audio.currentTime || 0 };
    S.book.pos = pos;
    try { await SciStore.savePos(S.book.id, pos); } catch (e) {}
  }

  function updateMediaSession() {
    if (!('mediaSession' in navigator) || !S.man) return;
    const p = S.man.pages[S.page];
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: S.man.title + ' — s. ' + p.n,
        artist: 'SciLex AI' + (S.man.audio_language ? ' · ' + S.man.audio_language : ''),
        album: S.man.title,
        artwork: [{ src: 'icon-512.png', sizes: '512x512', type: 'image/png' }]
      });
    } catch (e) {}
  }

  function setupMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    const h = {
      play: function () { playAudio(); },
      pause: function () { audio.pause(); },
      previoustrack: function () { prevPage(true); },
      nexttrack: function () { nextPage(true); },
      seekbackward: function () { seekSentence(-1); },
      seekforward: function () { seekSentence(1); }
    };
    Object.keys(h).forEach(function (k) { try { ms.setActionHandler(k, h[k]); } catch (e) {} });
  }

  // ------------------------------------------------------------ olaylar
  function bind() {
    $('file').addEventListener('change', function (ev) {
      importFile(ev.target.files[0]);
      ev.target.value = '';
    });
    $('btn-back').addEventListener('click', showLibrary);
    $('btn-menu').addEventListener('click', function () { $('menu').classList.toggle('hidden'); });
    document.addEventListener('click', function (ev) {
      const m = $('menu');
      if (!m.classList.contains('hidden') && !m.contains(ev.target) && ev.target !== $('btn-menu')) {
        m.classList.add('hidden');
      }
    });
    $('btn-play').addEventListener('click', function () {
      if (!audio.getAttribute('src')) { nextPage(true); return; }
      if (audio.paused) playAudio(); else audio.pause();
    });
    $('btn-prev').addEventListener('click', function () { prevPage(!audio.paused); });
    $('btn-next').addEventListener('click', function () { nextPage(!audio.paused); });
    $('btn-back10').addEventListener('click', function () { seekSentence(-1); });
    $('btn-fwd10').addEventListener('click', function () { seekSentence(1); });
    $('btn-rate').addEventListener('click', function () {
      const i = RATES.indexOf(S.rate);
      S.rate = RATES[(i + 1) % RATES.length];
      audio.playbackRate = S.rate;
      setPref('rate', S.rate);
      updateUi();
    });
    const seek = $('seek');
    seek.addEventListener('input', function () { S.seeking = true; });
    seek.addEventListener('change', function () {
      S.seeking = false;
      if (audio.duration) audio.currentTime = audio.duration * seek.value / 1000;
    });
    document.querySelectorAll('#seg-mode button').forEach(function (b) {
      b.addEventListener('click', function () { if (!b.disabled) setMode(b.dataset.mode); });
    });
    document.querySelectorAll('#seg-sleep button').forEach(function (b) {
      b.addEventListener('click', function () { setSleep(+b.dataset.min); });
    });
    $('font-inc').addEventListener('click', function () { setFont(pref('font', 19) + 1); });
    $('font-dec').addEventListener('click', function () { setFont(pref('font', 19) - 1); });
    $('follow').addEventListener('change', function (ev) { S.follow = ev.target.checked; setPref('follow', S.follow); });
    $('page-select').addEventListener('change', function (ev) {
      loadPage(+ev.target.value, 0, !audio.paused);
      $('menu').classList.add('hidden');
    });
    paneMain.addEventListener('click', function (ev) {
      const s = ev.target.closest('span.s');
      if (!s) return;
      const k = +s.dataset.s;
      if (S.times[k]) {
        audio.currentTime = S.times[k][0];
        highlight(k);
        if (audio.paused) playAudio();
      }
    });
    ['touchstart', 'wheel'].forEach(function (evn) {
      [paneMain, paneOther].forEach(function (p) {
        p.addEventListener(evn, function () { S.userScrollAt = Date.now(); }, { passive: true });
      });
    });
    audio.addEventListener('play', function () { updateUi(); if (!S.raf) S.raf = requestAnimationFrame(tick); });
    audio.addEventListener('pause', function () { updateUi(); savePosition(); });
    audio.addEventListener('timeupdate', function () { if (document.hidden) { highlight(sentenceAt(audio.currentTime)); } updateProgress(); });
    audio.addEventListener('ended', function () {
      if (S.sleepAtPageEnd) { setSleep(0); toast('Sayfa sonu: durduruldu.'); savePosition(); return; }
      nextPage(true);
    });
    audio.addEventListener('error', function () { if (audio.getAttribute('src')) toast('Ses çalınamadı.'); });
    document.addEventListener('visibilitychange', function () { if (document.hidden) savePosition(); });
    setInterval(function () { if (!audio.paused) savePosition(); }, 5000);
    window.addEventListener('keydown', function (ev) {
      if (!S.book || ev.target.tagName === 'SELECT') return;
      if (ev.key === ' ') { ev.preventDefault(); $('btn-play').click(); }
      else if (ev.key === 'ArrowRight') seekSentence(1);
      else if (ev.key === 'ArrowLeft') seekSentence(-1);
    });
  }

  async function checkShared() {
    // Android: WhatsApp'tan "Paylaş › SciLex Okuyucu" ile gelen dosya (service worker saklar).
    if (!('caches' in window) || location.search.indexOf('share') < 0) return;
    try {
      const cache = await caches.open('scilex-share');
      const res = await cache.match('shared-file');
      if (res) {
        const blob = await res.blob();
        await cache.delete('shared-file');
        await importFile(blob);
      }
    } catch (e) {}
    history.replaceState(null, '', location.pathname);
  }

  async function init() {
    S.rate = pref('rate', 1);
    S.follow = pref('follow', true);
    $('follow').checked = S.follow;
    setFont(pref('font', 19));
    setSleep(0);
    bind();
    setupMediaSession();
    if ('serviceWorker' in navigator && location.protocol === 'https:') {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    }
    await showLibrary();
    await checkShared();
  }

  window.SciReader = { openBook: openBook, importFile: importFile, state: S };
  init();
})();

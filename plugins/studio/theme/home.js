// studio layout for the cooked. page: a create-first Home and a slim sidebar. Loaded in <head> by review.py themed()
// when this file exists; home.html calls studioHero() where its own Home heading was.
(function () {
  try { if (localStorage.getItem('ave-rail') === null) localStorage.setItem('ave-rail', '1'); } catch (e) {}   // the slim sidebar, until the user opens it

  var LENS = [[30, '30 s'], [60, '60 s'], [180, '3 min'], [300, '5 min']];
  var hero = { text: '', len: 60 };
  window.studioHeroState = hero;

  // Go: the New video panel opens already filled in. Nothing starts until the user presses its own button.
  window.studioGo = function () {
    var t = (hero.text || '').trim();
    var box = document.getElementById('cfq');
    if (t.length < 8) { if (box) { box.focus(); box.classList.add('shake'); setTimeout(function () { box.classList.remove('shake'); }, 500); } return; }
    rgo('new');
    if (hero.len > 90) { setKind('long'); nv.long.text = t; nv.long.minutes = Math.round(hero.len / 60); }
    else { setKind('prompt'); nv.prompt.text = t; nv.prompt.length = hero.len; }
    hero.text = '';
    render();
  };
  window.studioKind = function (k) { rgo('new'); setKind(k); render(); };
  window.studioLen = function (n) { hero.len = n; render(); };

  window.studioHero = function (vids) {
    var kinds = KINDS.map(function (k) {
      return '<button class="cf-kind" onclick="studioKind(\'' + k[0] + '\')"><span class="cf-art"><svg viewBox="0 0 120 64" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        KART[k[0]] + '</svg></span><b>' + esc(k[1]) + '</b><span class="cf-sub">' + esc(k[2]) + '</span></button>';
    }).join('');
    var lens = LENS.map(function (l) {
      return '<button class="pill ' + (hero.len === l[0] ? 'on' : '') + '" onclick="studioLen(' + l[0] + ')">' + l[1] + '</button>';
    }).join('');
    return '<div class="cf"><h1>What do you want to make?</h1>' +
      '<p class="cf-lede">' + (vids && vids.length ? esc(vSum(vids)) : 'Describe it, or pick a kind of video below.') + '</p>' +
      '<div class="cf-box"><textarea id="cfq" rows="2" placeholder="Describe a video. For example: how a black hole forms, for curious teenagers" ' +
      'oninput="studioHeroState.text=this.value" onkeydown="if(event.key===\'Enter\'&&(event.metaKey||event.ctrlKey)){event.preventDefault();studioGo()}">' + esc(hero.text) + '</textarea>' +
      '<div class="cf-row"><div class="cf-lens"><span class="cf-lab">Length</span>' + lens + '</div>' +
      '<button class="b1 cf-go" onclick="studioGo()">Create video</button></div></div>' +
      '<div class="cf-kinds">' + kinds + '</div></div>';
  };

  // a redraw of the page must not take the box out from under someone typing in it
  var had = false, sel = 0;
  document.addEventListener('focusin', function (e) { had = e.target && e.target.id === 'cfq'; });
  document.addEventListener('focusout', function (e) { if (e.target && e.target.id === 'cfq') { sel = e.target.selectionStart || 0; setTimeout(function () { var b = document.getElementById('cfq'); if (had && b && document.activeElement === document.body) { b.focus(); try { b.setSelectionRange(sel, sel); } catch (x) {} } }, 0); } });
  document.addEventListener('mousedown', function (e) { if (!(e.target && e.target.id === 'cfq')) had = false; }, true);
})();

// ============================================================ icons, the Library section, the bell, the Claude account
(function () {
  var get = function (u) { return fetch(u, { credentials: 'same-origin' }).then(function (r) { return r.json(); }); };
  var send = function (u, b) { return fetch(u, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }).then(function (r) { return r.json(); }); };
  var redraw = function () { try { ui.forceR = true; render(); } catch (e) {} };

  // ---- one icon set, drawn on the same grid with the same weight
  var ICONS = {
    home: '<path d="M3.5 10.8 12 3.5l8.5 7.3"/><path d="M5.5 9.6V19a1.5 1.5 0 0 0 1.5 1.5h2.8v-5.6h4.4v5.6H17a1.5 1.5 0 0 0 1.5-1.5V9.6"/>',
    videos: '<rect x="3" y="4.5" width="18" height="15" rx="3.5"/><path d="m10.2 9.2 4.6 2.8-4.6 2.8z" fill="currentColor" stroke-width="1.2"/>',
    styles: '<path d="m11 3.5 1.9 4.9 4.9 1.9-4.9 1.9L11 17.1l-1.9-4.9-4.9-1.9 4.9-1.9z"/><path d="m18.3 15.3.8 2.1 2.1.8-2.1.8-.8 2.1-.8-2.1-2.1-.8 2.1-.8z"/>',
    brand: '<path d="M12 3.2c3.3 3.7 5.7 6.5 5.7 9.6a5.7 5.7 0 0 1-11.4 0c0-3.1 2.4-5.9 5.7-9.6z"/><path d="M9.3 13.4a2.8 2.8 0 0 0 2.2 2.6"/>',
    skill: '<path d="M13.2 2.8 5 13.6h5.8l-1 7.6 8.2-10.8h-5.8z"/>',
    library: '<path d="M12 2.8 20.2 7v10L12 21.2 3.8 17V7z"/><path d="M3.8 7 12 11.2 20.2 7M12 11.2v10"/>',
    term: '<path d="M3 12h3.8l2.4-6.6 4.8 13.2 2.4-6.6H21"/>',
    gear: '<path d="M4 7.5h9.2M17.6 7.5H20M4 16.5h2.4M10.8 16.5H20"/><circle cx="15.4" cy="7.5" r="2.2"/><circle cx="8.6" cy="16.5" r="2.2"/>',
    bell: '<path d="M6.2 16.4V11a5.8 5.8 0 1 1 11.6 0v5.4l1.6 2.1H4.6z"/><path d="M10 20.6a2.1 2.1 0 0 0 4 0"/>'
  };
  document.addEventListener('DOMContentLoaded', function () {
    try { for (var k in ICONS) IC[k] = ICONS[k]; } catch (e) {}
    var fav = document.querySelector('link[rel=icon]');
    if (fav) fav.href = "data:image/svg+xml," + encodeURIComponent(LOGO.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" '));
    bellMount();
    redraw();
  });
  // the mark: a frame with a play head cut out of it
  var LOGO = '<svg viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="fwg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5C92FF"/><stop offset="1" stop-color="#2A62E8"/></linearGradient></defs>' +
    '<rect width="64" height="64" rx="15" fill="url(#fwg)"/><path d="M19 22a5 5 0 0 1 5-5h9M45 42a5 5 0 0 1-5 5h-9M19 31v11a5 5 0 0 0 5 5M45 33V22a5 5 0 0 0-5-5" fill="none" stroke="#fff" stroke-width="4.2" stroke-linecap="round"/>' +
    '<path d="M27.5 24.5 40 32l-12.5 7.5z" fill="#fff"/></svg>';
  window.studioLogo = LOGO;

  // ---- Library: a section of the app, not a window
  var lib = { d: null, tab: 'worlds', at: 0 };
  function libLoad() { lib.at = Date.now(); get('/studio/library?json=1').then(function (d) { lib.d = d; redraw(); }).catch(function () {}); }
  window.studioLibTab = function (t) { lib.tab = t; redraw(); };
  window.studioLibraryView = function () {
    if (!lib.d || Date.now() - lib.at > 15000) libLoad();
    var d = lib.d || { worlds: [], characters: [], props: [] };
    var TABS = [['worlds', 'Worlds', 'Places built once in detail. A script set in one of these uses it as it is.'],
      ['characters', 'Characters', 'People and figures. Ask for any movement by name and it is fetched.'],
      ['props', 'Props', 'Free models fetched the first time a world needs one, then kept.']];
    var cur = TABS.filter(function (t) { return t[0] === lib.tab; })[0] || TABS[0];
    var tabs = TABS.map(function (t) { return '<button class="' + (t[0] === cur[0] ? 'on' : '') + '" onclick="studioLibTab(\'' + t[0] + '\')">' + t[1] + ' <i>' + d[t[0]].length + '</i></button>'; }).join('');
    var cards = d[cur[0]].map(function (x) {
      var foot = x.moves ? x.moves.join(' · ') + (x.outfit ? ' · any outfit colour' : '') : x.textures ? 'textures only' : '';
      return '<div class="lb-card"><div class="lb-pic"' + (x.pic ? ' style="background-image:url(\'' + esc(x.pic) + '\')"' : '') + '>' + (x.pic ? '' : '<span>' + esc((x.name || '?').slice(0, 1).toUpperCase()) + '</span>') + '</div>' +
        '<b>' + esc(x.name) + '</b><p>' + esc(x.text || '') + '</p>' + (foot ? '<em>' + esc(foot) + '</em>' : '') + '</div>';
    }).join('');
    return '<div class="pgc"><div class="ph"><h1>Library</h1><p>Everything a 3D video can reuse. A new place is built once, then kept here for every later video.</p></div>' +
      '<div class="lb-tabs">' + tabs + '</div><p class="lb-note">' + cur[2] + '</p>' +
      '<div class="lb-grid lb-' + cur[0] + '">' + (cards || '<div class="none">' + (lib.d ? 'Nothing here yet.' : 'Loading…') + '</div>') + '</div></div>';
  };

  // ---- the Claude account that does the editing (Settings)
  var acct = { d: null, at: 0, busy: false };
  function acctLoad() { acct.at = Date.now(); get('/studio/claude').then(function (d) { var was = JSON.stringify(acct.d); acct.d = d; if (was !== JSON.stringify(d)) redraw(); if (d.signing_in && !d.loggedIn) setTimeout(acctLoad, 2500); }).catch(function () {}); }
  window.studioClaude = function (what) {
    if (what === 'logout' && !confirm('Sign this computer out of Claude? Videos cannot be made until someone signs in again.')) return;
    acct.busy = true; redraw();
    send('/studio/claude', { 'do': what }).then(function () { acct.busy = false; setTimeout(acctLoad, what === 'login' ? 1500 : 300); });
  };
  window.studioClaudeCard = function () {
    if (!acct.d || Date.now() - acct.at > 20000) acctLoad();
    var d = acct.d, body;
    if (!d) body = '<div class="t2">Checking…</div>';
    else if (!d.installed) body = '<div class="t2" style="white-space:normal">Claude Code is not installed on this computer. Open Framewise again and its setup screen installs it.</div>';
    else if (d.loggedIn) body = '<div class="fw-acct"><span class="fw-ava">' + esc((d.email || 'C').slice(0, 1).toUpperCase()) + '</span><div style="min-width:0"><div class="t1">' + esc(d.email || 'Signed in') + '</div>' +
      '<div class="t2">' + esc([d.plan ? 'Claude ' + d.plan.charAt(0).toUpperCase() + d.plan.slice(1) : '', d.org].filter(Boolean).join(' · ')) + '</div></div>' +
      '<span class="st-state ok" style="margin-left:auto">Connected</span></div>' +
      '<div class="row" style="gap:8px"><button class="b2 s" onclick="studioClaude(\'login\')">Switch account</button><button class="b2 s" onclick="studioClaude(\'logout\')">Sign out</button></div>';
    else body = '<div class="t2" style="white-space:normal">' + (d.signing_in ? 'Finish signing in on the page that opened in your browser. This card updates by itself.' :
      'Sign in with your own Claude account. Your browser opens on Claude\'s sign-in page; nothing is typed here.') + '</div>' +
      '<div class="row"><button class="b1" ' + (acct.busy ? 'disabled' : '') + ' onclick="studioClaude(\'login\')">' + (d.signing_in ? 'Open the sign-in page again' : 'Connect Claude') + '</button></div>';
    return '<div class="scd" style="gap:14px"><div class="hd"><b>Claude account</b><span class="st-lock">Does the editing</span></div>' + body + '</div>';
  };

  // ---- the bell: what needs you, quietly. Claude's question opens from here, never over the whole window.
  var bell = { open: false, last: '', seen: {} };
  try { bell.seen = JSON.parse(localStorage.getItem('fw-seen') || '{}'); } catch (e) {}
  function asking() { var a = document.getElementById('askq'); return !!(a && a.classList.contains('on')); }
  function items() {
    var out = [];
    if (asking()) out.push({ id: 'ask', kind: 'ask', t: 'A question about your video', s: 'Answer it to carry on', js: "studioAsk()" });
    try {
      (L && L.videos || []).forEach(function (v) {
        var ph = vPh(v), words = { cut: 'The cut is ready to check', approve: 'The preview is ready to approve', edit: 'The edit is ready to watch' }[ph];
        if (words) out.push({ id: v.dir + '|' + ph, kind: 'turn', t: v.name, s: words, js: 'studioBell(false);openVideo(' + JSON.stringify(v.dir).replace(/"/g, '&quot;') + ')' });
      });
      var ji = jobInfo();
      if (ji) out.push({ id: 'job', kind: 'job', t: ji.label, s: ji.text, js: 'studioBell(false);' + ji.go });
    } catch (e) {}
    return out;
  }
  window.studioAsk = function () { document.body.classList.add('fw-ask'); studioBell(false); };
  window.studioBell = function (on) {
    bell.open = on === undefined ? !bell.open : !!on;
    if (bell.open) { items().forEach(function (i) { bell.seen[i.id] = 1; }); try { localStorage.setItem('fw-seen', JSON.stringify(bell.seen)); } catch (e) {} }
    bell.last = ''; bellDraw();
  };
  function bellDraw() {
    var el = document.getElementById('fw-bell'); if (!el) return;
    var it = items(), fresh = it.filter(function (i) { return i.kind === 'ask' || (i.kind === 'turn' && !bell.seen[i.id]); }).length;
    if (!asking()) document.body.classList.remove('fw-ask');
    var html = '<button class="fw-bell-b' + (fresh ? ' ring' : '') + '" title="Notifications" aria-label="Notifications" onclick="studioBell()">' +
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + ICONS.bell + '</svg>' + (fresh ? '<i>' + fresh + '</i>' : '') + '</button>' +
      (bell.open ? '<div class="fw-pop"><div class="fw-pop-h">Notifications</div>' + (it.map(function (i) {
        return '<button class="fw-it ' + i.kind + '" onclick="' + i.js + '"><span class="fw-dot"></span><span><b>' + esc(i.t || '') + '</b><em>' + esc(i.s || '') + '</em></span></button>';
      }).join('') || '<div class="fw-none">Nothing needs you right now.</div>') + '</div>' : '');
    if (html !== bell.last) { el.innerHTML = html; bell.last = html; }
  }
  function bellMount() {
    var el = document.createElement('div'); el.id = 'fw-bell'; document.body.appendChild(el);
    setInterval(bellDraw, 1200); bellDraw();
    document.addEventListener('mousedown', function (e) { if (bell.open && !el.contains(e.target)) studioBell(false); if (document.body.classList.contains('fw-ask')) { var a = document.getElementById('askq'); if (a && e.target === a) document.body.classList.remove('fw-ask'); } });
  }
})();

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

  // ---- Home: one box. What is in it decides what it does.
  //   words            -> an animated video (up to 60 s) or a long video, at the length picked
  //   video files      -> Edit my clips, with the words as a note for the edit
  //   a link           -> Make one like this, or Clip it into shorts
  var URLRE = /^https?:\/\/\S+$/i;
  function mode() { var t = (hero.text || '').trim(); return URLRE.test(t) ? 'link' : 'text'; }
  function rowHTML() {
    if (mode() === 'link') {
      return '<div class="cf-hint">A link. What should happen with it?</div><div class="cf-acts"><button class="b2 cf-go" onclick="studioLink(\'stream\')">Clip it into shorts</button>' +
        '<button class="b1 cf-go" onclick="studioLink(\'like\')">Make one like this</button></div>';
    }
    var lens = LENS.map(function (l) { return '<button class="pill ' + (hero.len === l[0] ? 'on' : '') + '" onclick="studioLen(' + l[0] + ')">' + l[1] + '</button>'; }).join('');
    return '<div class="cf-lens"><label class="cf-add" title="Add your clips"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11.5 12.4 19a5 5 0 0 1-7-7l8-8a3.4 3.4 0 0 1 4.8 4.8l-8 8a1.8 1.8 0 0 1-2.5-2.5l7.3-7.3"/></svg>Add clips' +
      '<input type="file" multiple accept="video/*,.mov,.mkv,.mp4" class="hide" onchange="var f=[].slice.call(this.files);this.value=\'\';studioFiles(f)"></label>' +
      '<span class="cf-sep"></span><span class="cf-lab">Length</span>' + lens + '</div><button class="b1 cf-go" onclick="studioGo()">Create video</button>';
  }
  window.studioTyped = function (el) { var was = mode(); hero.text = el.value; if (mode() !== was) { var r = document.getElementById('cf-row'); if (r) r.innerHTML = rowHTML(); } };
  window.studioLen = function (n) { hero.len = n; var r = document.getElementById('cf-row'); if (r) r.innerHTML = rowHTML(); };
  // your own clips: the same path as the old drop zone (New video, Edit my clips), carrying what you typed as the note
  window.studioFiles = function (files) {
    files = [].slice.call(files || []).filter(function (f) { return /^video\//.test(f.type) || /\.(mov|mp4|m4v|mkv|webm|avi)$/i.test(f.name); });
    if (!files.length) { try { toast('Drop video files here. Pictures and links go in on the next screen.'); } catch (e) {} return; }
    var note = (hero.text || '').trim();
    rgo('new'); setKind('clips');
    if (note && !URLRE.test(note)) nv.note = note;
    hero.text = '';
    chooseFiles(files);
  };
  window.studioLink = function (kind) {
    var u = (hero.text || '').trim(); hero.text = '';
    rgo('new'); setKind(kind);
    if (kind === 'like') nv.like.link = u; else nv.stream.links = u;
    render();
  };
  window.studioDrag = function (e, on) {
    if (e.dataTransfer && [].indexOf.call(e.dataTransfer.types || [], 'Files') < 0) return;
    e.preventDefault(); e.stopPropagation();
    var b = document.getElementById('cf-box'); if (b) b.classList.toggle('over', !!on);
    if (on === 'drop') { if (b) b.classList.remove('over'); studioFiles(e.dataTransfer.files); }
  };
  // topic ideas: the app goes on YouTube for a niche and shows what people are watching on it
  var ideas = { open: false, niche: '', busy: false, d: null };
  var post = function (u, b) { return fetch(u, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }).then(function (r) { return r.json(); }); };
  window.studioIdeas = function (on) { ideas.open = on; render(); if (on) setTimeout(function () { var i = document.getElementById('cf-niche'); if (i) i.focus(); }, 30); };
  window.studioIdeasFind = function () {
    var i = document.getElementById('cf-niche'); ideas.niche = (i ? i.value : ideas.niche).trim();
    if (ideas.niche.length < 3) return;
    ideas.busy = true; ideas.d = null; render();
    post('/studio/ideas', { niche: ideas.niche }).then(function (d) { ideas.busy = false; ideas.d = d; render(); }).catch(function () { ideas.busy = false; ideas.d = { ok: false, msg: 'That did not work. Try again.' }; render(); });
  };
  window.studioIdeaUse = function (k) {
    var x = ideas.d && ideas.d.ideas[k]; if (!x) return;
    hero.text = x.title; hero.len = Math.max(hero.len || 0, 180); ideas.open = false; render();
    setTimeout(function () { var b = document.getElementById('cfq'); if (b) { b.focus(); b.select(); } }, 30);
  };
  function fmtViews(n) { return n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'K' : String(n); }
  function ideasHTML() {
    if (!ideas.open) return '<button class="cf-wait" style="margin-top:10px" onclick="studioIdeas(true)">Not sure what to make?<span>Find topics people are watching</span></button>';
    var d = ideas.d;
    var list = !d ? '' : !d.ok ? '<p class="cf-idea-msg">' + esc(d.msg || '') + '</p>' : '<div class="cf-ideas">' + d.ideas.map(function (x, k) {
      return '<button class="cf-idea" onclick="studioIdeaUse(' + k + ')"><b>' + esc(x.title) + '</b><span>' + fmtViews(x.views) + ' views · ' + esc(x.by) + ' · ' + x.minutes + ' min' + (x['new'] ? ' · recent' : '') + '</span></button>';
    }).join('') + '</div><p class="cf-idea-msg">Pick one to start from its topic. Your video is researched and written fresh; nothing is copied from theirs.</p>';
    return '<div class="cf-ideabox"><div class="cf-idearow"><input id="cf-niche" class="input" placeholder="A niche: space, Bollywood, personal finance, fitness…" value="' + esc(ideas.niche) + '" onkeydown="if(event.key===\'Enter\')studioIdeasFind()">' +
      '<button class="b1" onclick="studioIdeasFind()"' + (ideas.busy ? ' disabled' : '') + '>' + (ideas.busy ? 'Looking on YouTube…' : 'Find topics') + '</button><button class="b2" onclick="studioIdeas(false)">Close</button></div>' + list + '</div>';
  }
  window.studioHome = function (vids) {
    var kinds = KINDS.map(function (k) {
      return '<button class="cf-kind" onclick="studioKind(\'' + k[0] + '\')"><span class="cf-art"><svg viewBox="0 0 120 64" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        KART[k[0]] + '</svg></span><b>' + esc(k[1]) + '</b><span class="cf-sub">' + esc(k[2]) + '</span></button>';
    }).join('');
    var waiting = 0; try { waiting = (vids || []).filter(function (v) { return ['cut', 'approve', 'edit', 'ask'].indexOf(vPh(v)) >= 0; }).length; } catch (e) {}
    return '<div class="pgc cf-home" ondragover="studioDrag(event, true)" ondragleave="studioDrag(event, false)" ondrop="studioDrag(event, \'drop\')"><div class="cf">' +
      '<h1>What do you want to make?</h1>' +
      '<p class="cf-lede">Describe a video, drop in your clips, or paste a link.</p>' +
      '<div class="cf-box" id="cf-box"><textarea id="cfq" rows="2" placeholder="A 60 second explainer on how black holes form…" ' +
      'oninput="studioTyped(this)" onkeydown="if(event.key===\'Enter\'&&(event.metaKey||event.ctrlKey)){event.preventDefault();if(!/^https?:/i.test(this.value.trim()))studioGo()}">' + esc(hero.text) + '</textarea>' +
      '<div class="cf-row" id="cf-row">' + rowHTML() + '</div><div class="cf-drop">Drop your clips to edit them</div></div>' +
      (waiting ? '<button class="cf-wait" onclick="rgo(\'videos\')"><i></i>' + waiting + ' video' + (waiting === 1 ? ' is' : 's are') + ' waiting for you<span>Open Videos</span></button>' : '') +
      (window.studioResLine ? window.studioResLine() : '') +
      ideasHTML() +
      '<div class="cf-kinds">' + kinds + '</div></div></div>';
  };
  window.studioHero = window.studioHome;

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
  // the clip downloader: a link and a from/to time become a clip kept in the library
  var clips = { d: null, at: 0, f: { url: '', start: '', end: '' }, msg: '' };
  function clipsLoad() { clips.at = Date.now(); get('/studio/clips').then(function (d) { var was = JSON.stringify(clips.d); clips.d = d; if (was !== JSON.stringify(d)) redraw(); if (d.busy && d.busy.length) setTimeout(clipsLoad, 3000); }).catch(function () {}); }
  window.studioClipSet = function (k, v) { clips.f[k] = v; };
  window.studioClipGet = function () {
    clips.msg = '';
    send('/studio/clips', clips.f).then(function (r) { if (!r.ok) { clips.msg = r.msg || 'That did not start.'; redraw(); return; } clips.f = { url: '', start: '', end: '' }; clipsLoad(); redraw(); });
  };
  window.studioClipCopy = function (p) { try { navigator.clipboard.writeText(p); } catch (e) {} };
  function clipsView() {
    if (!clips.d || Date.now() - clips.at > 15000) clipsLoad();
    var d = clips.d || { clips: [], busy: [], last: '' }, f = clips.f;
    var inp = function (k, ph, w) { return '<input class="input" style="height:40px;min-height:40px;padding:0 12px;font-family:inherit;' + (w ? 'width:' + w + 'px;flex:none' : 'flex:1') + '" placeholder="' + ph + '" value="' + esc(f[k]) + '" oninput="studioClipSet(\'' + k + '\', this.value)">'; };
    var rows = d.clips.map(function (c) {
      return '<div class="lb-card"><div class="lb-pic"><span>▶</span></div><b>' + esc(c.title) + '</b><p>' + esc(c.by || '') + (c.seconds ? ' · ' + Math.round(c.seconds) + ' s' : '') + ' · ' + c.mb + ' MB</p>' +
        '<em><button class="hlink" style="font-size:12px" onclick="studioClipCopy(' + J(c.path) + ')">Copy its path</button></em></div>';
    }).join('');
    return '<div class="fw-clipform"><div class="row" style="gap:8px;align-items:center">' + inp('url', 'Paste a video link (YouTube, Vimeo, X, TikTok…)') + inp('start', 'From 1:20', 110) + inp('end', 'To 1:45', 110) +
      '<button class="b1" onclick="studioClipGet()">Download clip</button></div>' +
      (clips.msg || d.last ? '<div class="msg bad" style="margin-top:8px"><span>' + esc(clips.msg || d.last) + '</span></div>' : '') +
      (d.busy.length ? '<p class="lb-note">Downloading ' + d.busy.length + ' clip' + (d.busy.length > 1 ? 's' : '') + '…</p>' : '') +
      '<p class="lb-note">Clips are saved in your library\'s clips folder with where they came from. To use them in a Long video, put that folder in "Your own clips". Publishing other people\'s footage is your call. <button class="hlink" style="font-size:12px" onclick="send(\'/studio/clips/reveal\', {})">Show the folder</button></p></div>' +
      '<div class="lb-grid lb-props">' + (rows || '<div class="none">' + (clips.d ? 'No clips yet.' : 'Loading…') + '</div>') + '</div>';
  }
  window.studioLibraryView = function () {
    if (!lib.d || Date.now() - lib.at > 15000) libLoad();
    var d = lib.d || { worlds: [], characters: [], props: [] };
    var TABS = [['worlds', 'Worlds', 'Places built once in detail. A script set in one of these uses it as it is.'],
      ['characters', 'Characters', 'People and figures. Ask for any movement by name and it is fetched.'],
      ['props', 'Props', 'Free models fetched the first time a world needs one, then kept.'],
      ['clips', 'Clip downloader', 'Cut a moment out of any video by its link. No more hunting and trimming by hand.']];
    var cur = TABS.filter(function (t) { return t[0] === lib.tab; })[0] || TABS[0];
    var tabs = TABS.map(function (t) { return '<button class="' + (t[0] === cur[0] ? 'on' : '') + '" onclick="studioLibTab(\'' + t[0] + '\')">' + t[1] + (d[t[0]] ? ' <i>' + d[t[0]].length + '</i>' : '') + '</button>'; }).join('');
    if (cur[0] === 'clips') return '<div class="pgc"><div class="ph"><h1>Library</h1><p>Everything your videos can reuse.</p></div><div class="lb-tabs">' + tabs + '</div><p class="lb-note">' + cur[2] + '</p>' + clipsView() + '</div>';
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
  function asking() { var a = document.getElementById('askq'); return !!(a && (a.classList.contains('on') || a.querySelector('.aq-opt, #asko'))); }   // a question the video's own page also has is drawn but not opened: it still counts
  function items() {
    var out = [];
    if (asking()) out.push({ id: 'ask', kind: 'ask', t: 'A question about your video', s: 'Answer it to carry on', js: "studioAsk()" });
    var wt = document.getElementById('askterm');   // the assistant is waiting on something only it can show: Activity has the way in
    if (wt && wt.classList.contains('on')) { var sp = wt.querySelector('span'); out.push({ id: 'wait|' + (sp ? sp.textContent : ''), kind: 'ask', t: 'A video is waiting for you', s: sp ? sp.textContent.replace(/^Claude asked: /, '') : 'Open Activity to carry on', js: "studioBell(false);rgo('claude')" }); }
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
  window.studioAsk = function () { document.body.classList.add('fw-ask'); if (window.askOpen) window.askOpen(); studioBell(false); };
  window.studioBell = function (on) {
    bell.open = on === undefined ? !bell.open : !!on;
    if (bell.open) { items().forEach(function (i) { bell.seen[i.id] = 1; }); try { localStorage.setItem('fw-seen', JSON.stringify(bell.seen)); } catch (e) {} }
    bell.last = ''; bellDraw();
  };
  function fresh() { return items().filter(function (i) { return i.kind === 'ask' || (i.kind === 'turn' && !bell.seen[i.id]); }).length; }
  var BELL = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS.bell + '</svg>';
  // the sidebar draws this where its own items are, so it can never sit on top of one
  window.studioBellSlot = function (rail) {
    var n = fresh(), badge = n ? '<i class="fw-badge">' + n + '</i>' : '';
    return rail ? '<button id="fw-bellb" class="rl-it fw-bellb' + (n ? ' ring' : '') + (bell.open ? ' on' : '') + '" onclick="studioBell()" title="Notifications"><span class="ic">' + BELL + badge + '</span>Alerts</button>'
      : '<button id="fw-bellb" class="sb-row fw-bellb' + (n ? ' ring' : '') + (bell.open ? ' on' : '') + '" onclick="studioBell()">' + BELL + '<span class="lb">Notifications</span>' + (n ? '<span class="fw-badge in">' + n + '</span>' : '') + '</button>';
  };
  function bellDraw() {
    var el = document.getElementById('fw-bell'); if (!el) return;
    var it = items(), n = fresh();
    if (!asking()) document.body.classList.remove('fw-ask');
    var html = bell.open ? '<div class="fw-pop"><div class="fw-pop-h">Notifications</div>' + (it.map(function (i) {
      return '<button class="fw-it ' + i.kind + '" onclick="' + i.js + '"><span class="fw-dot"></span><span><b>' + esc(i.t || '') + '</b><em>' + esc(i.s || '') + '</em></span></button>';
    }).join('') || '<div class="fw-none">Nothing needs you right now.</div>') + '</div>' : '';
    var key = html + '|' + n;
    if (key !== bell.last) {
      el.innerHTML = html; bell.last = key;
      try { paintSide(); } catch (e) {}                       // the badge on the sidebar's button
      try { if (window.webkit && webkit.messageHandlers && webkit.messageHandlers.app) webkit.messageHandlers.app.postMessage('badge:' + n); } catch (e) {}   // the Dock icon, in the app
    }
    if (bell.open) {   // beside the button, wherever the sidebar put it
      var b = document.getElementById('fw-bellb'), pop = el.firstChild;
      if (b && pop) { var r = b.getBoundingClientRect(); pop.style.left = Math.round(r.right + 10) + 'px'; pop.style.bottom = Math.max(12, Math.round(innerHeight - r.bottom)) + 'px'; }
    }
  }
  function bellMount() {
    var el = document.createElement('div'); el.id = 'fw-bell'; document.body.appendChild(el);
    setInterval(bellDraw, 1200); bellDraw();
    addEventListener('resize', bellDraw);
    document.addEventListener('mousedown', function (e) {
      var b = document.getElementById('fw-bellb');
      if (bell.open && !el.contains(e.target) && !(b && b.contains(e.target))) studioBell(false);
      if (document.body.classList.contains('fw-ask')) { var a = document.getElementById('askq'); if (a && e.target === a) document.body.classList.remove('fw-ask'); }
    });
  }

  // ---- Settings: sections down the side, every service a connection you turn on
  var set = { tab: 'account', open: null };
  window.studioSet = function (t) { set.tab = t; set.open = null; redraw(); scrollTo(0, 0); };
  window.studioConn = function (id, on) { set.open = on ? id : null; if (id !== 'modal') ui.keys[id] = on && !(S.keys[id] || {}).set ? { edit: 1 } : {}; redraw(); };
  function conn(k, group) {
    var st = S.keys[k.id] || {}, c = st.check, ok = st.set && (!c || c.ok), bad = st.set && c && !c.ok, open = set.open === k.id;
    var pill = !st.set ? '<span class="fw-pill">Not connected</span>' : bad ? '<span class="fw-pill bad">Needs attention</span>' : '<span class="fw-pill ok">Connected</span>';
    var act = open ? '<button class="b2 s" onclick="studioConn(\'' + k.id + '\', false)">Done</button>'
      : st.set ? '<button class="b2 s" onclick="studioConn(\'' + k.id + '\', true)">Manage</button>' : '<button class="b1 s" onclick="studioConn(\'' + k.id + '\', true)">Connect</button>';
    return '<div class="fw-int' + (open ? ' open' : '') + (ok ? ' is-on' : '') + '"><div class="fw-int-top"><span class="fw-int-logo">' + ((typeof LOGO_PATHS !== 'undefined' && LOGO_PATHS[k.id]) ? logo(k.id, 22) : '<b>' + esc(k.name.slice(0, 1)) + '</b>') + '</span>' +
      '<div class="fw-int-tx"><b>' + esc(k.name) + '</b><span>' + esc(KDS[k.id] || k.tag || '') + '</span></div></div>' +
      '<div class="fw-int-foot">' + pill + act + '</div>' + (open ? '<div class="fw-int-body">' + stKey(k) + '</div>' : '') + '</div>';
  }
  function modalConn() {
    var m = mState(), open = set.open === 'modal';
    var pill = m.ready ? '<span class="fw-pill ok">Connected</span>' : m.busy ? '<span class="fw-pill">Connecting…</span>' : m['in'] ? '<span class="fw-pill bad">One step left</span>' : '<span class="fw-pill">Not connected</span>';
    return '<div class="fw-int' + (open ? ' open' : '') + (m.ready ? ' is-on' : '') + '"><div class="fw-int-top"><span class="fw-int-logo" style="background:#0C0A09">' + logo('modal', 22) + '</span>' +
      '<div class="fw-int-tx"><b>Modal</b><span>Renders your videos in the cloud, so this Mac stays free</span></div></div>' +
      '<div class="fw-int-foot">' + pill + '<button class="' + (m.ready || open ? 'b2' : 'b1') + ' s" onclick="studioConn(\'modal\', ' + (!open) + ')">' + (open ? 'Done' : m.ready ? 'Manage' : 'Connect') + '</button></div>' +
      (open ? '<div class="fw-int-body">' + stModal() + '</div>' : '') + '</div>';
  }
  // the Studio voice: a voice model that runs on this computer, installed with one click
  var pocket = { d: null, at: 0 };
  function pocketLoad() { pocket.at = Date.now(); get('/studio/pocket').then(function (d) { var was = JSON.stringify(pocket.d); pocket.d = d; if (was !== JSON.stringify(d)) { if (d.ready && typeof VO !== 'undefined') VO = null; redraw(); } if (d.busy) setTimeout(pocketLoad, 4000); }).catch(function () {}); }
  window.studioPocket = function () { pocket.d = { ready: false, busy: true }; redraw(); send('/studio/pocket', {}).then(function () { setTimeout(pocketLoad, 3000); }); };
  window.studioMyVoice = function (f) {
    if (!f) return;
    pocket.up = true; pocket.msg = ''; redraw();
    fetch('/studio/myvoice', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/octet-stream' }, body: f }).then(function (r) { return r.json(); })
      .then(function (r) { pocket.up = false; pocket.msg = r.ok ? '' : (r.msg || 'That did not save.'); if (typeof VO !== 'undefined') VO = null; pocketLoad(); redraw(); })
      .catch(function () { pocket.up = false; pocket.msg = 'That did not save.'; redraw(); });
  };
  function pocketConn() {
    if (!pocket.d || Date.now() - pocket.at > 30000) pocketLoad();
    var d = pocket.d || {};
    var pill = d.ready ? '<span class="fw-pill ok">Installed</span>' : d.busy ? '<span class="fw-pill">Installing…</span>' : '<span class="fw-pill">Not installed</span>';
    var mine = !d.ready ? '' : '<div class="fw-int-body"><div class="fw-mine"><div><b>Your own voice</b><span>' +
      (pocket.msg ? esc(pocket.msg) : d.mine ? (d.hf ? 'Saved. Pick "My voice" under Studio when you make a video.' : 'Sample saved. One step left: connect Hugging Face below (free).')
        : 'Add 10 to 30 seconds of yourself speaking clearly, and the narrator speaks in your voice. It stays on this computer.') + '</span></div>' +
      '<label class="b2 s" style="cursor:pointer">' + (pocket.up ? 'Saving…' : d.mine ? 'Replace' : 'Add a recording') + '<input type="file" accept="audio/*,video/*" style="display:none" onchange="studioMyVoice(this.files[0])"></label></div></div>';
    return '<div class="fw-int' + (d.ready ? ' is-on open' : '') + '"><div class="fw-int-top"><span class="fw-int-logo"><b>S</b></span>' +
      '<div class="fw-int-tx"><b>Studio voice</b><span>21 natural narrators that run on this computer: free, offline, nothing sent anywhere. About 1 GB, once.</span></div></div>' +
      '<div class="fw-int-foot">' + pill + (d.ready || d.busy ? '' : '<button class="b1 s" onclick="studioPocket()">Install</button>') + '</div>' + mine + '</div>';
  }
  // the wider craft library: open-source video skills the builders learn from, fetched onto this computer
  var craftx = { d: null, at: 0 };
  function craftxLoad() { craftx.at = Date.now(); get('/studio/craftx').then(function (d) { var was = JSON.stringify(craftx.d); craftx.d = d; if (was !== JSON.stringify(d)) redraw(); if (d.busy) setTimeout(craftxLoad, 5000); }).catch(function () {}); }
  window.studioCraftx = function () { craftx.d = Object.assign({}, craftx.d, { busy: true }); redraw(); send('/studio/craftx', {}).then(function () { setTimeout(craftxLoad, 4000); }); };
  function craftxConn() {
    if (!craftx.d || Date.now() - craftx.at > 30000) craftxLoad();
    var d = craftx.d || {};
    var pill = d.busy ? '<span class="fw-pill">Fetching… ' + (d.projects || 0) + '</span>' : d.ready ? '<span class="fw-pill ok">' + d.projects + ' projects</span>' : '<span class="fw-pill">Not fetched</span>';
    return '<div class="fw-int' + (d.ready ? ' is-on' : '') + '"><div class="fw-int-top"><span class="fw-int-logo"><b>C</b></span>' +
      '<div class="fw-int-tx"><b>Craft library</b><span>Open-source video skills (motion, editing, story, Shorts) fetched from their authors for Framewise to learn from. Kept on this computer; for your team only.</span></div></div>' +
      '<div class="fw-int-foot">' + pill + (d.busy ? '' : '<button class="' + (d.ready ? 'b2' : 'b1') + ' s" onclick="studioCraftx()">' + (d.ready ? 'Refresh' : 'Fetch') + '</button>') + '</div></div>';
  }
  // one setup for every download (voices, models, the 3D kit, sounds, the craft library): Home says when something is
  // missing, Settings > Storage lists each pack; everything lands in the one editor folder
  var res = { d: null, at: 0 };
  function gb(mb) { return mb >= 1000 ? (mb / 1000).toFixed(1) + ' GB' : mb + ' MB'; }
  function resLoad() { res.at = Date.now(); get('/studio/resources').then(function (d) { var was = JSON.stringify(res.d); res.d = d; if (was !== JSON.stringify(d)) redraw(); if (d.busy) setTimeout(resLoad, 4000); }).catch(function () {}); }
  window.studioSetup = function (ids) { if (res.d) res.d.busy = true; redraw(); send('/studio/resources', ids ? { ids: ids } : {}).then(function () { setTimeout(resLoad, 1500); }); };
  function resNow(d) { var b = (d.packs || []).filter(function (p) { return p.busy; })[0]; return b ? 'Downloading: ' + b.name : 'Getting ready'; }
  window.studioResLine = function () {
    if (!res.d || Date.now() - res.at > 60000) resLoad();
    var d = res.d; if (!d || d.ready || !(d.packs || []).length) return '';
    if (d.busy) return '<button class="cf-wait" style="margin-top:10px" onclick="rgo(\'settings\')"><i></i>Setting up: ' + esc(resNow(d)) + '<span style="white-space:nowrap">' + gb(d.left_mb) + ' to go</span></button>';
    return '<button class="cf-wait" style="margin-top:10px" onclick="studioSetup()">Setup is not finished: ' + gb(d.left_mb) + ' left to download<span style="white-space:nowrap">Launch setup</span></button>';
  };
  function resCard() {
    if (!res.d || Date.now() - res.at > 30000) resLoad();
    var d = res.d || { packs: [] };
    var rows = (d.packs || []).map(function (p) {
      var st = p.ready ? '<span class="fw-pill ok">On this computer</span>' : p.busy ? '<span class="fw-pill">Downloading…</span>' : p.waiting ? '<span class="fw-pill">Next</span>' :
        p.error ? '<span class="fw-pill bad" title="' + esc(p.error) + '">Did not download</span>' : '<span class="fw-pill">Not downloaded</span>';
      return '<div class="srow"><div><div>' + esc(p.name) + '</div><div class="t2" style="white-space:normal">' + esc(p.about) + ' · ' + gb(p.mb) + (p.error && !p.ready ? ' · ' + esc(p.error) : '') + '</div></div>' + st + '</div>';
    }).join('');
    var head = d.ready ? 'Everything is on this computer.' : d.busy ? esc(resNow(d)) + ', ' + gb(d.left_mb) + ' to go.' : gb(d.left_mb || 0) + ' not downloaded yet.';
    return '<div class="scd"><div class="srow"><div><div>Tools and resources</div><div class="t2" style="white-space:normal">' + head + ' Each computer downloads its own copies from their publishers into one folder: ' +
      esc(d.folder || '') + '. What came from where is in SOURCES.md there.</div></div>' +
      (d.ready || d.busy ? '' : '<button class="b1 s" onclick="studioSetup()">Launch setup</button>') + '</div>' + rows + '</div>';
  }
  window.studioSettingsView = function () {
    var by = {}; KEYS.concat(STUDIO_KEYS).forEach(function (k) { by[k.id] = k; });
    var pick = function (ids) { return ids.filter(function (i) { return by[i]; }).map(function (i) { return conn(by[i]); }).join(''); };
    var TABS = [['account', 'Account', 'gear'], ['connections', 'Connections', 'link'], ['publishing', 'Publishing', 'upload'], ['storage', 'Storage', 'folder'], ['appearance', 'Appearance', 'sun'], ['general', 'General', 'check']];
    var group = function (title, note, cards) { return cards ? '<div class="fw-grp"><div class="fw-grp-h"><b>' + title + '</b><span>' + note + '</span></div><div class="fw-ints">' + cards + '</div></div>' : ''; };
    var body = {
      account: function () {
        return '<div class="fw-sec-h"><h2>Account</h2><p>Framewise writes, cuts and animates with Claude. Each person signs in with their own Claude account.</p></div>' + studioClaudeCard();
      },
      connections: function () {
        return '<div class="fw-sec-h"><h2>Connections</h2><p>Optional services that make videos better. Each is your own account with that service; keys stay on this computer.</p></div>' +
          group('Voice', 'The narrator', pocketConn() + pick(['huggingface', 'elevenlabs'])) +
          group('Footage and pictures', 'For long videos', pick(['pixabay', 'pexels'])) +
          group('AI video', 'Generated shots, charged by each service', pick(['gemini', 'runway', 'higgsfield'])) +
          group('Rendering', 'Where the video is made', modalConn()) +
          group('Craft', 'What the builders learn from', craftxConn());
      },
      publishing: function () { return '<div class="fw-sec-h"><h2>Publishing</h2><p>Post finished videos to your social accounts.</p></div>' + stPost(); },
      storage: function () {
        return '<div class="fw-sec-h"><h2>Storage</h2><p>Where your videos live, what Framewise downloaded, and what it may look through.</p></div>' + stFolder() + resCard() +
          '<div class="scd"><label class="srow" style="cursor:pointer"><div><div>Recent clips</div><div class="t2">Show clips from Movies, Desktop and Downloads when you start a video</div></div><input type="checkbox" class="st-check" ' + (R && R.scan_home ? 'checked' : '') + ' onchange="scanHome(this.checked)"></label></div>';
      },
      appearance: function () { return '<div class="fw-sec-h"><h2>Appearance</h2><p>The look of the app and the keys the editor uses.</p></div>' + stLook() + stKeys(); },
      general: function () {
        var v = (S.update || {}).installed || '';
        return '<div class="fw-sec-h"><h2>General</h2><p>Alerts, tools and this copy of Framewise.</p></div>' + stAlerts() + '<div class="scd">' + toolsRow() + '</div>' +
          '<div class="scd"><div class="srow"><div><div>Framewise</div><div class="t2" style="white-space:normal">Your own build' + (v ? ', on editor ' + esc(v) : '') + '. Built on the open-source cooked. editor (MIT licence).</div></div></div></div>';
      }
    };
    var cur = body[set.tab] ? set.tab : 'account';
    return '<div class="pgc fw-set"><div class="ph"><h1>Settings</h1></div><div class="fw-set-grid"><nav class="fw-set-nav">' +
      TABS.map(function (t) { return '<button class="' + (t[0] === cur ? 'on' : '') + '" onclick="studioSet(\'' + t[0] + '\')">' + ic(t[2], 18) + '<span>' + t[1] + '</span></button>'; }).join('') +
      '</nav><div class="fw-set-body">' + body[cur]() + '</div></div></div>';
  };
})();

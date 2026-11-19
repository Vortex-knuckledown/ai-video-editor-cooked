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

(function () {
  'use strict';

  /* ═══════════════════════════════════════════════
     CONFIG
  ═══════════════════════════════════════════════ */
  var API = 'https://linknest-api.chavanbramha129.workers.dev';
  var SESSION_KEY = 'linknest_session';   // { username, email }
  var PIN_KEY     = 'linknest_pin';       // { type, value }

  /* ═══════════════════════════════════════════════
     STATE
  ═══════════════════════════════════════════════ */
  var session     = null;   // { username, email }
  var pinData     = null;   // { type:'pin'|'pattern'|'custom', value:string }
  var data        = null;   // root folder tree
  var path        = ['root'];
  var searchQuery = '';
  var wrongAttempts = 0;
  var lockoutUntil  = 0;
  var patternActive = false;
  var patternSelected = [];
  var patternPositions = [];

  /* ═══════════════════════════════════════════════
     SOUND ENGINE
  ═══════════════════════════════════════════════ */
  var audioCtx = null;
  function ensureAudio() {
    if (audioCtx) return audioCtx;
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      audioCtx = new Ctx();
    } catch (e) { audioCtx = null; }
    return audioCtx;
  }
  function tone(freq, start, dur, type, vol) {
    var ctx = ensureAudio(); if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();
    var t0 = ctx.currentTime + start;
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol || 0.12, t0 + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(t0); osc.stop(t0 + dur + 0.02);
  }
  var snd = {
    click:    function () { tone(720, 0, 0.06, 'triangle', 0.10); },
    open:     function () { tone(520, 0, 0.05, 'triangle', 0.09); tone(760, 0.04, 0.06, 'triangle', 0.08); },
    success:  function () { tone(600, 0, 0.06, 'sine', 0.12); tone(900, 0.06, 0.06, 'sine', 0.12); tone(1200, 0.12, 0.1, 'sine', 0.11); },
    remove:   function () { tone(420, 0, 0.05, 'sawtooth', 0.09); tone(260, 0.05, 0.12, 'sawtooth', 0.09); },
    error:    function () { tone(300, 0, 0.12, 'sawtooth', 0.12); },
    toggleOn: function () { tone(660, 0, 0.05, 'sine', 0.13); tone(990, 0.05, 0.09, 'sine', 0.13); },
    toggleOff:function () { tone(500, 0, 0.07, 'sine', 0.10); },
    modal:    function () { tone(480, 0, 0.05, 'sine', 0.07); },
    pin:      function () { tone(800, 0, 0.04, 'triangle', 0.08); }
  };

  /* ═══════════════════════════════════════════════
     API HELPERS
  ═══════════════════════════════════════════════ */
  function apiPost(endpoint, body) {
    return fetch(API + endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json(); });
  }
  function apiGet(endpoint) {
    return fetch(API + endpoint).then(function (r) { return r.json(); });
  }
  function apiDelete(endpoint, body) {
    return fetch(API + endpoint, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json(); });
  }

  /* ═══════════════════════════════════════════════
     SESSION
  ═══════════════════════════════════════════════ */
  function saveSession(s) {
    session = s;
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch (e) {}
  }
  function loadSession() {
    try {
      var raw = localStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function clearSession() {
    session = null; pinData = null; data = null;
    try { localStorage.removeItem(SESSION_KEY); localStorage.removeItem(PIN_KEY); } catch (e) {}
  }
  function savePinLocal(p) {
    pinData = p;
    try { localStorage.setItem(PIN_KEY, JSON.stringify(p)); } catch (e) {}
  }
  function loadPinLocal() {
    try {
      var raw = localStorage.getItem(PIN_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  /* ═══════════════════════════════════════════════
     DATA HELPERS
  ═══════════════════════════════════════════════ */
  function defaultData() {
    return { id: 'root', type: 'folder', name: 'My Library', children: [] };
  }
  function genId() { return 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  function findNode(id, node) {
    node = node || data;
    if (!node) return null;
    if (node.id === id) return node;
    if (node.type === 'folder' && node.children) {
      for (var i = 0; i < node.children.length; i++) {
        var f = findNode(id, node.children[i]); if (f) return f;
      }
    }
    return null;
  }
  function findParent(id, node) {
    node = node || data;
    if (node.type === 'folder' && node.children) {
      for (var i = 0; i < node.children.length; i++) {
        if (node.children[i].id === id) return node;
        var f = findParent(id, node.children[i]); if (f) return f;
      }
    }
    return null;
  }
  function progressOf(node) {
    var total = 0, watched = 0;
    (function walk(n) {
      if (n.type === 'link') { total++; if (n.watched) watched++; return; }
      if (n.children) n.children.forEach(walk);
    })(node);
    return { total: total, watched: watched };
  }
  function nodePath(id) {
    var result = [];
    function walk(node, trail) {
      var t = trail.concat([node]);
      if (node.id === id) { result = t; return true; }
      if (node.type === 'folder' && node.children) {
        for (var i = 0; i < node.children.length; i++) { if (walk(node.children[i], t)) return true; }
      }
      return false;
    }
    walk(data, []);
    return result.length ? result : null;
  }
  function isDescendant(ancId, nodeId) {
    var anc = findNode(ancId); if (!anc) return false;
    var found = false;
    (function walk(n) {
      if (n.id === nodeId) { found = true; return; }
      if (n.type === 'folder' && n.children) n.children.forEach(walk);
    })(anc);
    return found;
  }
  function currentFolder() { return findNode(path[path.length - 1]) || data; }

  /* ═══════════════════════════════════════════════
     SMART SAVE SYSTEM
     1. Turant localStorage mein save (instant)
     2. Har 5 min mein HF pe sync
     3. Sirf error pe user ko batao
  ═══════════════════════════════════════════════ */
  var saveTimer      = null;  // debounce timer
  var hfSyncTimer    = null;  // 5 min HF sync timer
  var pendingSync    = false; // kya sync pending hai
  var syncToastEl    = null;  // notification element
  var LOCAL_DATA_KEY = 'linknest_data_' + (session ? session.username : '');

  // Step 1 — Instant localStorage save
  function saveLocal() {
    if (!session || !data) return;
    try {
      LOCAL_DATA_KEY = 'linknest_data_' + session.username;
      localStorage.setItem(LOCAL_DATA_KEY, JSON.stringify(data));
    } catch (e) {}
    pendingSync = true;
  }

  // Step 2 — HF sync (silent, background)
  function syncToHF() {
    if (!session || !data || !pendingSync) return;
    var payload = { username: session.username, links: data, securityPhotos: [] };
    apiPost('/userdata', payload)
      .then(function (res) {
        if (res && res.success) {
          pendingSync = false;
          hideToast(); // success - toast hatao agar dikh raha tha
        } else {
          showSyncError();
        }
      })
      .catch(function () {
        showSyncError();
      });
  }

  // Debounced scheduleSave — localStorage turant, HF 5 min mein
  function scheduleSave() {
    saveLocal(); // turant local save

    // Debounce timer reset (5 min HF sync)
    if (hfSyncTimer) clearTimeout(hfSyncTimer);
    hfSyncTimer = setTimeout(function () {
      syncToHF();
    }, 5 * 60 * 1000); // 5 minutes
  }

  // Page band hone pe HF sync karo
  window.addEventListener('beforeunload', function () {
    if (!pendingSync || !session || !data) return;
    // Synchronous fallback - best effort
    var payload = JSON.stringify({ username: session.username, links: data, securityPhotos: [] });
    navigator.sendBeacon
      ? navigator.sendBeacon(API + '/userdata', new Blob([payload], { type: 'application/json' }))
      : null;
  });

  // ── Toast Notifications ──
  function showSyncError() {
    if (syncToastEl) return; // already dikh raha hai
    syncToastEl = document.createElement('div');
    syncToastEl.id = 'syncToast';
    syncToastEl.innerHTML =
      '<span>&#9729; Sync pending — data locally safe hai.</span>' +
      '<button id="retrySyncBtn">Retry</button>' +
      '<button id="closeToastBtn">&#10005;</button>';
    syncToastEl.style.cssText =
      'position:fixed;bottom:18px;left:50%;transform:translateX(-50%);' +
      'background:#2b1b14;color:#e7d8b8;border:1px solid rgba(184,135,46,0.4);' +
      'border-radius:6px;padding:10px 16px;font-size:.78rem;font-family:var(--font-mono);' +
      'display:flex;align-items:center;gap:10px;z-index:9999;' +
      'box-shadow:0 4px 20px rgba(0,0,0,0.4);max-width:90vw;';
    document.body.appendChild(syncToastEl);

    document.getElementById('retrySyncBtn').onclick = function () {
      pendingSync = true;
      syncToHF();
      hideToast();
      showSyncingToast();
    };
    document.getElementById('closeToastBtn').onclick = hideToast;
  }

  function showSyncingToast() {
    if (syncToastEl) hideToast();
    syncToastEl = document.createElement('div');
    syncToastEl.id = 'syncToast';
    syncToastEl.innerHTML = '<span>&#8635; Syncing...</span>';
    syncToastEl.style.cssText =
      'position:fixed;bottom:18px;left:50%;transform:translateX(-50%);' +
      'background:#2b1b14;color:#e7d8b8;border:1px solid rgba(184,135,46,0.4);' +
      'border-radius:6px;padding:10px 16px;font-size:.78rem;font-family:var(--font-mono);' +
      'display:flex;align-items:center;gap:10px;z-index:9999;' +
      'box-shadow:0 4px 20px rgba(0,0,0,0.4);';
    document.body.appendChild(syncToastEl);
    setTimeout(hideToast, 2000);
  }

  function hideToast() {
    if (syncToastEl) { syncToastEl.remove(); syncToastEl = null; }
  }

  /* ═══════════════════════════════════════════════
     UTILS
  ═══════════════════════════════════════════════ */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var SITE_LABELS = {
    'youtube.com': 'YouTube', 'youtu.be': 'YouTube',
    'netflix.com': 'Netflix', 'primevideo.com': 'Prime Video',
    'hotstar.com': 'Hotstar', 'jiocinema.com': 'JioCinema',
    'sonyliv.com': 'SonyLIV', 'instagram.com': 'Instagram',
    'twitter.com': 'Twitter', 'x.com': 'X', 'spotify.com': 'Spotify',
    'github.com': 'GitHub', 'medium.com': 'Medium',
    'wikipedia.org': 'Wikipedia', 'drive.google.com': 'Drive',
    'docs.google.com': 'Docs', 'amazon.com': 'Amazon'
  };
  function hostnameOf(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return ''; } }
  function siteLabel(url) { var h = hostnameOf(url); return SITE_LABELS[h] || h; }
  function faviconUrl(url) { var h = hostnameOf(url); return h ? 'https://www.google.com/s2/favicons?sz=32&domain=' + encodeURIComponent(h) : ''; }
  function safeUrl(url) {
    try { var u = new URL(url); if (u.protocol === 'http:' || u.protocol === 'https:') return u.href; } catch (e) {}
    return null;
  }

  /* ═══════════════════════════════════════════════
     AUTH SCREEN
  ═══════════════════════════════════════════════ */
  function showAuthScreen() {
    document.getElementById('auth-screen').style.display = 'flex';
    document.getElementById('lock-screen').style.display = 'none';
    document.getElementById('app').style.display = 'none';
    renderAuth('login');
  }

  function renderAuth(tab) {
    var el = document.getElementById('auth-screen');
    el.innerHTML =
      '<div class="auth-card">' +
        '<div class="auth-logo">&#128193; LinkNest</div>' +
        '<div class="auth-sub">Save any link, filed by folder</div>' +
        '<div class="auth-tabs">' +
          '<button class="auth-tab ' + (tab === 'login' ? 'active' : '') + '" id="tabLogin">Login</button>' +
          '<button class="auth-tab ' + (tab === 'signup' ? 'active' : '') + '" id="tabSignup">Sign Up</button>' +
        '</div>' +
        (tab === 'login' ? renderLoginForm() : renderSignupForm()) +
      '</div>';

    document.getElementById('tabLogin').onclick = function () { renderAuth('login'); };
    document.getElementById('tabSignup').onclick = function () { renderAuth('signup'); };

    if (tab === 'login') wireLoginForm();
    else wireSignupForm();
  }

  function renderLoginForm() {
    return '<div id="authForm">' +
      '<div class="auth-field"><label>Email</label><input type="email" id="authEmail" placeholder="your@email.com" autocomplete="email"></div>' +
      '<div class="auth-field"><label>Password</label><input type="password" id="authPass" placeholder="••••••••" autocomplete="current-password"></div>' +
      '<div class="auth-error" id="authErr"></div>' +
      '<button class="auth-btn" id="authSubmit">Login</button>' +
    '</div>';
  }

  function renderSignupForm() {
    return '<div id="authForm">' +
      '<div class="auth-field"><label>Username</label><input type="text" id="authUser" placeholder="yourname" autocomplete="username"></div>' +
      '<div class="auth-field"><label>Email</label><input type="email" id="authEmail" placeholder="your@email.com" autocomplete="email"></div>' +
      '<div class="auth-field"><label>Password</label><input type="password" id="authPass" placeholder="min 6 characters" autocomplete="new-password"></div>' +
      '<div class="auth-error" id="authErr"></div>' +
      '<button class="auth-btn" id="authSubmit">Create Account</button>' +
    '</div>';
  }

  function wireLoginForm() {
    var btn = document.getElementById('authSubmit');
    function doLogin() {
      var email = document.getElementById('authEmail').value.trim();
      var pass  = document.getElementById('authPass').value;
      var err   = document.getElementById('authErr');
      if (!email || !pass) { err.textContent = 'Email aur password dono chahiye.'; return; }
      btn.disabled = true; btn.textContent = 'Logging in...';
      apiPost('/login', { email: email, password: pass })
        .then(function (res) {
          if (res.success) {
            saveSession({ username: res.username, email: email });
            var localPin = loadPinLocal();
            if (localPin) { pinData = localPin; showLockScreen(); }
            else { loadUserData(); }
          } else {
            document.getElementById('authErr').textContent = res.error || 'Login failed.';
            snd.error();
          }
        })
        .catch(function () { document.getElementById('authErr').textContent = 'Network error. Try again.'; })
        .finally(function () { btn.disabled = false; btn.textContent = 'Login'; });
    }
    btn.onclick = doLogin;
    document.getElementById('authPass').onkeydown = function (e) { if (e.key === 'Enter') doLogin(); };
  }

  function wireSignupForm() {
    var btn = document.getElementById('authSubmit');
    function doSignup() {
      var username = document.getElementById('authUser').value.trim();
      var email    = document.getElementById('authEmail').value.trim();
      var pass     = document.getElementById('authPass').value;
      var err      = document.getElementById('authErr');
      if (!username || !email || !pass) { err.textContent = 'Saare fields bharo.'; return; }
      if (pass.length < 6) { err.textContent = 'Password kam se kam 6 characters ka ho.'; return; }
      if (!/^[a-zA-Z0-9_]+$/.test(username)) { err.textContent = 'Username mein sirf letters, numbers, _ allowed hain.'; return; }
      btn.disabled = true; btn.textContent = 'Creating...';
      apiPost('/signup', { username: username, email: email, password: pass })
        .then(function (res) {
          if (res.success) {
            saveSession({ username: username, email: email });
            showSetPinScreen();
          } else {
            document.getElementById('authErr').textContent = res.error || 'Signup failed.';
            snd.error();
          }
        })
        .catch(function () { document.getElementById('authErr').textContent = 'Network error. Try again.'; })
        .finally(function () { btn.disabled = false; btn.textContent = 'Create Account'; });
    }
    btn.onclick = doSignup;
    document.getElementById('authPass').onkeydown = function (e) { if (e.key === 'Enter') doSignup(); };
  }

  /* ═══════════════════════════════════════════════
     SET PIN SCREEN (new user / reset)
  ═══════════════════════════════════════════════ */
  function showSetPinScreen(isReset) {
    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('lock-screen').style.display = 'flex';
    document.getElementById('app').style.display = 'none';

    var lockEl = document.getElementById('lock-screen');
    var currentPinType = 'pin';
    var setPinValue = '';
    var confirmStep = false;
    var firstValue = '';

    function render() {
      lockEl.innerHTML =
        '<div class="lock-card">' +
          '<div class="lock-title">' + (confirmStep ? 'Confirm your ' : 'Set your ') + pinTypeLabel(currentPinType) + '</div>' +
          '<div class="lock-user">Hello, ' + esc(session.username) + '! Choose a lock type:</div>' +
          '<div class="lock-type-tabs">' +
            '<button class="lock-type-tab ' + (currentPinType === 'pin' ? 'active' : '') + '" id="setPinTab">PIN</button>' +
            '<button class="lock-type-tab ' + (currentPinType === 'pattern' ? 'active' : '') + '" id="setPatternTab">Pattern</button>' +
            '<button class="lock-type-tab ' + (currentPinType === 'custom' ? 'active' : '') + '" id="setCustomTab">Custom</button>' +
          '</div>' +
          renderLockInput(currentPinType, '') +
          '<div class="lock-error" id="lockErr"></div>' +
          '<button class="lock-submit" id="lockSubmit">' + (confirmStep ? 'Confirm' : 'Continue') + '</button>' +
          (!isReset ? '<button class="lock-logout" id="skipPin">Skip for now (not recommended)</button>' : '') +
        '</div>';

      document.getElementById('setPinTab').onclick = function () { currentPinType = 'pin'; confirmStep = false; firstValue = ''; render(); };
      document.getElementById('setPatternTab').onclick = function () { currentPinType = 'pattern'; confirmStep = false; firstValue = ''; render(); };
      document.getElementById('setCustomTab').onclick = function () { currentPinType = 'custom'; confirmStep = false; firstValue = ''; render(); };

      wireLockInput(currentPinType, function (val) { setPinValue = val; });

      document.getElementById('lockSubmit').onclick = function () {
        if (!setPinValue || setPinValue.length < (currentPinType === 'pin' ? 4 : 1)) {
          document.getElementById('lockErr').textContent = 'Please complete the ' + pinTypeLabel(currentPinType) + ' first.';
          return;
        }
        if (!confirmStep) {
          firstValue = setPinValue; setPinValue = ''; confirmStep = true; render();
        } else {
          if (setPinValue !== firstValue) {
            document.getElementById('lockErr').textContent = 'Does not match! Try again.';
            confirmStep = false; firstValue = ''; setPinValue = ''; render();
            return;
          }
          var p = { type: currentPinType, value: setPinValue };
          savePinLocal(p);
          apiPost('/save-pin', { username: session.username, pin: setPinValue, pinType: currentPinType });
          snd.success();
          loadUserData();
        }
      };

      var skipBtn = document.getElementById('skipPin');
      if (skipBtn) skipBtn.onclick = function () { loadUserData(); };
    }
    render();
  }

  /* ═══════════════════════════════════════════════
     LOCK SCREEN
  ═══════════════════════════════════════════════ */
  function showLockScreen() {
    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('lock-screen').style.display = 'flex';
    document.getElementById('app').style.display = 'none';
    wrongAttempts = 0;
    renderLockScreen();
  }

  function renderLockScreen() {
    var lockEl = document.getElementById('lock-screen');
    var type = pinData ? pinData.type : 'pin';
    var now = Date.now();
    var isLockedOut = lockoutUntil > now;
    var currentInput = '';

    lockEl.innerHTML =
      '<div class="lock-card">' +
        '<div class="lock-title">&#128274; LinkNest</div>' +
        '<div class="lock-user">Welcome back, ' + esc(session.username) + '</div>' +
        (isLockedOut ?
          '<div class="lockout-banner" id="lockoutBanner">Too many attempts! Wait <span id="lockTimer">30</span>s</div>' : '') +
        renderLockInput(type, '') +
        '<div class="lock-error" id="lockErr"></div>' +
        '<div class="lock-attempts" id="lockAttempts">' + (wrongAttempts > 0 ? wrongAttempts + '/5 wrong attempts' : '') + '</div>' +
        '<button class="lock-submit" id="lockSubmit"' + (isLockedOut ? ' disabled' : '') + '>Unlock</button>' +
        '<button class="lock-forgot" id="lockForgot">Forgot ' + pinTypeLabel(type) + '?</button>' +
        '<button class="lock-logout" id="lockLogout">&#8592; Login with different account</button>' +
      '</div>';

    if (isLockedOut) startLockoutTimer();

    var resetInput = null;
    wireLockInput(type, function (val) { currentInput = val; }, function(fn) { resetInput = fn; });

    document.getElementById('lockSubmit').onclick = function () { checkPin(currentInput, type, resetInput); };
    document.getElementById('lockForgot').onclick = function () { showForgotPin(); };
    document.getElementById('lockLogout').onclick = function () { clearSession(); showAuthScreen(); };
  }

  function checkPin(val, type, resetFn) {
    if (!val) {
      document.getElementById("lockErr").textContent = "Please enter your " + pinTypeLabel(type) + ".";
      return;
    }
    var submitBtn = document.getElementById("lockSubmit");
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Checking..."; }
    apiPost("/verify-pin", { username: session.username, pin: val })
      .then(function (res) {
        if (res.match) {
          wrongAttempts = 0; snd.success(); loadUserData();
        } else {
          wrongAttempts++; snd.error();
          if (resetFn) resetFn();
          if (wrongAttempts >= 5) {
            captureSecurityPhoto();
            lockoutUntil = Date.now() + 30000;
            wrongAttempts = 0;
            renderLockScreen();
          } else {
            var errEl = document.getElementById("lockErr");
            if (errEl) errEl.textContent = "Wrong " + pinTypeLabel(type) + "! (" + wrongAttempts + "/5)";
            if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Unlock"; }
          }
        }
      })
      .catch(function () {
        var errEl = document.getElementById("lockErr");
        if (errEl) errEl.textContent = "Network error. Try again.";
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Unlock"; }
      });
  }

  function startLockoutTimer() {
    var interval = setInterval(function () {
      var rem = Math.ceil((lockoutUntil - Date.now()) / 1000);
      var el = document.getElementById('lockTimer');
      if (!el) { clearInterval(interval); return; }
      if (rem <= 0) {
        clearInterval(interval);
        renderLockScreen();
      } else {
        el.textContent = rem;
      }
    }, 500);
  }

  function showForgotPin() {
    openModal(
      '<h3>Forgot ' + pinTypeLabel(pinData ? pinData.type : 'PIN') + '?</h3>' +
      '<p style="font-size:.8rem;color:var(--ink-soft);margin-bottom:16px;">Apna account password daalo verify karne ke liye:</p>' +
      '<label class="field-label">Account Password</label>' +
      '<input type="password" id="forgotPassInput" placeholder="••••••••">' +
      '<div class="auth-error" id="forgotErr"></div>' +
      '<div class="modal-actions">' +
        '<button class="btn" id="modalCancelBtn">Cancel</button>' +
        '<button class="btn gold" id="forgotVerifyBtn">Verify & Reset PIN</button>' +
      '</div>'
    );
    document.getElementById('modalCancelBtn').onclick = closeModal;
    document.getElementById('forgotVerifyBtn').onclick = function () {
      var pass = document.getElementById('forgotPassInput').value;
      if (!pass) { document.getElementById('forgotErr').textContent = 'Password daalo.'; return; }
      apiPost('/verify-password', { email: session.email, password: pass })
        .then(function (res) {
          if (res.success) { closeModal(); showSetPinScreen(true); }
          else { document.getElementById('forgotErr').textContent = 'Wrong password!'; snd.error(); }
        })
        .catch(function () { document.getElementById('forgotErr').textContent = 'Network error.'; });
    };
  }

  /* ═══════════════════════════════════════════════
     LOCK INPUT RENDERERS
  ═══════════════════════════════════════════════ */
  function pinTypeLabel(type) {
    return type === 'pin' ? 'PIN' : type === 'pattern' ? 'Pattern' : 'Password';
  }

  function renderLockInput(type, val) {
    if (type === 'pin')     return renderPinInput();
    if (type === 'pattern') return renderPatternInput();
    return renderCustomInput();
  }

  function renderPinInput() {
    return '<div class="pin-dots" id="pinDots">' +
      '<div class="pin-dot" id="d0"></div>' +
      '<div class="pin-dot" id="d1"></div>' +
      '<div class="pin-dot" id="d2"></div>' +
      '<div class="pin-dot" id="d3"></div>' +
    '</div>' +
    '<div class="pin-pad" id="pinPad">' +
      [1,2,3,4,5,6,7,8,9].map(function(n){
        return '<button class="pin-key" data-k="'+n+'">'+n+'</button>';
      }).join('') +
      '<button class="pin-key wide" data-k="0">0</button>' +
      '<button class="pin-key del" data-k="del">⌫</button>' +
    '</div>';
  }

  function renderPatternInput() {
    return '<div class="pattern-grid" id="patternGrid">' +
      [0,1,2,3,4,5,6,7,8].map(function(i){
        return '<div class="pattern-dot-wrap"><div class="pattern-dot" id="pd'+i+'"></div></div>';
      }).join('') +
      '<canvas class="pattern-canvas" id="patternCanvas"></canvas>' +
    '</div>' +
    '<div style="font-size:.7rem;color:var(--ink-soft);text-align:center;margin-bottom:8px;" id="patternHint">Draw your pattern</div>';
  }

  function renderCustomInput() {
    return '<div class="custom-name-wrap">' +
      '<input type="password" id="customInput" placeholder="Enter your password" autocomplete="off">' +
    '</div>';
  }

  /* ═══════════════════════════════════════════════
     LOCK INPUT WIRING
  ═══════════════════════════════════════════════ */
  function wireLockInput(type, onChange, onReset) {
    if (type === 'pin')     wirePinInput(onChange, onReset);
    if (type === 'pattern') wirePatternInput(onChange, onReset);
    if (type === 'custom')  wireCustomInput(onChange, onReset);
  }

  function wirePinInput(onChange, onReset) {
    var pinVal = '';
    var pad = document.getElementById('pinPad');
    if (!pad) return;

    function updateDots() {
      for (var i = 0; i < 4; i++) {
        var dot = document.getElementById('d' + i);
        if (dot) dot.className = 'pin-dot' + (i < pinVal.length ? ' filled' : '');
      }
    }
    function resetPin() {
      pinVal = '';
      updateDots();
      onChange('');
    }
    // Expose reset so checkPin can call it
    if (onReset) onReset(resetPin);

    pad.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-k]'); if (!btn) return;
      var k = btn.getAttribute('data-k');
      snd.pin();
      if (k === 'del') { pinVal = pinVal.slice(0, -1); }
      else if (pinVal.length < 4) { pinVal += k; }
      updateDots();
      onChange(pinVal);
    });
  }

  function wirePatternInput(onChange, onReset) {
    patternSelected = []; patternActive = false;
    var grid = document.getElementById('patternGrid');
    var canvas = document.getElementById('patternCanvas');
    if (!grid || !canvas) return;

    function resetPattern() {
      patternSelected = []; patternActive = false;
      document.querySelectorAll('.pattern-dot').forEach(function(d){ d.className='pattern-dot'; });
      var ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      var hint = document.getElementById('patternHint');
      if (hint) hint.textContent = 'Draw your pattern';
      onChange('');
    }
    if (onReset) onReset(resetPattern);

    // Setup canvas size and dot positions after DOM renders
    function setupCanvas() {
      var rect = grid.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
      patternPositions = [];
      for (var i = 0; i < 9; i++) {
        var dot = document.getElementById('pd' + i);
        if (dot) {
          var dr = dot.getBoundingClientRect();
          patternPositions.push({
            x: dr.left - rect.left + dr.width / 2,
            y: dr.top - rect.top + dr.height / 2
          });
        }
      }
    }
    setTimeout(setupCanvas, 100);

    function getPos(e) {
      var rect = canvas.getBoundingClientRect();
      var touch = e.touches && e.touches[0];
      var clientX = touch ? touch.clientX : e.clientX;
      var clientY = touch ? touch.clientY : e.clientY;
      return {
        x: (clientX - rect.left) * (canvas.width / rect.width),
        y: (clientY - rect.top) * (canvas.height / rect.height)
      };
    }

    function hitDot(pos) {
      for (var i = 0; i < patternPositions.length; i++) {
        var p = patternPositions[i];
        var dx = pos.x - p.x, dy = pos.y - p.y;
        if (Math.sqrt(dx*dx + dy*dy) < 28 && patternSelected.indexOf(i) === -1) return i;
      }
      return -1;
    }

    function drawPattern(curPos) {
      var ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (patternSelected.length < 1) return;
      ctx.strokeStyle = 'rgba(184,135,46,0.8)';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      var p0 = patternPositions[patternSelected[0]];
      ctx.moveTo(p0.x, p0.y);
      for (var i = 1; i < patternSelected.length; i++) {
        var pi = patternPositions[patternSelected[i]];
        ctx.lineTo(pi.x, pi.y);
      }
      if (curPos) ctx.lineTo(curPos.x, curPos.y);
      ctx.stroke();
    }

    function onStart(e) {
      e.preventDefault();
      e.stopPropagation();
      // Re-setup canvas if needed
      if (patternPositions.length === 0) setupCanvas();
      patternSelected = []; patternActive = true;
      document.querySelectorAll('.pattern-dot').forEach(function(d){ d.className='pattern-dot'; });
      var ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      var idx = hitDot(getPos(e));
      if (idx !== -1) {
        patternSelected.push(idx);
        var dot = document.getElementById('pd' + idx);
        if (dot) dot.className = 'pattern-dot active';
        snd.pin();
      }
    }

    function onMove(e) {
      if (!patternActive) return;
      e.preventDefault();
      e.stopPropagation();
      var pos = getPos(e);
      var idx = hitDot(pos);
      if (idx !== -1) {
        patternSelected.push(idx);
        var dot = document.getElementById('pd' + idx);
        if (dot) dot.className = 'pattern-dot active';
        snd.pin();
      }
      drawPattern(pos);
    }

    function onEnd(e) {
      if (!patternActive) return;
      e.preventDefault();
      patternActive = false;
      drawPattern(null);
      var val = patternSelected.join('-');
      onChange(val);
      var hint = document.getElementById('patternHint');
      if (hint) hint.textContent = patternSelected.length + ' dot(s) connected';
    }

    // Mouse events
    canvas.addEventListener('mousedown', onStart);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onEnd);
    // Touch events
    canvas.addEventListener('touchstart', onStart, { passive: false });
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd, { passive: false });
  }

  function wireCustomInput(onChange) {
    var inp = document.getElementById('customInput');
    if (!inp) return;
    inp.oninput = function () { onChange(inp.value); };
    inp.focus();
  }

  /* ═══════════════════════════════════════════════
     SECURITY CAMERA
  ═══════════════════════════════════════════════ */
  function captureSecurityPhoto() {
    var video = document.getElementById('secCamera');
    var canvas = document.getElementById('secCanvas');
    if (!video || !canvas) return;
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } })
      .then(function (stream) {
        video.srcObject = stream;
        video.onloadedmetadata = function () {
          setTimeout(function () {
            canvas.width = video.videoWidth || 320;
            canvas.height = video.videoHeight || 240;
            canvas.getContext('2d').drawImage(video, 0, 0);
            var photo = canvas.toDataURL('image/jpeg', 0.5);
            stream.getTracks().forEach(function (t) { t.stop(); });
            apiPost('/security-photo', { username: session.username, photo: photo }).catch(function () {});
          }, 800);
        };
      })
      .catch(function () {
        // Camera not available — silent fail, lockout still applies
      });
  }

  /* ═══════════════════════════════════════════════
     LOAD USER DATA
  ═══════════════════════════════════════════════ */
  function loadUserData() {
    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('lock-screen').style.display = 'none';
    var appEl = document.getElementById('app');
    appEl.style.display = 'block';

    LOCAL_DATA_KEY = 'linknest_data_' + session.username;

    // Step 1: localStorage se turant load karo
    var localRaw = null;
    try { localRaw = localStorage.getItem(LOCAL_DATA_KEY); } catch(e) {}

    if (localRaw) {
      try {
        data = JSON.parse(localRaw);
        path = ['root'];
        render();
        // Background mein HF se bhi sync karo (latest check)
        apiGet('/userdata?username=' + encodeURIComponent(session.username))
          .then(function (res) {
            if (res && res.links) {
              // HF data newer hai to update karo silently
              data = res.links;
              saveLocal();
              render();
            }
          })
          .catch(function () {
            // HF unavailable - local data already loaded, koi problem nahi
          });
        return;
      } catch(e) {}
    }

    // Step 2: localStorage nahi mila - HF se load karo
    appEl.innerHTML = '<div style="text-align:center;padding:60px;color:#e7d8b8;font-family:var(--font-mono);">&#8635; Loading your library...</div>';

    apiGet('/userdata?username=' + encodeURIComponent(session.username))
      .then(function (res) {
        if (res && res.links) {
          data = res.links;
          saveLocal(); // local mein save karo future ke liye
        } else {
          data = defaultData();
        }
        path = ['root'];
        render();
      })
      .catch(function () {
        // HF bhi nahi mila - fresh start
        data = defaultData();
        path = ['root'];
        render();
        showSyncError();
      });
  }

  /* ══════════════════════════════════════════════════════════════
     MAIN RENDER — script continues in Part 2
  ══════════════════════════════════════════════════════════════ */

  /* ═══════════════════════════════════════════════
     TOOLBAR & MAIN RENDER
  ═══════════════════════════════════════════════ */
  function render() {
    var appEl = document.getElementById('app');
    var html = renderToolbar();
    if (searchQuery.trim()) html += renderSearchResults();
    else html += renderTrail() + renderLedgerPage();
    html += '<footer class="credits">&#128274; LinkNest &middot; ' + esc(session.username) + ' &middot; Synced to private cloud</footer>';
    appEl.innerHTML = html;
    wireAppEvents();
  }

  function renderToolbar() {
    return '<div class="toolbar">' +
      '<span class="brand-tag">&#128193; LinkNest</span>' +
      '<div class="search-wrap">' +
        '<span class="icon">&#128269;</span>' +
        '<input type="text" id="searchInput" placeholder="Search folders and links..." value="' + esc(searchQuery) + '">' +
      '</div>' +
      '<div class="toolbar-right">' +
        '<button class="btn ghost" id="settingsBtn">&#9881; Settings</button>' +
        '<button class="btn ghost" id="exportBtn">&#11015; Export</button>' +
        '<button class="btn ghost" id="importBtn">&#11014; Import</button>' +
      '</div>' +
    '</div>';
  }

  function renderTrail() {
    var crumbs = nodePath(currentFolder().id) || [data];
    var html = '<div class="trail">';
    crumbs.forEach(function (node, i) {
      var cur = i === crumbs.length - 1;
      html += '<button class="trail-tab' + (cur ? ' current' : '') + '" data-nav="' + esc(node.id) + '"' + (cur ? ' disabled' : '') + '>' + esc(node.name) + '</button>';
    });
    return html + '</div>';
  }

  function renderLedgerPage() {
    var folder = currentFolder();
    var kids = folder.children || [];
    var subfolders = kids.filter(function (k) { return k.type === 'folder'; });
    var links = kids.filter(function (k) { return k.type === 'link'; });
    var html = '<div class="ledger-page">';
    html += '<div class="page-actions">' +
      (path.length > 1 ? '<button class="btn ghost" id="exportFolderBtn">&#11015; Export folder</button>' : '') +
      '<button class="btn" id="newFolderBtn">&#128193; New folder</button>' +
      '<button class="btn gold" id="newLinkBtn">&#9654; Add link</button>' +
    '</div>';

    if (!subfolders.length && !links.length) {
      html += '<div class="empty-state"><div class="big">This folder is empty</div>' +
        '<p>Create a folder or save a link here — movies, courses, articles, anything.</p></div>';
    } else {
      if (subfolders.length) {
        html += '<div class="section-label">Folders</div><div class="folder-grid">';
        subfolders.forEach(function (f) {
          var prog = progressOf(f);
          var pct = prog.total ? Math.round((prog.watched / prog.total) * 100) : 0;
          html += '<div class="folder-card" data-open="' + esc(f.id) + '">' +
            '<div class="card-menu">' +
              '<button class="icon-btn" data-rename="' + esc(f.id) + '" title="Rename">&#9998;</button>' +
              '<button class="icon-btn" data-move="' + esc(f.id) + '" title="Move">&#8693;</button>' +
              '<button class="icon-btn danger" data-delete-folder="' + esc(f.id) + '" title="Delete">&#10005;</button>' +
            '</div>' +
            '<span class="fname">' + esc(f.name) + '</span>' +
            '<div class="fmeta">' +
              (prog.total ? '<div class="prog-bar"><div class="prog-fill" style="width:' + pct + '%"></div></div><span>' + prog.watched + '/' + prog.total + '</span>' : '<span>empty</span>') +
            '</div></div>';
        });
        html += '</div>';
      }
      if (links.length) {
        html += '<div class="section-label">Links</div><div class="link-rows">';
        links.forEach(function (l, i) { html += renderLinkRow(l, i + 1); });
        html += '</div>';
      }
    }
    return html + '</div>';
  }

  function renderLinkRow(l, num, pathHint) {
    var url = safeUrl(l.url) || '#';
    var fav = faviconUrl(url);
    var site = siteLabel(url);
    return '<div class="link-row' + (l.watched ? ' watched' : '') + '">' +
      '<span class="roll">' + (num != null ? String(num).padStart(2, '0') : '') + '</span>' +
      '<button class="watch-box" data-toggle-watch="' + esc(l.id) + '">' + (l.watched ? '&#10003;' : '') + '</button>' +
      '<div class="link-body">' +
        '<a class="ltitle" href="' + esc(url) + '" target="_blank" rel="noopener">' +
          (fav ? '<img class="favicon" src="' + esc(fav) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">' : '') +
          esc(l.name) +
        '</a>' +
        '<div class="lmeta">' +
          (site ? '<span class="tag">' + esc(site) + '</span>' : '') +
          (pathHint ? '<span class="path-hint">' + esc(pathHint) + '</span>' : '') +
          (l.note ? '<span class="note">' + esc(l.note) + '</span>' : '') +
        '</div>' +
      '</div>' +
      '<div class="row-actions">' +
        '<button class="icon-btn" data-rename-link="' + esc(l.id) + '">&#9998;</button>' +
        '<button class="icon-btn" data-move="' + esc(l.id) + '">&#8693;</button>' +
        '<button class="icon-btn danger" data-delete-link="' + esc(l.id) + '">&#10005;</button>' +
      '</div>' +
    '</div>';
  }

  function renderSearchResults() {
    var q = searchQuery.trim().toLowerCase();
    var matches = [];
    (function walk(node, trail) {
      var t = trail.concat([node]);
      if (node.id !== 'root') {
        var hay = (node.name + ' ' + (node.note || '')).toLowerCase();
        if (hay.indexOf(q) !== -1) matches.push({ node: node, trail: trail });
      }
      if (node.type === 'folder' && node.children) node.children.forEach(function (c) { walk(c, t); });
    })(data, []);

    var html = '<div class="ledger-page search-results">' +
      '<div class="section-label">' + matches.length + ' result' + (matches.length === 1 ? '' : 's') + ' for &ldquo;' + esc(searchQuery.trim()) + '&rdquo;</div>';
    if (!matches.length) {
      html += '<div class="empty-state"><div class="big">No matches</div><p>Try a different word.</p></div>';
    } else {
      html += '<div class="link-rows">';
      matches.forEach(function (m) {
        var ph = m.trail.map(function (n) { return n.name; }).join(' / ') || 'My Library';
        if (m.node.type === 'link') { html += renderLinkRow(m.node, null, ph); }
        else {
          var prog = progressOf(m.node);
          html += '<div class="link-row" data-open="' + esc(m.node.id) + '" style="cursor:pointer">' +
            '<span class="roll">&#128193;</span>' +
            '<div class="link-body">' +
              '<span class="ltitle">' + esc(m.node.name) + '</span>' +
              '<div class="lmeta"><span class="path-hint">' + esc(ph) + '</span>' +
                (prog.total ? '<span>' + prog.watched + '/' + prog.total + ' done</span>' : '') +
              '</div>' +
            '</div></div>';
        }
      });
      html += '</div>';
    }
    return html + '</div>';
  }

  /* ═══════════════════════════════════════════════
     MODAL
  ═══════════════════════════════════════════════ */
  function openModal(inner) {
    closeModal(); snd.modal();
    var bd = document.createElement('div');
    bd.className = 'modal-backdrop open'; bd.id = 'modalBackdrop';
    bd.innerHTML = '<div class="modal-card"><button class="modal-close" id="modalCloseBtn">&#10005;</button>' + inner + '</div>';
    document.body.appendChild(bd);
    bd.addEventListener('click', function (e) { if (e.target === bd) closeModal(); });
    document.getElementById('modalCloseBtn').addEventListener('click', closeModal);
  }
  function closeModal() { var el = document.getElementById('modalBackdrop'); if (el) el.remove(); }

  /* ═══════════════════════════════════════════════
     FOLDER MODAL
  ═══════════════════════════════════════════════ */
  function promptFolderModal(existing) {
    var isEdit = !!existing;
    openModal('<h3>' + (isEdit ? 'Rename folder' : 'New folder') + '</h3>' +
      '<label class="field-label">Folder name</label>' +
      '<input type="text" id="folderNameInput" placeholder="e.g. Movies, Courses, Anime" value="' + esc(isEdit ? existing.name : '') + '">' +
      '<div class="modal-actions">' +
        '<button class="btn" id="modalCancelBtn">Cancel</button>' +
        '<button class="btn gold" id="modalSaveBtn">' + (isEdit ? 'Save' : 'Create') + '</button>' +
      '</div>');
    var inp = document.getElementById('folderNameInput'); inp.focus(); inp.select();
    function submit() {
      var name = inp.value.trim(); if (!name) return;
      if (isEdit) { existing.name = name; }
      else { currentFolder().children = currentFolder().children || []; currentFolder().children.push({ id: genId(), type: 'folder', name: name, children: [] }); }
      scheduleSave(); snd.success(); closeModal(); render();
    }
    document.getElementById('modalSaveBtn').onclick = submit;
    document.getElementById('modalCancelBtn').onclick = closeModal;
    inp.onkeydown = function (e) { if (e.key === 'Enter') submit(); };
  }

  /* ═══════════════════════════════════════════════
     LINK MODAL
  ═══════════════════════════════════════════════ */
  function promptLinkModal(existing) {
    var isEdit = !!existing;
    var folder = currentFolder();
    openModal('<h3>' + (isEdit ? 'Edit link' : 'Add link') + '</h3>' +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">' +
        '<label class="field-label" style="margin:0">Title</label>' +
        '<button class="icon-btn" id="omdbFillBtn" style="font-size:.66rem;color:var(--gold)">&#127916; Auto-fill from IMDb</button>' +
      '</div>' +
      '<input type="text" id="linkNameInput" placeholder="e.g. Inception (2010)" value="' + esc(isEdit ? existing.name : '') + '">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">' +
        '<label class="field-label" style="margin:0">URL</label>' +
        '<button class="icon-btn" id="ytFillBtn" style="font-size:.66rem;color:var(--gold)">&#9654; Fetch YouTube title</button>' +
      '</div>' +
      '<input type="url" id="linkUrlInput" placeholder="https://..." value="' + esc(isEdit ? existing.url : '') + '">' +
      '<label class="field-label">Note (optional)</label>' +
      '<textarea id="linkNoteInput" placeholder="Cast, timestamp, anything...">' + esc(isEdit ? (existing.note || '') : (folder.noteTemplate || '')) + '</textarea>' +
      '<div class="modal-actions">' +
        '<button class="btn" id="modalCancelBtn">Cancel</button>' +
        '<button class="btn gold" id="modalSaveBtn">' + (isEdit ? 'Save' : 'Add link') + '</button>' +
      '</div>');

    document.getElementById('omdbFillBtn').onclick = function () {
      var title = document.getElementById('linkNameInput').value.trim();
      if (!title) { alert('Pehle Title field mein movie ka naam likho.'); return; }
      var btn = document.getElementById('omdbFillBtn');
      btn.innerHTML = '⏳'; btn.disabled = true;
      fetch(API + '/omdb?t=' + encodeURIComponent(title))
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d.Response === 'False') { alert('IMDb par "' + title + '" nahi mila.'); return; }
          var parts = [];
          if (d.Year)     parts.push('Year: ' + d.Year);
          if (d.Genre && d.Genre !== 'N/A')     parts.push('Genre: ' + d.Genre);
          if (d.Actors && d.Actors !== 'N/A')   parts.push('Cast: ' + d.Actors);
          if (d.Director && d.Director !== 'N/A') parts.push('Director: ' + d.Director);
          if (d.Plot && d.Plot !== 'N/A')       parts.push('Plot: ' + d.Plot);
          document.getElementById('linkNoteInput').value = parts.join('\n');
          if (d.Title) document.getElementById('linkNameInput').value = d.Title + (d.Year ? ' (' + d.Year + ')' : '');
        })
        .catch(function () { alert('IMDb se data nahi mila.'); })
        .finally(function () { btn.innerHTML = '&#127916; Auto-fill from IMDb'; btn.disabled = false; });
    };

    document.getElementById('ytFillBtn').onclick = function () {
      var url = document.getElementById('linkUrlInput').value.trim();
      if (!url) { alert('Pehle YouTube URL paste karo.'); return; }
      if (!/youtube\.com|youtu\.be/i.test(url)) { alert('Ye YouTube link nahi lag raha.'); return; }
      var btn = document.getElementById('ytFillBtn');
      btn.innerHTML = '⏳'; btn.disabled = true;
      fetch('https://www.youtube.com/oembed?url=' + encodeURIComponent(url) + '&format=json')
        .then(function (r) { if (!r.ok) throw new Error(); return r.json(); })
        .then(function (d) {
          document.getElementById('linkNameInput').value = d.title || document.getElementById('linkNameInput').value;
          var note = document.getElementById('linkNoteInput');
          if (!note.value.trim() && d.author_name) note.value = 'Channel: ' + d.author_name;
        })
        .catch(function () { alert('YouTube title nahi mil paaya.'); })
        .finally(function () { btn.innerHTML = '&#9654; Fetch YouTube title'; btn.disabled = false; });
    };

    function submit() {
      var name = document.getElementById('linkNameInput').value.trim();
      var url  = document.getElementById('linkUrlInput').value.trim();
      var note = document.getElementById('linkNoteInput').value.trim();
      if (!name || !url) { alert('Title aur URL dono chahiye.'); return; }
      if (!safeUrl(url)) { alert('Valid http/https URL daalo.'); return; }
      if (isEdit) { existing.name = name; existing.url = url; existing.note = note; }
      else {
        folder.children = folder.children || [];
        folder.children.push({ id: genId(), type: 'link', name: name, url: url, note: note, watched: false });
        if (note) folder.noteTemplate = note;
      }
      scheduleSave(); snd.success(); closeModal(); render();
    }
    document.getElementById('modalSaveBtn').onclick = submit;
    document.getElementById('modalCancelBtn').onclick = closeModal;
  }

  /* ═══════════════════════════════════════════════
     MOVE MODAL
  ═══════════════════════════════════════════════ */
  function promptMoveModal(nodeId) {
    var node = findNode(nodeId); if (!node) return;
    var options = [];
    (function walk(n, depth) {
      if (n.type !== 'folder') return;
      var blocked = n.id === node.id || (node.type === 'folder' && isDescendant(node.id, n.id));
      options.push({ id: n.id, label: ('\u00A0\u00A0').repeat(depth) + (depth ? '\u21B3 ' : '') + n.name, blocked: blocked });
      (n.children || []).forEach(function (c) { if (c.type === 'folder') walk(c, depth + 1); });
    })(data, 0);
    var html = '<h3>Move &ldquo;' + esc(node.name) + '&rdquo;</h3>' +
      '<label class="field-label">Choose destination</label>' +
      '<div class="picker-list">' +
      options.map(function (o) {
        return '<div class="picker-item" data-pick="' + esc(o.id) + '"' +
          (o.blocked ? ' style="opacity:.35;pointer-events:none"' : '') + '>' + o.label + '</div>';
      }).join('') + '</div>' +
      '<div class="modal-actions"><button class="btn" id="modalCancelBtn">Cancel</button></div>';
    openModal(html);
    document.getElementById('modalCancelBtn').onclick = closeModal;
    document.querySelectorAll('.picker-item[data-pick]').forEach(function (item) {
      item.onclick = function () {
        var dest = findNode(item.getAttribute('data-pick')); if (!dest) return;
        var parent = findParent(nodeId) || data;
        parent.children = (parent.children || []).filter(function (c) { return c.id !== nodeId; });
        dest.children = dest.children || []; dest.children.push(node);
        scheduleSave(); closeModal(); render();
      };
    });
  }

  /* ═══════════════════════════════════════════════
     SETTINGS MODAL
  ═══════════════════════════════════════════════ */
  function showSettings() {
    apiGet('/userdata?username=' + encodeURIComponent(session.username))
      .then(function (userData) {
        var photos = (userData && userData.securityPhotos) ? userData.securityPhotos : [];
        var photosHtml = photos.length
          ? '<div class="security-photo-grid">' +
            photos.map(function (p) {
              return '<div class="security-photo-item"><img src="' + p.photo + '" alt=""><div class="spi-time">' + (p.time ? p.time.slice(0,16).replace('T',' ') : '') + '</div></div>';
            }).join('') + '</div>'
          : '<p style="font-size:.75rem;color:var(--ink-soft)">Koi unauthorized attempt nahi hua.</p>';

        openModal(
          '<h3>&#9881; Settings</h3>' +
          '<div class="settings-section">' +
            '<h4>Account</h4>' +
            '<p style="font-size:.78rem;color:var(--ink-soft);margin-bottom:10px;">Logged in as <strong>' + esc(session.username) + '</strong> (' + esc(session.email) + ')</p>' +
            '<button class="btn" id="changePinBtn" style="margin-bottom:8px;width:100%">&#128274; Change PIN / Pattern / Password</button>' +
            '<button class="btn" id="feedbackBtn" style="margin-bottom:8px;width:100%">&#128172; Send Feedback</button>' +
            '<button class="btn danger" id="deleteAccountBtn" style="width:100%">&#128465; Delete my account</button>' +
          '</div>' +
          '<div class="settings-section">' +
            '<h4>Security Alerts</h4>' + photosHtml +
          '</div>' +
          '<div class="modal-actions"><button class="btn gold" id="logoutBtn">Logout</button></div>'
        );
        document.getElementById('changePinBtn').onclick = function () { closeModal(); showSetPinScreen(true); };
        document.getElementById('feedbackBtn').onclick = function () { closeModal(); showFeedback(); };
        document.getElementById('logoutBtn').onclick = function () { clearSession(); showAuthScreen(); };
        document.getElementById('deleteAccountBtn').onclick = function () {
          var pass = prompt('Account permanently delete karna hai? Apna password confirm karo:');
          if (!pass) return;
          apiDelete('/account', { username: session.username, email: session.email, password: pass })
            .then(function (res) {
              if (res.success) { clearSession(); closeModal(); showAuthScreen(); }
              else { alert(res.error || 'Failed.'); }
            }).catch(function () { alert('Network error.'); });
        };
      })
      .catch(function () {
        openModal('<h3>Settings</h3><p>Could not load settings.</p><div class="modal-actions"><button class="btn" id="modalCancelBtn">Close</button></div>');
        document.getElementById('modalCancelBtn').onclick = closeModal;
      });
  }

  /* ═══════════════════════════════════════════════
     FEEDBACK
  ═══════════════════════════════════════════════ */
  function showFeedback() {
    openModal(
      '<h3>&#128172; Send Feedback</h3>' +
      '<p style="font-size:.78rem;color:var(--ink-soft);margin-bottom:16px;">Tumhara feedback humein tool improve karne mein madad karta hai!</p>' +
      '<label class="field-label">Name</label>' +
      '<input type="text" id="fbName" value="' + esc(session.username) + '" placeholder="Tumhara naam">' +
      '<label class="field-label">Email</label>' +
      '<input type="email" id="fbEmail" value="' + esc(session.email) + '" placeholder="tumhari@email.com">' +
      '<label class="field-label">Feedback</label>' +
      '<textarea id="fbText" placeholder="Kya accha laga? Kya improve ho sakta hai? Koi bug mila?" style="min-height:100px;"></textarea>' +
      '<label class="field-label">Screenshot (optional)</label>' +
      '<div style="margin-bottom:4px;">' +
        '<input type="file" id="fbScreenshot" accept="image/*" style="font-size:.75rem;color:var(--ink-soft);">' +
      '</div>' +
      '<div class="auth-error" id="fbErr"></div>' +
      '<div class="modal-actions">' +
        '<button class="btn" id="modalCancelBtn">Cancel</button>' +
        '<button class="btn gold" id="fbSubmitBtn">&#128640; Submit</button>' +
      '</div>'
    );

    document.getElementById('modalCancelBtn').onclick = closeModal;
    document.getElementById('fbSubmitBtn').onclick = function () {
      var name       = document.getElementById('fbName').value.trim();
      var email      = document.getElementById('fbEmail').value.trim();
      var text       = document.getElementById('fbText').value.trim();
      var fileInput  = document.getElementById('fbScreenshot');
      var errEl      = document.getElementById('fbErr');
      var submitBtn  = document.getElementById('fbSubmitBtn');

      if (!name || !email || !text) {
        errEl.textContent = 'Name, email aur feedback text zaroori hai.';
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Submitting...';

      function sendFeedback(screenshotData) {
        var payload = {
          username: session.username,
          name: name,
          email: email,
          feedback: text,
          screenshot: screenshotData || null,
          time: new Date().toISOString()
        };
        apiPost('/feedback', payload)
          .then(function (res) {
            if (res.success) {
              closeModal();
              // Success toast
              var t = document.createElement('div');
              t.textContent = '✅ Feedback submit ho gaya! Shukriya!';
              t.style.cssText = 'position:fixed;bottom:18px;left:50%;transform:translateX(-50%);background:#2b1b14;color:#e7d8b8;border:1px solid rgba(63,107,74,0.5);border-radius:6px;padding:12px 20px;font-size:.8rem;font-family:var(--font-mono);z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,0.4);';
              document.body.appendChild(t);
              setTimeout(function () { t.remove(); }, 3000);
              snd.success();
            } else {
              errEl.textContent = res.error || 'Submit nahi hua. Try again.';
              submitBtn.disabled = false;
              submitBtn.textContent = '&#128640; Submit';
            }
          })
          .catch(function () {
            errEl.textContent = 'Network error. Try again.';
            submitBtn.disabled = false;
            submitBtn.textContent = '&#128640; Submit';
          });
      }

      // Screenshot hai to pehle read karo
      if (fileInput.files && fileInput.files[0]) {
        var reader = new FileReader();
        reader.onload = function () { sendFeedback(reader.result); };
        reader.readAsDataURL(fileInput.files[0]);
      } else {
        sendFeedback(null);
      }
    };
  }

  /* ═══════════════════════════════════════════════
     EXPORT / IMPORT
  ═══════════════════════════════════════════════ */
  function slugify(name) { return (name || 'export').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'export'; }
  function exportNode(node, prefix) {
    var blob = new Blob([JSON.stringify(node, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = prefix + '-' + slugify(node.name) + '-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  function importBackup(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var parsed; try { parsed = JSON.parse(reader.result); } catch (e) { alert('Invalid JSON file.'); return; }
      if (!parsed || parsed.type !== 'folder') { alert('This does not look like a LinkNest backup.'); return; }
      var prog = progressOf(parsed);
      openModal('<h3>Import &ldquo;' + esc(parsed.name) + '&rdquo;</h3>' +
        '<p style="font-size:.8rem;color:var(--ink-soft);margin:0 0 16px">' + prog.total + ' link(s) found. Kaise import karna hai?</p>' +
        '<div style="display:flex;flex-direction:column;gap:10px;">' +
          '<button class="btn gold" id="mergeBtn" style="text-align:left">Add into current folder<br><span style="font-weight:400;font-size:.72rem;opacity:.75">Current data safe rahega.</span></button>' +
          '<button class="btn danger" id="replaceBtn" style="text-align:left">Replace entire library<br><span style="font-weight:400;font-size:.72rem;opacity:.75">Saab kuch overwrite ho jayega.</span></button>' +
          '<button class="btn" id="modalCancelBtn">Cancel</button>' +
        '</div>');
      document.getElementById('modalCancelBtn').onclick = closeModal;
      document.getElementById('mergeBtn').onclick = function () {
        var clone = regenIds(parsed);
        currentFolder().children = currentFolder().children || [];
        currentFolder().children.push(clone);
        scheduleSave(); closeModal(); render();
      };
      document.getElementById('replaceBtn').onclick = function () {
        if (!confirm('Pakka? Ye poori library replace kar dega.')) return;
        var clone = regenIds(parsed); clone.id = 'root';
        data = clone; path = ['root'];
        scheduleSave(); closeModal(); render();
      };
    };
    reader.readAsText(file);
  }
  function regenIds(node) {
    var clone = JSON.parse(JSON.stringify(node));
    (function walk(n) { n.id = genId(); if (n.type === 'folder' && n.children) n.children.forEach(walk); })(clone);
    return clone;
  }

  /* ═══════════════════════════════════════════════
     DELETE
  ═══════════════════════════════════════════════ */
  function deleteFolder(id) {
    var node = findNode(id); if (!node) return;
    var prog = progressOf(node);
    if (!confirm('Delete "' + node.name + '"? Isme ' + prog.total + ' link(s) hain — sab delete ho jayenge.')) return;
    var parent = findParent(id); if (!parent) return;
    parent.children = parent.children.filter(function (c) { return c.id !== id; });
    if (path.indexOf(id) !== -1) { path = path.slice(0, path.indexOf(id)); if (!path.length) path = ['root']; }
    snd.remove(); scheduleSave(); render();
  }
  function deleteLink(id) {
    var node = findNode(id); if (!node) return;
    if (!confirm('Delete "' + node.name + '"?')) return;
    var parent = findParent(id); if (!parent) return;
    parent.children = parent.children.filter(function (c) { return c.id !== id; });
    snd.remove(); scheduleSave(); render();
  }

  /* ═══════════════════════════════════════════════
     APP EVENT WIRING
  ═══════════════════════════════════════════════ */
  function wireAppEvents() {
    var si = document.getElementById('searchInput');
    if (si) si.oninput = function () {
      searchQuery = si.value; render();
      var el = document.getElementById('searchInput'); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
    };
    var settBtn = document.getElementById('settingsBtn'); if (settBtn) settBtn.onclick = showSettings;
    var expBtn  = document.getElementById('exportBtn');   if (expBtn)  expBtn.onclick  = function () { exportNode(data, 'linknest-full'); };
    var expFBtn = document.getElementById('exportFolderBtn'); if (expFBtn) expFBtn.onclick = function () { exportNode(currentFolder(), 'linknest-folder'); };
    var impBtn  = document.getElementById('importBtn');   if (impBtn)  impBtn.onclick  = function () { document.getElementById('importFileInput').click(); };

    var nfBtn = document.getElementById('newFolderBtn'); if (nfBtn) nfBtn.onclick = function () { promptFolderModal(null); };
    var nlBtn = document.getElementById('newLinkBtn');   if (nlBtn) nlBtn.onclick = function () { promptLinkModal(null); };

    document.querySelectorAll('[data-nav]').forEach(function (el) {
      el.onclick = function () {
        var id = el.getAttribute('data-nav');
        var idx = path.indexOf(id);
        if (idx !== -1) path = path.slice(0, idx + 1);
        render();
      };
    });
    document.querySelectorAll('[data-open]').forEach(function (el) {
      el.onclick = function (e) {
        if (e.target.closest('.card-menu') || e.target.closest('.icon-btn')) return;
        var id = el.getAttribute('data-open'); snd.open(); searchQuery = '';
        var trail = nodePath(id); if (trail) path = trail.map(function (n) { return n.id; });
        render();
      };
    });
    document.querySelectorAll('[data-rename]').forEach(function (el) {
      el.onclick = function (e) { e.stopPropagation(); var n = findNode(el.getAttribute('data-rename')); if (n) promptFolderModal(n); };
    });
    document.querySelectorAll('[data-rename-link]').forEach(function (el) {
      el.onclick = function (e) { e.stopPropagation(); var n = findNode(el.getAttribute('data-rename-link')); if (n) promptLinkModal(n); };
    });
    document.querySelectorAll('[data-delete-folder]').forEach(function (el) {
      el.onclick = function (e) { e.stopPropagation(); deleteFolder(el.getAttribute('data-delete-folder')); };
    });
    document.querySelectorAll('[data-delete-link]').forEach(function (el) {
      el.onclick = function (e) { e.stopPropagation(); deleteLink(el.getAttribute('data-delete-link')); };
    });
    document.querySelectorAll('[data-move]').forEach(function (el) {
      el.onclick = function (e) { e.stopPropagation(); promptMoveModal(el.getAttribute('data-move')); };
    });
    document.querySelectorAll('[data-toggle-watch]').forEach(function (el) {
      el.onclick = function (e) {
        e.stopPropagation();
        var n = findNode(el.getAttribute('data-toggle-watch'));
        if (n) { n.watched = !n.watched; if (n.watched) snd.toggleOn(); else snd.toggleOff(); scheduleSave(); render(); }
      };
    });

    document.getElementById('importFileInput').onchange = function () {
      if (this.files && this.files[0]) importBackup(this.files[0]);
      this.value = '';
    };

    document.body.addEventListener('click', function (e) {
      var el = e.target.closest('.btn,.icon-btn,.trail-tab:not(.current),.picker-item[data-pick]');
      if (!el) return;
      if (el.hasAttribute('data-delete-folder') || el.hasAttribute('data-delete-link') || el.classList.contains('watch-box')) return;
      snd.click();
    });
  }

  /* ═══════════════════════════════════════════════
     INIT
  ═══════════════════════════════════════════════ */
  function init() {
    session = loadSession();
    if (!session) { showAuthScreen(); return; }
    pinData = loadPinLocal();
    if (pinData) { showLockScreen(); }
    else { loadUserData(); }
  }

  init();

})();

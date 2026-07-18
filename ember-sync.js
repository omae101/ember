// Ember — 클라우드 백업/복원 (백업코드 방식)
// 익명 로그인으로 이 기기 데이터를 서버에 저장. 8자리 코드를 새 폰에 입력하면 복원.
// 사용자는 가입·로그인 없음(익명은 뒤에서 자동). 백업 안 하면 서버 접속 자체를 안 함.
(function () {
  var SB_URL = 'https://cohmddiibstoexwczwbw.supabase.co';
  var SB_KEY = 'sb_publishable_fbQH1CuYV9Lquw76W5YlSw_R5LD4NKq';
  var K_DATA = 'ember_v1', K_LANG = 'ember_lang';
  var K_SPACE = '__ember_space', K_CODE = '__ember_code', K_TS = '__ember_ts';

  var sb = null, ready = false, applying = false, pushTimer = null, channel = null;
  function g(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function s(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function rm(k) { try { localStorage.removeItem(k); } catch (e) {} }
  function space() { return g(K_SPACE); }
  function tsGet() { return parseInt(g(K_TS) || '0', 10); }

  var authStore = {
    getItem: function (k) { return g('__embauth_' + k); },
    setItem: function (k, v) { s('__embauth_' + k, v); },
    removeItem: function (k) { rm('__embauth_' + k); }
  };

  function loadSDK(cb) {
    if (window.supabase && window.supabase.createClient) return cb();
    var el = document.createElement('script');
    el.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
    el.onload = function () { cb(); };
    el.onerror = function () { cb(new Error('네트워크 오류 (SDK 로드 실패)')); };
    document.head.appendChild(el);
  }

  function init(cb) {
    if (ready) return cb();
    loadSDK(function (err) {
      if (err) return cb(err);
      try {
        sb = window.supabase.createClient(SB_URL, SB_KEY, {
          auth: { persistSession: true, autoRefreshToken: true, storageKey: '__embsession', storage: authStore }
        });
      } catch (e) { return cb(e); }
      sb.auth.getSession().then(function (r) {
        if (r.data && r.data.session) { ready = true; return cb(); }
        sb.auth.signInAnonymously().then(function (r2) { if (r2.error) return cb(r2.error); ready = true; cb(); });
      });
    });
  }

  function snapshot() { return { data: g(K_DATA) || '', lang: g(K_LANG) || '', t: Date.now() }; }
  function applySnap(v) { applying = true; try { if (v && v.data != null) s(K_DATA, v.data); if (v && v.lang) s(K_LANG, v.lang); } catch (e) {} applying = false; }

  function push() {
    if (!space() || !ready) return;
    var snap = snapshot();
    sb.from('kv').upsert({ space_id: space(), slot: 'main', k: '__snapshot', v: snap }, { onConflict: 'space_id,slot,k' })
      .then(function (r) { if (!r.error) s(K_TS, String(snap.t)); }, function () {});
  }
  function schedulePush() { if (!space()) return; clearTimeout(pushTimer); pushTimer = setTimeout(push, 1500); }

  function pull(cb) {
    if (!space() || !ready) return cb && cb(false);
    sb.from('kv').select('v').eq('space_id', space()).eq('slot', 'main').eq('k', '__snapshot').maybeSingle()
      .then(function (r) {
        if (r.data && r.data.v) { var v = r.data.v; if (v.t && v.t > tsGet()) { applySnap(v); s(K_TS, String(v.t)); return cb && cb(true); } }
        cb && cb(false);
      }, function () { cb && cb(false); });
  }

  function hookWrites() {
    if (!window.localStorage || window.localStorage.__embhook) return;
    var os = window.localStorage.setItem.bind(window.localStorage);
    window.localStorage.setItem = function (k, v) { os(k, v); if (!applying && (k === K_DATA || k === K_LANG)) schedulePush(); };
    window.localStorage.__embhook = true;
  }

  function subscribe() {
    if (!space() || !ready || channel) return;
    channel = sb.channel('emb-' + space())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'kv', filter: 'space_id=eq.' + space() }, function () {
        pull(function (c) { if (c) location.reload(); });
      }).subscribe();
  }

  // 시작: 이미 백업된 기기면 인증→받아오기→구독→자동저장
  function start() {
    if (!space()) return;
    init(function (err) { if (err) return; hookWrites(); pull(function (c) { if (c) { location.reload(); return; } subscribe(); }); });
  }

  window.EmberSync = {
    isBackedUp: function () { return !!space(); },
    code: function () { return g(K_CODE); },
    // 이 기기 백업(공간 없으면 코드 발급, 있으면 지금 데이터 올림) → cb(err, code)
    backup: function (cb) {
      init(function (err) {
        if (err) return cb(err);
        if (space()) { push(); return cb(null, g(K_CODE)); }
        sb.rpc('create_space_with_code').then(function (r) {
          if (r.error) return cb(r.error);
          var d = r.data;
          s(K_SPACE, d.space_id); s(K_CODE, d.code); s(K_TS, '0');
          hookWrites(); push(); subscribe();
          cb(null, d.code);
        }, function (e) { cb(e); });
      });
    },
    // 코드로 복원 → cb(err)
    restore: function (code, cb) {
      init(function (err) {
        if (err) return cb(err);
        sb.rpc('join_space', { p_code: code }).then(function (r) {
          if (r.error) return cb(r.error);
          var d = r.data;
          s(K_SPACE, d.space_id); s(K_CODE, String(code).toUpperCase()); s(K_TS, '0');
          hookWrites(); pull(function () { cb(null); }); subscribe();
        }, function (e) { cb(e); });
      });
    },
    syncNow: function (cb) { init(function (err) { if (err) return cb && cb(err); push(); pull(function (c) { cb && cb(null, c); if (c) location.reload(); }); }); },
    unlink: function () { rm(K_SPACE); rm(K_CODE); rm(K_TS); if (channel) { try { sb.removeChannel(channel); } catch (e) {} channel = null; } }
  };

  if (document.readyState !== 'loading') start();
  else document.addEventListener('DOMContentLoaded', start);
})();

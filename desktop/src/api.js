/* Tiny API + Tauri helpers shared by the main, settings and overlay pages. */
(function () {
  var T = window.__TAURI__;
  var invoke = T.core.invoke;
  var cfgP = null;
  function cfg() { return cfgP || (cfgP = invoke('get_config')); }

  async function call(path, opts) {
    var c = await cfg();
    var token = await invoke('get_token');
    if (!token) { var e = new Error('signed-out'); e.status = 401; throw e; }
    var headers = Object.assign({ Authorization: 'Bearer ' + token }, (opts && opts.headers) || {});
    var res = await fetch(c.api + path, Object.assign({}, opts, { headers: headers, cache: 'no-store' }));
    if (!res.ok) { var err = new Error('HTTP ' + res.status); err.status = res.status; throw err; }
    var text = await res.text();
    return text ? JSON.parse(text) : {};
  }

  window.MP = {
    invoke: invoke,
    listen: T.event.listen,
    emit: T.event.emit,
    cfg: cfg,
    me: function () { return call('/api/me'); },
    upcoming: function () { return call('/api/upcoming'); },
    putSettings: function (partial) {
      return call('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(partial) });
    },
    linkAccount: async function () {
      // Rust opens a loopback listener and returns its port; the server builds the Google URL for that return address.
      var port = await invoke('link_listen');
      var r = await call('/api/accounts/link', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client: 'desktop', 'return': 'http://127.0.0.1:' + port + '/cb' })
      });
      await invoke('open_url', { url: r.url });
    },
    completeLink: function (code) {
      return call('/api/accounts/link/complete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: code }) });
    },
    removeAccount: function (id) { return call('/api/accounts/' + encodeURIComponent(id), { method: 'DELETE' }); },
    logout: function () { return call('/api/logout', { method: 'POST' }).catch(function () {}); }
  };
})();

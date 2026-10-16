/* Agent Firewall — shared helpers for every page.
 * API contract: docs/interfaces.md. No framework, no build step.
 */
(function () {
  "use strict";

  const AF = {};

  // ---------- Text and formatting ----------

  AF.esc = function (value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  };

  // Escape text, then wrap every case-insensitive occurrence of `highlight` in <mark>.
  AF.highlight = function (text, highlight) {
    const src = String(text == null ? "" : text);
    if (!highlight) return AF.esc(src);
    const lower = src.toLowerCase();
    const needle = String(highlight).toLowerCase();
    let out = "", i = 0, found;
    while ((found = lower.indexOf(needle, i)) !== -1) {
      out += AF.esc(src.slice(i, found));
      out += '<mark class="hl">' + AF.esc(src.slice(found, found + needle.length)) + "</mark>";
      i = found + needle.length;
    }
    return out + AF.esc(src.slice(i));
  };

  AF.time = function (iso) {
    const d = iso ? new Date(iso) : new Date();
    if (isNaN(d.getTime())) return "";
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  };

  AF.argValue = function (v) {
    if (v == null) return "null";
    if (typeof v === "string") return v;
    return JSON.stringify(v);
  };

  // Level from a risk score, matching policy.yaml thresholds (30 hold, 70 red).
  AF.levelFor = function (risk) {
    if (risk == null) return "green";
    if (risk >= 70) return "red";
    if (risk >= 30) return "yellow";
    return "green";
  };

  // Visual meaning of each tool-call status.
  // label: words for sentences; stamp: the short verdict printed on the stamp.
  AF.STATUS = {
    allowed:  { label: "Cleared",                       stamp: "Cleared",  tone: "green" },
    approved: { label: "Allowed by reviewer",           stamp: "Allowed",  tone: "green" },
    held:     { label: "Held for review",               stamp: "Held",     tone: null    }, // tone comes from level
    blocked:  { label: "Blocked by reviewer",           stamp: "Blocked",  tone: "red"   },
    timeout:  { label: "Blocked · no decision in time", stamp: "Timed out", tone: "red"  },
    denied:   { label: "Blocked by policy",             stamp: "Denied",   tone: "red"   },
    error:    { label: "Error",                         stamp: "Error",    tone: "grey"  },
  };

  AF.toneClasses = {
    green:  { dot: "bg-cleared",   badge: "stamp stamp-cleared", row: "log-green"  },
    yellow: { dot: "bg-hold",      badge: "stamp stamp-held",    row: "log-yellow" },
    red:    { dot: "bg-seized",    badge: "stamp stamp-seized",  row: "log-red"    },
    grey:   { dot: "bg-slate-400", badge: "stamp stamp-grey",    row: "log-grey"   },
  };

  AF.toneOf = function (call) {
    const st = AF.STATUS[call.status] || AF.STATUS.error;
    return st.tone || call.level || AF.levelFor(call.risk);
  };

  AF.DECISION_LABEL = {
    allow_once: "Allowed once",
    always_allow: "Always allowed",
    block: "Blocked",
    always_block: "Always blocked",
    timeout: "Blocked on timeout",
  };

  // ---------- Network ----------

  // fetch JSON. Throws an Error with .status. On 401, sends the browser to the
  // login page when opts.loginOn401 is true.
  AF.api = async function (path, opts) {
    opts = opts || {};
    const init = { method: opts.method || "GET", headers: { Accept: "application/json" }, credentials: "same-origin" };
    if (opts.body !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(opts.body);
    }
    if (opts.signal) init.signal = opts.signal;
    let res;
    try {
      res = await fetch(path, init);
    } catch (e) {
      const err = new Error("Cannot reach the server. Check your connection and try again.");
      err.status = 0;
      throw err;
    }
    if (res.status === 401 && opts.loginOn401) {
      const next = encodeURIComponent(location.pathname + location.search + location.hash);
      location.href = "/login?next=" + next;
      return new Promise(function () {}); // stop the caller while the page changes
    }
    let data = null;
    const text = await res.text();
    if (text) {
      try { data = JSON.parse(text); } catch (e) { data = { detail: text }; }
    }
    if (!res.ok) {
      const msg = (data && (data.detail || data.error || data.message)) || ("Request failed (" + res.status + ")");
      const err = new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  };

  // One shared Server-Sent Events connection per page.
  const listeners = [];
  AF.onEvent = function (fn) { listeners.push(fn); };

  function setStreamState(state) {
    const el = document.getElementById("stream-state");
    if (!el) return;
    const map = {
      live: ["bg-cleared animate-pulse", "Live"],
      connecting: ["bg-slate-400", "Connecting…"],
      down: ["bg-seized", "Reconnecting…"],
    };
    const m = map[state] || map.connecting;
    el.innerHTML = '<span class="dot ' + m[0] + '"></span>' + m[1];
  }

  AF.connectEvents = function () {
    if (AF._es || typeof EventSource === "undefined") return;
    setStreamState("connecting");
    const es = new EventSource("/api/events");
    AF._es = es;
    es.onopen = function () { setStreamState("live"); };
    es.onerror = function () { setStreamState("down"); }; // EventSource retries by itself
    es.onmessage = function (msg) {
      let ev;
      try { ev = JSON.parse(msg.data); } catch (e) { return; }
      if (!ev || !ev.type) return;
      listeners.forEach(function (fn) {
        try { fn(ev); } catch (e) { console.error(e); }
      });
    };
  };

  // ---------- UI bits ----------

  let toastTimer = null;
  AF.toast = function (text, tone) {
    const el = document.getElementById("toast");
    if (!el) return;
    el.textContent = text;
    el.className = "pointer-events-none fixed bottom-4 right-4 z-50 max-w-sm rounded-lg px-4 py-3 text-sm font-medium text-white shadow-lg " +
      (tone === "red" ? "bg-seized" : tone === "green" ? "bg-cleared" : "bg-ink");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.add("hidden"); }, 4500);
  };

  // Nav badge with the number of held calls (only visible to a signed-in reviewer).
  AF.setHeldCount = function (n) {
    const el = document.getElementById("nav-held-count");
    if (!el) return;
    el.textContent = String(n);
    el.classList.toggle("hidden", !n);
  };

  AF.listFrom = function (data) {
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.items)) return data.items;
    return [];
  };

  async function refreshHeldCount() {
    try {
      const data = await AF.api("/api/held");
      AF.setHeldCount(AF.listFrom(data).filter(function (h) { return !h.status || h.status === "waiting"; }).length);
    } catch (e) {
      AF.setHeldCount(0); // not signed in, or no API yet
    }
  }

  async function showUser() {
    try {
      const me = await AF.api("/api/me");
      if (!me || !me.user) return;
      AF.user = me.user;
      const box = document.getElementById("nav-user");
      document.getElementById("nav-user-name").textContent = "Signed in as " + me.user;
      box.classList.remove("hidden");
      box.classList.add("flex");
      document.getElementById("nav-logout").addEventListener("click", async function () {
        try { await AF.api("/api/logout", { method: "POST" }); } catch (e) { /* ignore */ }
        location.href = "/login";
      });
    } catch (e) { /* not signed in */ }
  }

  document.addEventListener("DOMContentLoaded", function () {
    showUser();
    refreshHeldCount();
    AF.onEvent(function (ev) {
      if (ev.type === "decision" || (ev.type === "tool_call" && ev.status === "held")) refreshHeldCount();
    });
  });

  window.AF = AF;
})();

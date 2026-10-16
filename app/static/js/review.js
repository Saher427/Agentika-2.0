/* Reviewer dashboard (tasks M1-09 and M1-10): queue of held calls and the evidence card. */
(function () {
  "use strict";
  const AF = window.AF;

  const queueEl = document.getElementById("queue");
  const queueEmpty = document.getElementById("queue-empty");
  const queueCount = document.getElementById("queue-count");
  const historyEl = document.getElementById("history");
  const placeholder = document.getElementById("evidence-placeholder");
  const card = document.getElementById("evidence");
  const $ = function (id) { return document.getElementById(id); };

  let held = [];            // waiting calls (summaries)
  let selectedId = null;
  let current = null;       // full evidence of the selected call
  let deadline = null;
  let tick = null;
  let deciding = false;

  const LEVEL = {
    red:    { header: "bg-seized text-white",  label: "High risk · held for review" },
    yellow: { header: "bg-hold text-white",    label: "Medium risk · held for review" },
    green:  { header: "bg-cleared text-white", label: "Low risk" },
  };

  // What a person would have seen in their email client: HTML comments,
  // hidden elements and image alt text removed. Used for the UV-lamp toggle.
  const HIDDEN_STYLE = /display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:\.0+)?\s*(?:;|$)|font-size\s*:\s*[01](?:px|pt)?\s*(?:;|$)|(?:^|;)\s*color\s*:\s*(?:#fff\b|#ffffff\b|white\b)/i;
  function personView(text) {
    const src = String(text || "");
    const at = src.search(/<(?:!doctype|html|body|p|div|span|h\d|img|!--)/i);
    if (at === -1) return src;
    const head = src.slice(0, at);
    let doc;
    try { doc = new DOMParser().parseFromString(src.slice(at), "text/html"); } catch (e) { return src; }
    const root = doc.body || doc.documentElement;
    const walker = doc.createTreeWalker(doc, NodeFilter.SHOW_COMMENT);
    const comments = [];
    while (walker.nextNode()) comments.push(walker.currentNode);
    comments.forEach(function (c) { c.remove(); });
    root.querySelectorAll("[style]").forEach(function (el) { if (HIDDEN_STYLE.test(el.getAttribute("style"))) el.remove(); });
    root.querySelectorAll("img").forEach(function (el) { el.replaceWith(doc.createTextNode("[image]")); });
    root.querySelectorAll("p, div, h1, h2, h3, h4, br, li").forEach(function (el) { el.append(doc.createTextNode("\n")); });
    const body = root.textContent.replace(/\n{3,}/g, "\n\n").trim();
    return head + body;
  }

  function domainOf(addr) {
    const m = String(addr || "").match(/@([^\s>]+)$/);
    return m ? m[1].toLowerCase() : "";
  }

  function sourceThatCausedIt(h) {
    const ev = (h.evidence || []).find(function (e) { return e.trusted === false && e.highlight; });
    return ev ? ev.source : null;
  }

  // A one-line, plain-English description of the held call.
  function headline(h) {
    const a = h.args || {};
    let what;
    if (h.tool === "send_email") {
      what = "The agent wants to email " + (a.attachment ? a.attachment + " " : "") + "to " + (a.to || "an unknown address");
      if (a.cc && a.cc.length) what += " (cc " + a.cc.join(", ") + ")";
    } else if (h.tool === "delete_record") {
      what = "The agent wants to permanently delete customer record " + (a.record_id || "?");
    } else {
      what = "The agent wants to call " + h.tool;
    }
    const src = sourceThatCausedIt(h);
    return what + (src ? ", because " + src + " told it to." : ".");
  }

  function patternText(h) {
    const a = h.args || {};
    const p = h.patterns || {};
    const blockP = p.always_block || (a.to ? "every call to the domain " + domainOf(a.to) : h.tool + " with these arguments");
    const allowP = p.always_allow || (a.to ? h.tool + " to " + a.to : h.tool + " with these arguments");
    return "Always block: " + blockP + ". Always allow: " + allowP + ".";
  }

  // ---------- Queue ----------

  function renderQueue() {
    queueEl.innerHTML = "";
    const waiting = held.filter(function (h) { return !h.status || h.status === "waiting"; });
    queueCount.textContent = String(waiting.length);
    AF.setHeldCount(waiting.length);
    queueEmpty.classList.toggle("hidden", waiting.length > 0);
    waiting.forEach(function (h) {
      const level = h.level || AF.levelFor(h.risk);
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "queue-item" + (h.id === selectedId ? " queue-item-active" : "");
      btn.innerHTML =
        '<span class="flex items-center justify-between gap-2">' +
          '<span class="font-mono text-sm font-semibold">' + AF.esc(h.tool) + "</span>" +
          '<span class="' + (AF.toneClasses[level] || AF.toneClasses.grey).badge + '">risk ' + AF.esc(h.risk) + "</span>" +
        "</span>" +
        '<span class="mt-1 block truncate text-sm text-ink-2">' + AF.esc(h.args && (h.args.to || h.args.record_id) || h.user_task || "") + "</span>" +
        '<span class="mt-0.5 block truncate text-xs text-ink-muted">Task: ' + AF.esc(h.user_task || "") + "</span>";
      btn.addEventListener("click", function () { select(h.id); });
      li.appendChild(btn);
      queueEl.appendChild(li);
    });
  }

  async function loadQueue(keepSelection) {
    const data = await AF.api("/api/held", { loginOn401: true });
    held = AF.listFrom(data);
    renderQueue();
    const waiting = held.filter(function (h) { return !h.status || h.status === "waiting"; });
    const fromUrl = new URLSearchParams(location.search).get("id");
    if (keepSelection && selectedId) return;
    const target = (fromUrl && waiting.find(function (h) { return h.id === fromUrl; })) ? fromUrl : (waiting[0] && waiting[0].id);
    if (target) select(target);
    else if (!selectedId) showPlaceholder();
  }

  function showPlaceholder() {
    card.classList.add("hidden");
    placeholder.classList.remove("hidden");
    stopTimer();
  }

  // ---------- Evidence card ----------

  async function select(id) {
    selectedId = id;
    renderQueue();
    try {
      const h = await AF.api("/api/held/" + encodeURIComponent(id), { loginOn401: true });
      if (selectedId !== id) return;
      renderEvidence(h);
      history.replaceState(null, "", "/review?id=" + encodeURIComponent(id));
    } catch (err) {
      AF.toast("Could not load this call: " + err.message, "red");
    }
  }

  function renderEvidence(h) {
    current = h;
    placeholder.classList.add("hidden");
    card.classList.remove("hidden");

    const level = h.level || AF.levelFor(h.risk);
    const L = LEVEL[level] || LEVEL.yellow;
    $("ev-header").className = "px-6 py-5 " + L.header;
    const fill = $("ev-meter-fill");
    fill.style.width = "0";
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { fill.style.width = Math.max(0, Math.min(100, Number(h.risk) || 0)) + "%"; });
    });
    $("ev-level-label").textContent = L.label;
    $("ev-headline").textContent = headline(h);
    $("ev-risk").textContent = h.risk != null ? String(h.risk) : "—";

    $("ev-task").textContent = h.user_task || "(unknown task)";

    // Tool results the agent read
    const sources = $("ev-sources");
    sources.innerHTML = "";
    const evidence = h.evidence || [];
    if (!evidence.length) {
      sources.innerHTML = '<li class="text-sm text-ink-muted">No tool results were recorded before this call.</li>';
    }
    // The source with the hidden instruction comes first and stays open; the
    // rest fold away so a reviewer understands the card in seconds.
    const key = function (e) { return e.highlight ? 0 : 1; };
    const ordered = evidence.slice().sort(function (a, b) { return key(a) - key(b); });
    const main = ordered.filter(function (e) { return e.highlight; });
    const rest = ordered.filter(function (e) { return !e.highlight; });
    const shown = main.length ? main : rest.splice(0, 1);
    const appendSource = function (e, parent) {
      const li = document.createElement("li");
      const untrusted = e.trusted === false;
      if (e.highlight) {
        // Signature: the UV lamp. Shows the raw text the AI read with the hidden
        // instruction glowing, and a toggle to what a person saw.
        li.className = "uv-panel";
        li.innerHTML =
          '<div class="uv-head">' +
            '<span class="font-semibold text-white">' + AF.esc(e.source) + "</span>" +
            '<span class="stamp stamp-seized !bg-transparent !text-[#FF8FA3]">Untrusted</span>' +
            '<span class="font-mono text-[.7rem] uppercase tracking-[.14em] text-uv-glow/80" data-role="mode">UV lamp · what the AI read</span>' +
            '<button type="button" class="uv-toggle ml-auto" data-role="toggle" aria-pressed="false">Show what a person saw</button>' +
          "</div>" +
          '<pre class="uv-text" data-role="uv">' + AF.highlight(e.text, e.highlight).replace(/class="hl"/g, 'class="hl-uv"') + "</pre>" +
          '<pre class="person-text hidden" data-role="person">' + AF.esc(personView(e.text)) + "</pre>";
        const btn = li.querySelector('[data-role="toggle"]');
        btn.addEventListener("click", function () {
          const personOn = btn.getAttribute("aria-pressed") !== "true";
          btn.setAttribute("aria-pressed", String(personOn));
          btn.textContent = personOn ? "Switch the UV lamp back on" : "Show what a person saw";
          li.querySelector('[data-role="uv"]').classList.toggle("hidden", personOn);
          li.querySelector('[data-role="person"]').classList.toggle("hidden", !personOn);
          li.querySelector('[data-role="mode"]').textContent = personOn ? "Normal view · what a person saw" : "UV lamp · what the AI read";
        });
      } else {
        li.className = "rounded-lg border bg-white " + (untrusted ? "border-hold/40" : "border-rule");
        li.innerHTML =
          '<div class="flex flex-wrap items-center gap-2 border-b border-rule px-4 py-2">' +
            '<span class="font-semibold">' + AF.esc(e.source) + "</span>" +
            (untrusted ? '<span class="stamp stamp-held">Untrusted</span>' : '<span class="stamp stamp-cleared">Trusted</span>') +
          "</div>" +
          '<pre class="evidence-text">' + AF.esc(e.text) + "</pre>";
      }
      parent.appendChild(li);
    };
    shown.forEach(function (e) { appendSource(e, sources); });
    if (rest.length) {
      const untrustedCount = rest.filter(function (e) { return e.trusted === false; }).length;
      const li = document.createElement("li");
      const details = document.createElement("details");
      details.className = "rounded-lg border border-rule bg-paper/60";
      details.innerHTML = '<summary class="cursor-pointer select-none px-4 py-2.5 text-sm font-semibold text-ink-2">Show ' +
        rest.length + " other source" + (rest.length > 1 ? "s" : "") + " the agent read" +
        (untrustedCount ? " (" + untrustedCount + " untrusted)" : "") + "</summary>";
      const inner = document.createElement("ul");
      inner.className = "space-y-3 px-3 pb-3";
      rest.forEach(function (e) { appendSource(e, inner); });
      details.appendChild(inner);
      li.appendChild(details);
      sources.appendChild(li);
    }

    // Proposed call
    $("ev-tool").textContent = h.tool;
    const args = $("ev-args");
    args.innerHTML = "";
    Object.keys(h.args || {}).forEach(function (k) {
      const row = document.createElement("div");
      row.className = "flex flex-wrap gap-x-2";
      const tainted = (h.tainted_args || []).indexOf(k) !== -1;
      row.innerHTML = '<dt class="text-[#F6C77A]">' + AF.esc(k) + ':</dt><dd class="break-all ' + (tainted ? "rounded bg-seized/40 px-1 text-white ring-1 ring-[#FF8FA3]" : "text-[#9FE7D4]") + '">' +
        AF.esc(JSON.stringify(h.args[k])) + "</dd>" +
        (tainted ? '<dd class="font-sans text-[.68rem] font-semibold uppercase tracking-wider text-[#FF8FA3]">from untrusted text</dd>' : "");
      args.appendChild(row);
    });

    // Reasons
    const reasons = $("ev-reasons");
    reasons.innerHTML = "";
    (h.reasons || []).forEach(function (r) {
      const li = document.createElement("li");
      li.className = "flex items-start gap-2";
      li.innerHTML = '<span class="mt-[.55rem] h-1.5 w-1.5 shrink-0 rounded-full bg-seized" aria-hidden="true"></span><span>' + AF.esc(r) + "</span>";
      reasons.appendChild(li);
    });
    $("ev-partial").classList.toggle("hidden", !h.partial);

    $("ev-pattern").textContent = patternText(h);

    // Decision state
    const decided = h.status && h.status !== "waiting";
    setButtons(!decided);
    const res = $("ev-result");
    if (decided) showResult(h.status, h.decision);
    else res.classList.add("hidden");

    // Timer
    stopTimer();
    if (!decided) {
      if (h.expires_at) deadline = new Date(h.expires_at).getTime();
      else if (h.expires_in != null) deadline = Date.now() + Number(h.expires_in) * 1000;
      else deadline = null;
      updateTimer();
      tick = setInterval(updateTimer, 250);
    } else {
      $("ev-timer").textContent = "—";
    }
  }

  function stopTimer() {
    clearInterval(tick);
    tick = null;
    const el = $("ev-timer");
    if (el) { el.textContent = "—"; el.classList.remove("text-seized"); }
  }

  function updateTimer() {
    const el = $("ev-timer");
    if (!deadline) { el.textContent = "—"; return; }
    const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    el.textContent = Math.floor(left / 60) + ":" + String(left % 60).padStart(2, "0");
    el.classList.toggle("text-seized", left <= 20);
    if (left === 0) {
      stopTimer();
      setButtons(false);
      showResult("timeout", "timeout");
      // The server blocks the call itself; refresh to pick up its decision.
      setTimeout(function () { loadQueue(true).catch(function () {}); }, 1500);
    }
  }

  function setButtons(enabled) {
    document.querySelectorAll("#ev-actions button").forEach(function (b) { b.disabled = !enabled; });
  }

  function showResult(status, decision) {
    const res = $("ev-result");
    const allowed = status === "approved" || (decision && decision.indexOf("allow") !== -1);
    const word = { allow_once: "Allowed", always_allow: "Always allowed", block: "Blocked", always_block: "Always blocked", timeout: "Timed out" }[decision] || (allowed ? "Allowed" : "Blocked");
    res.className = "mt-4 flex flex-wrap items-center gap-4";
    res.innerHTML = '<span class="verdict ' + (allowed ? "text-cleared" : "text-seized") + '">' + AF.esc(word) + "</span>" +
      '<span class="text-sm font-medium text-ink-2">' +
      (allowed ? "The agent will carry out this action." : "The action was not carried out, and the agent was told why.") + "</span>";
  }

  function addHistory(h, decision) {
    const empty = $("history-empty");
    if (empty) empty.remove();
    const li = document.createElement("li");
    const allowed = decision.indexOf("allow") !== -1;
    li.className = "flex items-center gap-2";
    li.innerHTML = '<span class="stamp ' + (allowed ? "stamp-cleared" : "stamp-seized") + '">' + AF.esc(AF.DECISION_LABEL[decision] || decision) + "</span>" +
      '<span class="truncate font-mono text-xs">' + AF.esc(h.tool) + "</span>" +
      '<span class="ml-auto font-mono text-xs text-ink-muted">' + AF.esc(AF.time()) + "</span>";
    historyEl.prepend(li);
  }

  async function decide(decision) {
    if (!current || deciding) return;
    deciding = true;
    setButtons(false);
    const h = current;
    try {
      const out = await AF.api("/api/held/" + encodeURIComponent(h.id) + "/decision", {
        method: "POST", body: { decision: decision }, loginOn401: true,
      });
      stopTimer();
      h.status = (out && out.status) || (decision.indexOf("allow") !== -1 ? "approved" : "blocked");
      showResult(h.status, decision);
      addHistory(h, decision);
      AF.toast(AF.DECISION_LABEL[decision] + ": " + h.tool, decision.indexOf("allow") !== -1 ? "green" : "red");
      held = held.filter(function (x) { return x.id !== h.id; });
      renderQueue();
      setTimeout(function () {
        const next = held.find(function (x) { return !x.status || x.status === "waiting"; });
        if (next) select(next.id);
      }, 1800);
    } catch (err) {
      setButtons(true);
      if (err.status === 409) {
        AF.toast("This call was already decided.", "red");
        loadQueue(false).catch(function () {});
      } else {
        AF.toast("Decision failed: " + err.message, "red");
      }
    } finally {
      deciding = false;
    }
  }

  document.querySelectorAll("#ev-actions button").forEach(function (b) {
    b.addEventListener("click", function () { decide(b.dataset.decision); });
  });

  // Keyboard shortcut for the stage demo: B = block. There is deliberately no
  // shortcut for allowing: letting a risky action through should take a click.
  document.addEventListener("keydown", function (e) {
    if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (!current || card.classList.contains("hidden")) return;
    if ((e.key === "b" || e.key === "B") && (!current.status || current.status === "waiting")) decide("block");
  });

  // ---------- Live updates ----------

  AF.onEvent(function (ev) {
    if (ev.type === "tool_call" && ev.status === "held") {
      AF.toast("New action held for review: " + ev.tool, ev.level === "red" ? "red" : null);
      loadQueue(!!(current && (!current.status || current.status === "waiting"))).catch(function () {});
    } else if (ev.type === "decision") {
      const wasSelected = current && ev.held_id === current.id;
      held = held.filter(function (x) { return x.id !== ev.held_id; });
      renderQueue();
      if (wasSelected && !deciding && $("ev-result").classList.contains("hidden")) {
        current.status = ev.status;
        stopTimer();
        setButtons(false);
        showResult(ev.status, ev.decision);
      }
    }
  });

  loadQueue(false).catch(function (err) {
    placeholder.textContent = "The review queue did not load: " + err.message + ". Reload the page to try again.";
  });
  AF.connectEvents();
})();

/* Review page (tasks M1-09 and M1-10): the queue of held calls and the case
 * file for the selected one. */
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

  let held = [];            // waiting calls
  let selectedId = null;
  let current = null;       // full evidence of the selected call
  let deadline = null;
  let tick = null;
  let deciding = false;

  const LEVEL = {
    red:    { tag: "tag tag-stop",    label: "◼ held · high risk",   risk: "text-stop", meter: "bg-stop" },
    yellow: { tag: "tag tag-hold",    label: "◼ held · medium risk", risk: "text-hold", meter: "bg-hold" },
    green:  { tag: "tag tag-neutral", label: "low risk",             risk: "text-ink",  meter: "bg-ink-muted" },
  };

  // The email as a person would see it in their mail client: HTML comments,
  // hidden elements (white text, display:none, 1px fonts) and image alt text removed.
  const HIDDEN_STYLE = /display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:\.0+)?\s*(?:;|$)|font-size\s*:\s*[01](?:px|pt)?\s*(?:;|$)|(?:^|;)\s*color\s*:\s*(?:#fff\b|#ffffff\b|white\b)/i;
  function renderedView(text) {
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
    return head + root.textContent.replace(/\n{3,}/g, "\n\n").trim();
  }

  function domainOf(addr) {
    const m = String(addr || "").match(/@([^\s>]+)$/);
    return m ? m[1].toLowerCase() : "";
  }

  function sourceThatCausedIt(h) {
    const ev = (h.evidence || []).find(function (e) { return e.trusted === false && e.highlight; });
    return ev ? ev.source : null;
  }

  // One plain sentence: what the agent is trying to do, and why.
  function headline(h) {
    const a = h.args || {};
    let what;
    if (h.tool === "send_email") {
      what = "Wants to email " + (a.attachment ? a.attachment + " " : "") + "to " + (a.to || "an unknown address");
      if (a.cc && a.cc.length) what += " (cc " + a.cc.join(", ") + ")";
    } else if (h.tool === "delete_record") {
      what = "Wants to delete customer record " + (a.record_id || "?") + " for good";
    } else {
      what = "Wants to run " + h.tool;
    }
    const src = sourceThatCausedIt(h);
    return what + (src ? ", because " + src + " told it to." : ".");
  }

  function patternText(h) {
    const a = h.args || {};
    const p = h.patterns || {};
    const blockP = p.always_block || (a.to ? "every call to " + domainOf(a.to) : h.tool + " with these arguments");
    const allowP = p.always_allow || (a.to ? h.tool + " to " + a.to : h.tool + " with these arguments");
    return "Always block saves a rule for " + blockP + ". Always allow saves one for " + allowP + ".";
  }

  function isWaiting(h) { return !h.status || h.status === "waiting"; }

  // ---------- Queue ----------

  function renderQueue() {
    queueEl.innerHTML = "";
    const waiting = held.filter(isWaiting);
    queueCount.textContent = String(waiting.length);
    AF.setHeldCount(waiting.length);
    queueEmpty.classList.toggle("hidden", waiting.length > 0);
    waiting.forEach(function (h) {
      const level = h.level || AF.levelFor(h.risk);
      const L = LEVEL[level] || LEVEL.yellow;
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "queue-item" + (h.id === selectedId ? " queue-item-active" : "");
      if (h.id === selectedId) btn.setAttribute("aria-current", "true");
      btn.innerHTML =
        '<span class="flex items-baseline justify-between gap-2">' +
          '<span class="font-mono text-[.88rem] font-semibold">' + AF.esc(h.tool) + "</span>" +
          '<span class="font-mono text-[.95rem] font-semibold ' + L.risk + '">' + AF.esc(h.risk) + "</span>" +
        "</span>" +
        '<span class="mt-0.5 block truncate font-mono text-[.8rem] text-ink-2">' + AF.esc(h.args && (h.args.to || h.args.record_id) || "") + "</span>" +
        '<span class="mt-0.5 block truncate text-[.8rem] text-ink-muted">“' + AF.esc(h.user_task || "") + "”</span>";
      btn.addEventListener("click", function () { select(h.id); });
      li.appendChild(btn);
      queueEl.appendChild(li);
    });
  }

  async function loadQueue(keepSelection) {
    const data = await AF.api("/api/held", { loginOn401: true });
    held = AF.listFrom(data);
    renderQueue();
    const waiting = held.filter(isWaiting);
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

  // ---------- Case file ----------

  async function select(id) {
    selectedId = id;
    renderQueue();
    try {
      const h = await AF.api("/api/held/" + encodeURIComponent(id), { loginOn401: true });
      if (selectedId !== id) return;
      renderEvidence(h);
      history.replaceState(null, "", "/review?id=" + encodeURIComponent(id));
    } catch (err) {
      AF.toast("This call did not load: " + err.message, "red");
    }
  }

  // A source the agent read. The one carrying the hidden instruction gets two
  // views: the raw text the agent saw (instruction marked in highlighter) and
  // the email as a person saw it.
  function sourceItem(e) {
    const li = document.createElement("li");
    const untrusted = e.trusted === false;
    const trustTag = untrusted ? '<span class="tag tag-hold">untrusted</span>' : '<span class="tag tag-neutral">trusted</span>';
    if (!e.highlight) {
      li.className = "src";
      li.innerHTML =
        '<div class="src-bar"><span class="text-[.88rem] font-semibold">' + AF.esc(e.source) + "</span>" + trustTag + "</div>" +
        '<pre class="evidence-text">' + AF.esc(e.text) + "</pre>";
      return li;
    }
    const rendered = renderedView(e.text);
    const hiddenFromPerson = rendered.toLowerCase().indexOf(String(e.highlight).toLowerCase()) === -1;
    const uid = "src-" + Math.random().toString(36).slice(2, 8);
    li.className = "src border-stop-line";
    li.innerHTML =
      '<div class="src-bar">' +
        '<span class="text-[.88rem] font-semibold">' + AF.esc(e.source) + "</span>" + trustTag +
        '<span class="ml-auto flex gap-1" role="tablist" aria-label="View of ' + AF.esc(e.source) + '">' +
          '<button type="button" class="src-tab" role="tab" aria-selected="true" aria-controls="' + uid + '-raw" data-view="raw">What the agent read</button>' +
          '<button type="button" class="src-tab" role="tab" aria-selected="false" aria-controls="' + uid + '-seen" data-view="seen">What a person saw</button>' +
        "</span>" +
      "</div>" +
      '<pre class="src-body" id="' + uid + '-raw" role="tabpanel">' + AF.highlight(e.text, e.highlight) + "</pre>" +
      '<pre class="src-rendered hidden" id="' + uid + '-seen" role="tabpanel">' + AF.esc(rendered) + "</pre>" +
      (hiddenFromPerson
        ? '<p class="src-note"><span aria-hidden="true">✕</span><span>The marked sentence is invisible in the email itself. Only the agent could read it.</span></p>'
        : '<p class="src-note"><span aria-hidden="true">✕</span><span>The marked sentence is an instruction aimed at the agent, not the person reading the email.</span></p>');
    li.querySelectorAll(".src-tab").forEach(function (tab) {
      tab.addEventListener("click", function () {
        const seen = tab.dataset.view === "seen";
        li.querySelectorAll(".src-tab").forEach(function (t) { t.setAttribute("aria-selected", String(t === tab)); });
        $(uid + "-raw").classList.toggle("hidden", seen);
        $(uid + "-seen").classList.toggle("hidden", !seen);
      });
    });
    return li;
  }

  function renderEvidence(h) {
    current = h;
    placeholder.classList.add("hidden");
    card.classList.remove("hidden");

    const level = h.level || AF.levelFor(h.risk);
    const L = LEVEL[level] || LEVEL.yellow;
    $("ev-level-label").className = L.tag;
    $("ev-level-label").textContent = L.label;
    $("ev-headline").textContent = headline(h);
    $("ev-risk").textContent = h.risk != null ? String(h.risk) : "—";
    $("ev-risk").className = "risk-num " + L.risk;
    const fill = $("ev-meter-fill");
    fill.className = "meter-fill " + L.meter;
    fill.style.width = "0";
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { fill.style.width = Math.max(0, Math.min(100, Number(h.risk) || 0)) + "%"; });
    });

    $("ev-task").textContent = "“" + (h.user_task || "unknown task") + "”";

    // Sources: the one with the hidden instruction first; the rest fold away.
    const sources = $("ev-sources");
    sources.innerHTML = "";
    const evidence = h.evidence || [];
    if (!evidence.length) {
      sources.innerHTML = '<li class="text-[.92rem] text-ink-muted">No tool results were recorded before this call.</li>';
    }
    const main = evidence.filter(function (e) { return e.highlight; });
    const rest = evidence.filter(function (e) { return !e.highlight; });
    (main.length ? main : rest.splice(0, 1)).forEach(function (e) { sources.appendChild(sourceItem(e)); });
    if (rest.length) {
      const untrustedCount = rest.filter(function (e) { return e.trusted === false; }).length;
      const li = document.createElement("li");
      const details = document.createElement("details");
      details.innerHTML = '<summary class="link-btn cursor-pointer select-none">' + rest.length + " more source" + (rest.length > 1 ? "s" : "") +
        " the agent read" + (untrustedCount ? ", " + untrustedCount + " untrusted" : "") + "</summary>";
      const inner = document.createElement("ul");
      inner.className = "mt-2 space-y-2.5";
      rest.forEach(function (e) { inner.appendChild(sourceItem(e)); });
      details.appendChild(inner);
      li.appendChild(details);
      sources.appendChild(li);
    }

    // The call it wants to run
    $("ev-tool").textContent = h.tool;
    const args = $("ev-args");
    args.innerHTML = "";
    Object.keys(h.args || {}).forEach(function (k) {
      const row = document.createElement("div");
      row.className = "flex flex-wrap items-baseline gap-x-2";
      const tainted = (h.tainted_args || []).indexOf(k) !== -1;
      row.innerHTML = '<dt class="text-[#9AA3AE]">' + AF.esc(k) + "</dt>" +
        '<dd class="break-all ' + (tainted ? "rounded-tag bg-stop px-1 text-white" : "text-[#E3E6EA]") + '">' + AF.esc(JSON.stringify(h.args[k])) + "</dd>" +
        (tainted ? '<dd class="font-sans text-[.75rem] text-[#F0A39B]">← copied from untrusted text</dd>' : "");
      args.appendChild(row);
    });

    // Why it was held
    const reasons = $("ev-reasons");
    reasons.innerHTML = "";
    (h.reasons || []).forEach(function (r) {
      const li = document.createElement("li");
      li.className = "flex gap-2";
      li.innerHTML = '<span class="text-ink-muted" aria-hidden="true">–</span><span>' + AF.esc(r) + "</span>";
      reasons.appendChild(li);
    });
    $("ev-partial").classList.toggle("hidden", !h.partial);

    $("ev-pattern").textContent = patternText(h);

    const decided = !isWaiting(h);
    setButtons(!decided);
    if (decided) showResult(h.status, h.decision);
    else $("ev-result").classList.add("hidden");

    stopTimer();
    if (!decided) {
      if (h.expires_at) deadline = new Date(h.expires_at).getTime();
      else if (h.expires_in != null) deadline = Date.now() + Number(h.expires_in) * 1000;
      else deadline = null;
      updateTimer();
      tick = setInterval(updateTimer, 250);
    }
  }

  function stopTimer() {
    clearInterval(tick);
    tick = null;
    const el = $("ev-timer");
    if (el) { el.textContent = "—"; el.classList.remove("text-stop"); }
  }

  function updateTimer() {
    const el = $("ev-timer");
    if (!deadline) { el.textContent = "—"; return; }
    const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    el.textContent = Math.floor(left / 60) + ":" + String(left % 60).padStart(2, "0");
    el.classList.toggle("text-stop", left <= 20);
    if (left === 0) {
      stopTimer();
      setButtons(false);
      if (current) current.status = "timeout";
      showResult("timeout", "timeout");
      // The server blocks the call itself; refresh to pick up its decision.
      setTimeout(function () { loadQueue(true).catch(function () {}); }, 1500);
    }
  }

  function setButtons(enabled) {
    document.querySelectorAll("#ev-actions button").forEach(function (b) { b.disabled = !enabled; });
  }

  const RESULT_TEXT = {
    allow_once: "Allowed once. The agent is running this call now.",
    always_allow: "Allowed, and saved as a rule. The agent is running this call now.",
    block: "Blocked. The call did not run, and the agent was told why.",
    always_block: "Blocked, and saved as a rule. The call did not run, and the agent was told why.",
    timeout: "Blocked because nobody decided in time. The call did not run.",
  };

  function showResult(status, decision) {
    const res = $("ev-result");
    const allowed = status === "approved" || (decision && decision.indexOf("allow") !== -1);
    res.className = "result-bar mt-3 " + (allowed ? "result-ok" : "result-stop");
    res.innerHTML = '<span class="font-mono text-[1.05rem]" aria-hidden="true">' + (allowed ? "✓" : "✕") + "</span>" +
      "<span>" + AF.esc(RESULT_TEXT[decision] || (allowed ? "Allowed." : "Blocked.")) + "</span>" +
      '<span class="ml-auto font-mono text-[.8rem] opacity-80">' + AF.esc(AF.time()) + "</span>";
  }

  function addHistory(h, decision) {
    const empty = $("history-empty");
    if (empty) empty.remove();
    const li = document.createElement("li");
    const allowed = decision.indexOf("allow") !== -1;
    li.className = "flex items-baseline gap-2";
    li.innerHTML = '<span class="' + (allowed ? "tag tag-ok" : "tag tag-stop") + '">' + (allowed ? "✓ " : "✕ ") + AF.esc((AF.DECISION_LABEL[decision] || decision).toLowerCase()) + "</span>" +
      '<span class="truncate font-mono text-[.8rem]">' + AF.esc(h.tool) + "</span>" +
      '<span class="ml-auto font-mono text-[.75rem] text-ink-muted">' + AF.esc(AF.time()) + "</span>";
    historyEl.prepend(li);
  }

  async function decide(decision) {
    if (!current || deciding || !isWaiting(current)) return;
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
      held = held.filter(function (x) { return x.id !== h.id; });
      renderQueue();
      setTimeout(function () {
        const next = held.find(isWaiting);
        if (next) select(next.id);
      }, 1800);
    } catch (err) {
      setButtons(true);
      if (err.status === 409) {
        AF.toast("Someone already decided this call.", "red");
        loadQueue(false).catch(function () {});
      } else {
        AF.toast("The decision was not saved: " + err.message, "red");
      }
    } finally {
      deciding = false;
    }
  }

  document.querySelectorAll("#ev-actions button").forEach(function (b) {
    b.addEventListener("click", function () { decide(b.dataset.decision); });
  });

  // B blocks the selected call. There is deliberately no shortcut for
  // allowing: letting a risky call run should take a click.
  document.addEventListener("keydown", function (e) {
    if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (!current || card.classList.contains("hidden")) return;
    if (e.key === "b" || e.key === "B") decide("block");
  });

  // ---------- Live updates ----------

  AF.onEvent(function (ev) {
    if (ev.type === "tool_call" && ev.status === "held") {
      AF.toast("New call held: " + ev.tool, ev.level === "red" ? "red" : null);
      loadQueue(!!(current && isWaiting(current))).catch(function () {});
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
    placeholder.textContent = "The queue did not load: " + err.message + ". Reload the page to try again.";
  });
  AF.connectEvents();
})();

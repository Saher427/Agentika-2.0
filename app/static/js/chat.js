/* Chat page (task M1-08): send a task, show the transcript and a live,
 * numbered ledger of every tool call. Held calls wait in their own box
 * until a reviewer decides, then drop into the ledger in order. */
(function () {
  "use strict";
  const AF = window.AF;

  const form = document.getElementById("chat-form");
  const input = document.getElementById("task-input");
  const sendBtn = document.getElementById("send-btn");
  const messages = document.getElementById("messages");
  const statusEl = document.getElementById("chat-status");
  const log = document.getElementById("log");
  const bay = document.getElementById("bay");
  const bayCount = document.getElementById("bay-count");
  const emptyBay = document.getElementById("empty-bay");
  const suggestions = document.querySelectorAll("#suggestions .suggest");

  const calls = new Map();       // call id -> call object
  const serials = new Map();     // call id -> running number shown in the ledger
  let currentRun = null;
  let busy = false;
  let elapsedTimer = null;

  function newRunId() {
    if (window.crypto && crypto.randomUUID) return "run_" + crypto.randomUUID().slice(0, 8);
    return "run_" + Math.random().toString(16).slice(2, 10);
  }

  // ---------- Transcript ----------

  function addMessage(role, html, extraClass) {
    const empty = document.getElementById("empty-chat");
    if (empty) empty.remove();
    const div = document.createElement("div");
    div.className = "msg " + (role === "user" ? "msg-user" : "msg-agent") + (extraClass ? " " + extraClass : "");
    div.innerHTML = '<p class="msg-who">' + (role === "user" ? "You" : "Assistant") + "</p>" + html;
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
    return div;
  }

  function setStatus(html) {
    if (!html) { statusEl.classList.add("hidden"); statusEl.innerHTML = ""; return; }
    statusEl.innerHTML = html;
    statusEl.classList.remove("hidden");
  }

  function setBusy(on) {
    busy = on;
    input.disabled = on;
    sendBtn.disabled = on;
    suggestions.forEach(function (b) { b.disabled = on; });
    sendBtn.textContent = on ? "Working…" : "Send";
  }

  function heldInRun(runId) {
    let n = 0;
    calls.forEach(function (c) { if (c.run_id === runId && c.status === "held") n++; });
    return n;
  }

  function updateWorkingStatus(startedAt) {
    if (!busy) return;
    const secs = Math.round((Date.now() - startedAt) / 1000);
    const held = heldInRun(currentRun);
    if (held) {
      setStatus('<span class="font-semibold text-hold">Paused: ' + held + " call" + (held > 1 ? "s" : "") +
        " waiting for a reviewer.</span> " +
        '<a class="link-btn" href="/review" target="_blank" rel="noopener">Open Review</a> <span class="font-mono text-[.8rem]">' + secs + "s</span>");
    } else {
      setStatus('<span class="inline-flex items-center gap-2"><span class="spinner"></span>Working <span class="font-mono text-[.8rem]">' + secs + "s</span></span>");
    }
  }

  async function send(task) {
    task = (task || "").trim();
    if (!task || busy) return;
    currentRun = newRunId();
    addMessage("user", '<p class="text-[1rem]">' + AF.esc(task) + "</p>");
    input.value = "";
    setBusy(true);
    const startedAt = Date.now();
    updateWorkingStatus(startedAt);
    elapsedTimer = setInterval(function () { updateWorkingStatus(startedAt); }, 1000);

    try {
      const data = await AF.api("/api/chat", { method: "POST", body: { task: task, run_id: currentRun } });
      (data.tool_calls || []).forEach(function (c) {
        if (!c.run_id) c.run_id = data.run_id || currentRun;
        upsertCall(c);
      });
      renderReply(data);
    } catch (err) {
      addMessage("agent", '<p class="font-semibold">The task did not finish.</p><p class="mt-0.5 text-[.92rem]">' + AF.esc(err.message) + "</p>", "msg-error");
    } finally {
      clearInterval(elapsedTimer);
      setStatus("");
      setBusy(false);
      input.focus();
    }
  }

  function renderReply(data) {
    const runCalls = [];
    calls.forEach(function (c) { if (c.run_id === (data.run_id || currentRun)) runCalls.push(c); });
    const stopped = runCalls.filter(function (c) { return ["blocked", "denied", "timeout"].indexOf(c.status) !== -1; });

    let html = '<div class="whitespace-pre-wrap text-[1rem] leading-relaxed">' + AF.esc(data.reply || "(no reply)") + "</div>";
    if (stopped.length) {
      html += '<p class="mt-2.5 text-[.9rem] text-stop">✕ The firewall stopped ' +
        stopped.map(function (c) { return '<span class="font-mono">' + AF.esc(c.tool) + "</span> (" + AF.esc((AF.STATUS[c.status] || {}).label || c.status).toLowerCase() + ")"; }).join(", ") +
        ". It did not run.</p>";
    }
    if (runCalls.length) {
      html += '<p class="mt-1.5 text-[.8rem] text-ink-muted">' + runCalls.length + " tool call" + (runCalls.length > 1 ? "s" : "") + " checked</p>";
    }
    addMessage("agent", html);
  }

  // ---------- Ledger ----------

  function target(call) {
    const a = call.args || {};
    const parts = [];
    if (a.to) parts.push("to " + a.to);
    if (a.cc && a.cc.length) parts.push("cc " + a.cc.join(", "));
    if (a.attachment) parts.push("+ " + a.attachment);
    if (a.record_id) parts.push(a.record_id);
    if (a.month) parts.push(a.month);
    if (a.unread_only) parts.push("unread only");
    return parts.join(" · ");
  }

  function renderCall(call) {
    const tone = AF.toneOf(call);
    const cls = AF.toneClasses[tone] || AF.toneClasses.grey;
    const st = AF.STATUS[call.status] || { label: call.status || "unknown", tag: call.status || "?" };
    let tag = st.tag;
    if (call.status === "held") tag = tone === "red" ? "◼ held · high risk" : "◼ held";
    if (!serials.has(call.id)) serials.set(call.id, serials.size + 1);

    const li = document.createElement("li");
    li.className = "ledger-row " + cls.row + (call.run_id === currentRun ? " row-current" : "");
    li.dataset.id = call.id;
    const reasons = (call.reasons || []).slice(0, 2).map(AF.esc).join("; ");
    const tgt = target(call);
    li.innerHTML =
      '<span class="serial">' + String(serials.get(call.id)).padStart(2, "0") + "</span>" +
      '<div class="min-w-0">' +
        '<div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">' +
          '<span class="font-mono text-[.9rem] font-semibold">' + AF.esc(call.tool) + "</span>" +
          (tgt ? '<span class="min-w-0 break-words font-mono text-[.8rem] text-ink-2">' + AF.esc(tgt) + "</span>" : "") +
          '<span class="ml-auto flex items-baseline gap-2">' +
            (call.risk != null ? '<span class="font-mono text-[.76rem] text-ink-muted">' + AF.esc(call.risk) + "</span>" : "") +
            '<span class="' + cls.badge + '" title="' + AF.esc(st.label) + '">' + AF.esc(tag) + "</span>" +
          "</span>" +
        "</div>" +
        (reasons && call.status !== "allowed" ? '<p class="mt-1 text-[.82rem] text-ink-muted">' + reasons + "</p>" : "") +
        (call.status === "held" && call.held_id ? '<a class="link-btn -ml-1 mt-1 inline-block" target="_blank" rel="noopener" href="/review?id=' + encodeURIComponent(call.held_id) + '">Review this call</a>' : "") +
      "</div>";
    return li;
  }

  function refreshBay() {
    const n = bay.querySelectorAll(".ledger-row").length;
    bayCount.textContent = n + " waiting";
    emptyBay.classList.toggle("hidden", n > 0);
  }

  function upsertCall(call) {
    if (!call || !call.id) return;
    const merged = Object.assign({}, calls.get(call.id) || {}, call);
    calls.set(call.id, merged);
    const el = renderCall(merged);
    const sel = '[data-id="' + CSS.escape(call.id) + '"]';
    const old = log.querySelector(sel) || bay.querySelector(sel);
    const dest = merged.status === "held" ? bay : log;
    if (old && old.parentNode === dest) {
      old.replaceWith(el);
    } else {
      if (old) old.remove();
      if (dest === log) {
        const empty = document.getElementById("empty-log");
        if (empty) empty.remove();
        // Keep the ledger in the order the calls were made.
        const mine = serials.get(call.id);
        const after = Array.prototype.find.call(log.querySelectorAll(".ledger-row"), function (li) {
          return (serials.get(li.dataset.id) || 0) > mine;
        });
        if (after) log.insertBefore(el, after); else log.appendChild(el);
        log.scrollTop = log.scrollHeight;
      } else {
        bay.appendChild(el);
      }
    }
    refreshBay();
  }

  function applyDecision(ev) {
    calls.forEach(function (c) {
      if ((ev.call_id && c.id === ev.call_id) || (ev.held_id && c.held_id === ev.held_id)) {
        upsertCall({ id: c.id, status: ev.status || (ev.decision && ev.decision.indexOf("allow") !== -1 ? "approved" : "blocked") });
      }
    });
  }

  AF.onEvent(function (ev) {
    if (ev.type === "tool_call") upsertCall(ev);
    else if (ev.type === "decision") applyDecision(ev);
  });

  // ---------- Wire up ----------

  form.addEventListener("submit", function (e) { e.preventDefault(); send(input.value); });
  suggestions.forEach(function (b) {
    b.addEventListener("click", function () { send(b.dataset.task); });
  });

  AF.connectEvents();
  input.focus();
})();

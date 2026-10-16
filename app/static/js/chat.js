/* Chat page (task M1-08): send a task, show the reply and a live log of tool calls. */
(function () {
  "use strict";
  const AF = window.AF;

  const form = document.getElementById("chat-form");
  const input = document.getElementById("task-input");
  const sendBtn = document.getElementById("send-btn");
  const messages = document.getElementById("messages");
  const statusEl = document.getElementById("chat-status");
  const log = document.getElementById("log");
  const emptyChat = document.getElementById("empty-chat");

  const calls = new Map();       // call id -> call object
  let currentRun = null;
  let busy = false;
  let elapsedTimer = null;

  function newRunId() {
    if (window.crypto && crypto.randomUUID) return "run_" + crypto.randomUUID().slice(0, 8);
    return "run_" + Math.random().toString(16).slice(2, 10);
  }

  // ---------- Conversation ----------

  function addMessage(role, html, extraClass) {
    if (emptyChat) emptyChat.remove();
    const wrap = document.createElement("div");
    wrap.className = role === "user" ? "flex justify-end" : "flex justify-start";
    const bubble = document.createElement("div");
    bubble.className = (role === "user" ? "bubble-user" : "bubble-agent") + (extraClass ? " " + extraClass : "");
    bubble.innerHTML = html;
    wrap.appendChild(bubble);
    messages.appendChild(wrap);
    messages.scrollTop = messages.scrollHeight;
    return bubble;
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
    document.querySelectorAll("#suggestions .chip").forEach(function (b) { b.disabled = on; });
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
      setStatus('<span class="font-semibold text-seized">' + held + " action" + (held > 1 ? "s are" : " is") +
        " waiting for a security reviewer.</span> The agent is paused. " +
        '<a class="font-semibold text-uv underline underline-offset-2" href="/review" target="_blank" rel="noopener">Open the reviewer dashboard</a> · ' + secs + "s");
    } else {
      setStatus('<span class="inline-flex items-center gap-2"><span class="spinner"></span>The agent is working… ' + secs + "s</span>");
    }
  }

  async function send(task) {
    task = (task || "").trim();
    if (!task || busy) return;
    currentRun = newRunId();
    addMessage("user", AF.esc(task));
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
      addMessage("agent", '<p class="font-semibold">Something went wrong.</p><p class="mt-1 text-sm">' + AF.esc(err.message) + "</p>", "bubble-error");
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

    let html = '<div class="whitespace-pre-wrap">' + AF.esc(data.reply || "(no reply)") + "</div>";
    if (stopped.length) {
      html += '<div class="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-seized/30 bg-seized-soft px-3 py-2 text-sm text-seized">' +
        '<span class="stamp stamp-seized">Stopped</span><span class="font-semibold">Agent Firewall stopped ' + stopped.length + " action" + (stopped.length > 1 ? "s" : "") + ":</span> " +
        stopped.map(function (c) { return AF.esc(c.tool) + " (" + AF.esc((AF.STATUS[c.status] || {}).label || c.status) + ")"; }).join(", ") +
        "</div>";
    }
    if (runCalls.length) {
      html += '<p class="mt-2 font-mono text-[.7rem] uppercase tracking-wider text-ink-muted">' + runCalls.length + " tool call" + (runCalls.length > 1 ? "s" : "") +
        " checked by the firewall</p>";
    }
    addMessage("agent", html);
  }

  // ---------- Live log ----------

  function argSummary(call) {
    const a = call.args || {};
    const keys = ["to", "record_id", "attachment", "month", "status", "unread_only"];
    const parts = [];
    keys.forEach(function (k) { if (a[k] !== undefined && a[k] !== "") parts.push(k + "=" + AF.argValue(a[k])); });
    if (a.cc && a.cc.length) parts.push("cc=" + a.cc.join(", "));
    return parts.join(" · ");
  }

  function renderCall(call) {
    const tone = AF.toneOf(call);
    const cls = AF.toneClasses[tone] || AF.toneClasses.grey;
    const st = AF.STATUS[call.status] || { label: call.status || "unknown", stamp: call.status || "?" };
    let stamp = st.stamp;
    if (call.status === "held") stamp = tone === "red" ? "Held · high risk" : "Held";

    const li = document.createElement("li");
    li.className = "log-item " + cls.row + (call.run_id === currentRun ? " log-current" : "");
    li.dataset.id = call.id;
    const reasons = (call.reasons || []).slice(0, 2).map(AF.esc).join(" · ");
    const summary = argSummary(call);
    li.innerHTML =
      '<div class="flex flex-wrap items-center gap-x-2.5 gap-y-1">' +
        '<span class="font-mono text-[.92rem] font-semibold">' + AF.esc(call.tool) + "</span>" +
        '<span class="' + cls.badge + '" title="' + AF.esc(st.label) + '">' + AF.esc(stamp) + "</span>" +
        '<span class="ml-auto font-mono text-[.7rem] tabular-nums text-ink-muted">' +
          (call.risk != null ? "risk " + AF.esc(call.risk) + " · " : "") + AF.esc(AF.time(call.ts)) + "</span>" +
      "</div>" +
      (summary ? '<p class="mt-1 break-words font-mono text-xs text-ink-2">' + AF.esc(summary) + "</p>" : "") +
      (reasons && call.status !== "allowed" ? '<p class="mt-1 text-xs text-ink-muted">' + reasons + "</p>" : "") +
      (call.status === "held" && call.held_id ? '<a class="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-uv underline underline-offset-2" target="_blank" rel="noopener" href="/review?id=' + encodeURIComponent(call.held_id) + '">Inspect this call →</a>' : "");
    return li;
  }

  // Held calls park in the hold bay; everything else, including a held call
  // once a person has decided, goes down the inspection lane in order.
  const bay = document.getElementById("bay");
  const bayCount = document.getElementById("bay-count");
  const emptyBay = document.getElementById("empty-bay");

  function refreshBay() {
    const n = bay.querySelectorAll(".log-item").length;
    bayCount.textContent = n + " waiting";
    emptyBay.classList.toggle("hidden", n > 0);
  }

  function upsertCall(call) {
    if (!call || !call.id) return;
    const prev = calls.get(call.id);
    const merged = Object.assign({}, prev || {}, call);
    calls.set(call.id, merged);
    const el = renderCall(merged);
    const sel = '[data-id="' + CSS.escape(call.id) + '"]';
    const old = log.querySelector(sel) || bay.querySelector(sel);
    const target = merged.status === "held" ? bay : log;
    if (old && old.parentNode === target) {
      old.replaceWith(el);
    } else {
      if (old) old.remove();
      if (target === log) {
        const empty = document.getElementById("empty-log");
        if (empty) empty.remove();
        // Keep the lane in the order the calls were made.
        const after = Array.prototype.find.call(log.querySelectorAll(".log-item"), function (li) {
          const other = calls.get(li.dataset.id);
          return other && other.ts && merged.ts && other.ts > merged.ts;
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
  document.querySelectorAll("#suggestions .chip").forEach(function (b) {
    b.addEventListener("click", function () { send(b.dataset.task); });
  });

  AF.connectEvents();
  input.focus();
})();

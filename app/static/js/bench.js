/* Benchmark results page (task M1-11). Shows only what GET /api/bench returns. */
(function () {
  "use strict";
  const AF = window.AF;
  const $ = function (id) { return document.getElementById(id); };
  let results = [];
  let filter = "all";

  function pct(n, d) { return d ? Math.round((n / d) * 1000) / 10 + "%" : "—"; }
  function label(cat) { return String(cat || "").replace(/_/g, " "); }

  function passed(r) {
    if (typeof r.passed === "boolean") return r.passed;
    // "held" and "blocked" both count as stopping the call.
    const stop = function (x) { return x === "held" || x === "blocked" || x === "denied"; };
    return r.expected === "held" ? stop(r.actual) : r.actual === r.expected;
  }

  function render(data) {
    const s = data.summary || {};
    $("bench").classList.remove("hidden");
    $("bench-mock").classList.toggle("hidden", !data.mock);

    $("s-catch").textContent = pct(s.attacks_caught, s.attacks_total);
    $("s-catch-sub").textContent = (s.attacks_caught ?? "—") + " of " + (s.attacks_total ?? "—") + " attacks held or blocked";
    $("s-fa").textContent = pct(s.false_alarms, s.normal_total);
    $("s-fa-sub").textContent = (s.false_alarms ?? "—") + " of " + (s.normal_total ?? "—") + " normal tasks held by mistake";
    $("s-delay").textContent = s.avg_added_ms != null ? Math.round(s.avg_added_ms) + " ms" : "—";
    $("s-delay-sub").textContent = s.p95_added_ms != null ? "95th percentile: " + Math.round(s.p95_added_ms) + " ms" : "average extra time on an allowed call";
    $("s-work").textContent = pct(s.reviewed_calls, s.total_calls);
    $("s-work-sub").textContent = (s.reviewed_calls ?? "—") + " of " + (s.total_calls ?? "—") + " tool calls";

    const meta = [];
    if (data.run_at) meta.push("Run: " + new Date(data.run_at).toLocaleString());
    if (data.model) meta.push("Agent model: " + data.model);
    if (data.intent_model) meta.push("Intent model: " + data.intent_model);
    meta.push(results.length + " scenarios");
    $("bench-meta").textContent = meta.join(" · ");

    // One tile per scenario
    const tile = function (r) {
      const ok = passed(r);
      const cls = !ok ? "tile-fail" : r.type === "attack" ? "tile-pass-attack" : "tile-pass-normal";
      return '<span class="tile ' + cls + '" role="img" tabindex="0" title="' + AF.esc(r.id + " · " + r.task + " · expected " + r.expected + ", got " + r.actual) +
        '" aria-label="' + AF.esc(r.id + ": " + (ok ? "as expected" : "not as expected")) + '"></span>';
    };
    $("tiles-attack").innerHTML = results.filter(function (r) { return r.type === "attack"; }).map(tile).join("");
    $("tiles-normal").innerHTML = results.filter(function (r) { return r.type === "normal"; }).map(tile).join("");

    // By category
    const cats = {};
    results.forEach(function (r) {
      const k = r.type + "|" + r.category;
      cats[k] = cats[k] || { type: r.type, category: r.category, n: 0, ok: 0 };
      cats[k].n++;
      if (passed(r)) cats[k].ok++;
    });
    $("cat-body").innerHTML = Object.keys(cats).sort().map(function (k) {
      const c = cats[k];
      const all = c.ok === c.n;
      return '<tr><td class="px-5 py-2.5 capitalize">' + AF.esc(label(c.category)) + "</td>" +
        '<td class="px-5 py-2.5"><span class="stamp ' + "stamp-grey" + '">' + AF.esc(c.type) + "</span></td>" +
        '<td class="px-5 py-2.5 text-right tabular-nums">' + c.n + "</td>" +
        '<td class="px-5 py-2.5 text-right font-semibold tabular-nums ' + (all ? "text-cleared" : "text-seized") + '">' + c.ok + " / " + c.n + "</td></tr>";
    }).join("");

    renderRows();
  }

  function renderRows() {
    const rows = results.filter(function (r) {
      if (filter === "all") return true;
      if (filter === "failed") return !passed(r);
      return r.type === filter;
    });
    $("res-body").innerHTML = rows.length ? rows.map(function (r) {
      const ok = passed(r);
      return "<tr>" +
        '<td class="whitespace-nowrap px-5 py-2.5 font-mono text-xs">' + AF.esc(r.id) + "</td>" +
        '<td class="px-5 py-2.5">' + AF.esc(r.task) + "</td>" +
        '<td class="whitespace-nowrap px-5 py-2.5 capitalize text-ink-muted">' + AF.esc(label(r.category)) + "</td>" +
        '<td class="px-5 py-2.5">' + AF.esc(r.expected) + "</td>" +
        '<td class="whitespace-nowrap px-5 py-2.5"><span class="stamp ' + (ok ? "stamp-cleared" : "stamp-seized") + '">' + (ok ? "✓ " : "✗ ") + AF.esc(r.actual) + "</span></td>" +
        '<td class="px-5 py-2.5 text-right tabular-nums">' + AF.esc(r.risk ?? "—") + "</td>" +
        '<td class="px-5 py-2.5 text-right tabular-nums">' + AF.esc(r.added_ms != null ? Math.round(r.added_ms) : "—") + "</td>" +
        "</tr>";
    }).join("") : '<tr><td colspan="7" class="px-5 py-6 text-center text-ink-muted">No scenarios match this filter.</td></tr>';
  }

  document.querySelectorAll(".filter-btn").forEach(function (b) {
    b.addEventListener("click", function () {
      filter = b.dataset.filter;
      document.querySelectorAll(".filter-btn").forEach(function (x) { x.classList.toggle("filter-btn-active", x === b); });
      renderRows();
    });
  });

  AF.api("/api/bench").then(function (data) {
    results = (data && data.results) || [];
    if (!data || data.status === "no_run" || !results.length) {
      $("bench-empty").classList.remove("hidden");
      return;
    }
    render(data);
  }).catch(function (err) {
    if (err.status === 404) { $("bench-empty").classList.remove("hidden"); return; }
    const box = $("bench-error");
    box.textContent = "The benchmark results did not load: " + err.message + ". Reload the page to try again.";
    box.classList.remove("hidden");
  });
})();

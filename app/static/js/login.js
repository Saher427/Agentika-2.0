/* Reviewer sign-in (task M1-12). The password is checked by the server
 * (REVIEWER_PASSWORD environment variable, task M2-18); nothing is stored here. */
(function () {
  "use strict";
  const AF = window.AF;
  const form = document.getElementById("login-form");
  const btn = document.getElementById("login-btn");
  const errorEl = document.getElementById("login-error");

  function nextUrl() {
    const n = new URLSearchParams(location.search).get("next") || "/review";
    // Only allow same-site paths, never a full URL from the query string.
    return /^\/(?!\/)/.test(n) ? n : "/review";
  }

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.classList.remove("hidden");
  }

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    errorEl.classList.add("hidden");
    const username = form.username.value.trim();
    const password = form.password.value;
    if (!username || !password) { showError("Enter your username and password."); return; }
    btn.disabled = true;
    btn.textContent = "Signing in…";
    try {
      await AF.api("/api/login", { method: "POST", body: { username: username, password: password } });
      location.href = nextUrl();
    } catch (err) {
      showError(err.status === 401 ? "Wrong username or password." : err.message);
      form.password.value = "";
      form.password.focus();
    } finally {
      btn.disabled = false;
      btn.textContent = "Sign in";
    }
  });

  form.password.focus();
})();

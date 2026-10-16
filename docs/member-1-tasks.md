# Member 1: task status

Member 1 is the **Product, Experience and Delivery Lead** (team work plan, section 1). This file tracks every Member 1 task and where its output lives.

The work plan's schedule mentions tasks **M1-16 to M1-21** that its task tables never define. They are defined below from the schedule and the submission rules, so nothing is forgotten.

Legend: ✅ done in this repository · 🟡 prepared, a person must finish it · ⬜ can only be done by a person on the day

| ID | Task | Status | Where |
|---|---|---|---|
| M1-01 | Fake company inbox, about 10 realistic emails | ✅ 10 normal emails + 3 poisoned | [`app/data/inbox.json`](../app/data/inbox.json) |
| M1-02 | 3 poisoned emails: white text, HTML comment, fake "IT admin" | ✅ emails #7, #10, #12 | [`app/data/inbox.json`](../app/data/inbox.json) |
| M1-03 | Fake invoices and records | ✅ 9 invoices, 8 customer records | [`app/data/invoices.json`](../app/data/invoices.json), [`app/data/records.json`](../app/data/records.json) |
| M1-04 | 20 attack + 20 normal benchmark scenarios | ✅ 40 scenarios + 25 emails | [`bench/scenarios.json`](../bench/scenarios.json), [`bench/emails.json`](../bench/emails.json), [`bench/README.md`](../bench/README.md) |
| M1-05 | First policy rules in plain English for Member 2 | ✅ (both members must still agree) | [`docs/policy-rules.md`](policy-rules.md), draft [`policy.yaml`](../policy.yaml) |
| M1-06 | Agent system prompt and tool descriptions | ✅ | [`app/prompts.py`](../app/prompts.py) |
| M1-07 | Message for a blocked action | ✅ reviewer, timeout and policy versions | [`app/prompts.py`](../app/prompts.py) |
| M1-08 | Chat page with a live log of tool calls | ✅ tested against the mock API | [`app/templates/chat.html`](../app/templates/chat.html), [`app/static/js/chat.js`](../app/static/js/chat.js) |
| M1-09 | Reviewer dashboard: queue of held calls | ✅ tested against the mock API | [`app/templates/review.html`](../app/templates/review.html), [`app/static/js/review.js`](../app/static/js/review.js) |
| M1-10 | Evidence card with the four buttons | ✅ tested against the mock API | same as M1-09 |
| M1-11 | Benchmark results page | ✅ shows a "Mock data" warning until real results exist | [`app/templates/bench.html`](../app/templates/bench.html), [`app/static/js/bench.js`](../app/static/js/bench.js) |
| M1-12 | Login page for the demo reviewer account | ✅ page done; the password check is Member 2's (M2-18) | [`app/templates/login.html`](../app/templates/login.html), [`app/static/js/login.js`](../app/static/js/login.js) |
| M1-13 | Visual polish: projector, phone | ✅ "Checkpoint" design: hold bay and inspection lane, rubber-stamp verdicts, UV-lamp evidence view; self-hosted fonts; no sideways scroll at 375 px | [`app/static/src/input.css`](../app/static/src/input.css) |
| M1-14 | Test every deploy on the live URL | 🟡 checklist ready; needs the live URL | [`docs/test-checklist.md`](test-checklist.md) |
| M1-15 | Rehearse the demo 10 times on the live URL | 🟡 script and tracking table ready | [`docs/demo-script.md`](demo-script.md), [`docs/test-checklist.md`](test-checklist.md) |
| M1-16 | Record the 2–3 minute demo video | 🟡 shot list and checklist ready; record it on the live URL | [`docs/demo-script.md`](demo-script.md) |
| M1-17 | LinkedIn post, written by you; teammate reshares | ⬜ **must be written by the team** — AI-written posts are disqualified | [`docs/linkedin-post.md`](linkedin-post.md) (rules and structure only) |
| M1-18 | Screenshots: Discord and the Alternate Clouds dashboard | ⬜ needs your accounts | slots in the submission draft |
| M1-19 | Submission PDF (sections 1–5) | 🟡 draft with everything we can know filled in; personal details, links, screenshots and ticks left for you | [`submission/`](../submission/) |
| M1-20 | Slides PDF ready by 3:00 PM (Top 10) | 🟡 8-slide deck built with the Slides artifact type, in the same design as the app; add team names, real benchmark numbers and the QR code, then download it as PDF | source in [`slides/deck/`](../slides/deck/) |
| M1-21 | README | ✅ | [`README.md`](../README.md) |

## What is still needed from Member 2

The pages and data are ready to plug in, but these Member 2 tasks must exist before anything works on the live URL:

- The real API from [`docs/interfaces.md`](interfaces.md) (M2-07, M2-14 to M2-17). The pages use only that API.
- Reviewer sign-in with `REVIEWER_PASSWORD` from an environment variable (M2-18), including the proposed `/api/login`, `/api/logout` and `/api/me` routes.
- `bench/run_bench.py` writing `bench/results.json` in the shape the results page reads (M2-20).
- Including the pages in the main app: `app.include_router(pages.router)` and `pages.mount_static(app)`.

Until then, `dev/mock_api.py` stands in for all of it locally.

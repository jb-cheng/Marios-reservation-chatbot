#!/usr/bin/env bash
# Start the backend and the frontend together. Ctrl-C stops both.
#
# Two processes because there are two toolchains: FastAPI on 8000 and Vite on
# 5173, with Vite proxying /api so the browser only ever talks to one origin and
# there is no CORS configuration to get wrong.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PY="$ROOT/backend/.venv/Scripts/python.exe"

if [ ! -f "$PY" ]; then
  echo "backend/.venv is missing. Create it once:"
  echo "  cd backend"
  echo "  python -m venv .venv"
  echo "  .venv/Scripts/python.exe -m pip install -r requirements.txt"
  exit 1
fi

if [ ! -d "$ROOT/frontend/node_modules" ]; then
  echo "frontend/node_modules is missing. Install it once:"
  echo "  cd frontend && npm install"
  exit 1
fi

if [ ! -f "$ROOT/backend/.env" ]; then
  echo "note: backend/.env does not exist, so the agent runs on the deterministic"
  echo "      provider with no network calls. Copy backend/.env.example to backend/.env"
  echo "      and add your keys to talk to Cohere and Groq."
fi

cleanup() {
  trap - EXIT INT TERM
  kill "$API_PID" "$WATCHER_PID" 2>/dev/null || true
}

cd "$ROOT/backend"
# httpx reads each NO_PROXY entry as a URL, and this machine's list contains
# [::1]. The brackets make it parse ":1]" as a port, so constructing any client
# raises InvalidURL and the backend dies before it serves a request. The bare
# form is accepted and bypasses the same address, so drop the brackets for these
# processes only rather than editing the machine's environment.
NO_PROXY="${NO_PROXY-}"
NO_PROXY="${NO_PROXY//[\[\]]/}"
no_proxy="${no_proxy-$NO_PROXY}"
no_proxy="${no_proxy//[\[\]]/}"
export NO_PROXY no_proxy

# No --reload. On this machine uvicorn's reloader logs "Reloading..." and then never
# replaces the worker, with either watcher backend and with or without a
# graceful-shutdown timeout, so an edit lands on disk while the running server keeps
# serving the code from before it. That is worse than no reload at all, because
# nothing looks wrong and every test of the fix tests the old code. Restart this
# script after a backend change; Vite still picks up frontend changes on its own.
"$PY" -m uvicorn app.main:app --port 8000 &
API_PID=$!

# A backend that fails to start, or dies later, would otherwise leave the frontend
# serving a page that silently cannot reach its API. If the API goes down, take
# everything down with it so the failure is loud. Polled rather than waited on,
# because a subshell cannot wait on the parent's jobs.
(
  while kill -0 "$API_PID" 2>/dev/null; do sleep 2; done
  echo "backend exited, stopping the frontend too" >&2
  kill 0 2>/dev/null
) &
WATCHER_PID=$!

trap cleanup EXIT INT TERM

cd "$ROOT/frontend"
npm run dev

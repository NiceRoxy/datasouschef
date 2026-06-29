"""
main.py — Firebase Cloud Functions (Python) entry point.
Uses the firebase_functions SDK (required by Firebase CLI).
"""

import json
from firebase_functions import https_fn, options
from firebase_admin import initialize_app

from agent import generate_cleaning_script
from models import DataContract

initialize_app()

# ── CORS ──────────────────────────────────────────────────────────────────────
CORS_OPTIONS = options.CorsOptions(
    cors_origins=[
        "https://datasouschef.com",
        "https://www.datasouschef.com",
        "https://datasouschef.pages.dev",
        "http://localhost:5500",
        "http://127.0.0.1:5500",
    ],
    cors_methods=["POST", "OPTIONS"],
)


@https_fn.on_request(
    cors=CORS_OPTIONS,
    timeout_sec=540,   # 9 minutes — needed for LLM calls
    memory=options.MemoryOption.MB_512,
    region="europe-west2",  # London — closest to UK users
    secrets=["GEMINI_API_KEY", "TAVILY_API_KEY"],
)
def generate_script(req: https_fn.Request) -> https_fn.Response:
    """
    Receives a DataContract JSON body, runs the LangGraph agent,
    returns a Python cleaning script as plain text.
    """
    try:
        body = req.get_json(silent=True)
        if not body:
            return https_fn.Response("Invalid or missing JSON body", status=400)

        contract = DataContract(**body)
        script = generate_cleaning_script(contract)

        return https_fn.Response(
            script,
            status=200,
            content_type="text/plain",
        )

    except Exception as e:
        return https_fn.Response(
            json.dumps({"error": str(e)}),
            status=500,
            content_type="application/json",
        )

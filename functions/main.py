"""
main.py — Firebase Cloud Function (2nd gen) entry point.
Wraps the DataSousChef LangChain/LangGraph agent as an HTTP function.

Deploy with:
  firebase deploy --only functions
"""

import os
import json
import functions_framework
from flask import Request, make_response

from agent import generate_cleaning_script
from models import DataContract

# ── CORS ──────────────────────────────────────────────────────────────────────
ALLOWED_ORIGINS = {
    "https://datasouschef.com",
    "https://www.datasouschef.com",
    "https://datasouschef.pages.dev",
    "http://localhost:5500",
    "http://127.0.0.1:5500",
}

def _cors_headers(request: Request) -> dict:
    origin = request.headers.get("Origin", "")
    allowed = origin if origin in ALLOWED_ORIGINS else "https://datasouschef.com"
    return {
        "Access-Control-Allow-Origin": allowed,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "3600",
    }


@functions_framework.http
def generate_script(request: Request):
    """
    HTTP Cloud Function (2nd gen): receives a DataContract JSON body,
    runs the LangGraph agent, returns a Python script as plain text.
    Timeout and memory are set in .firebaserc / gcloud deployment flags.
    """
    headers = _cors_headers(request)

    # Handle CORS preflight
    if request.method == "OPTIONS":
        return make_response("", 204, headers)

    if request.method != "POST":
        return make_response("Method not allowed", 405, headers)

    try:
        body = request.get_json(silent=True)
        if not body:
            return make_response("Invalid or missing JSON body", 400, headers)

        contract = DataContract(**body)
        script = generate_cleaning_script(contract)

        response = make_response(script, 200)
        response.content_type = "text/plain"
        for k, v in headers.items():
            response.headers[k] = v
        return response

    except Exception as e:
        error_body = json.dumps({"error": str(e)})
        response = make_response(error_body, 500, headers)
        response.content_type = "application/json"
        return response

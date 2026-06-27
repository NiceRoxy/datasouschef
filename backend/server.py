"""
server.py — Render entry point for DataSousChef API.
Avoids relative imports so Render can run:
  uvicorn server:app --host 0.0.0.0 --port $PORT
"""

import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse

from models import DataContract
from agent import generate_cleaning_script

app = FastAPI(title="DataSousChef API", version="0.1.0")

# CORS: allow GitHub Pages frontend and local dev
ALLOWED_ORIGINS = [
    "https://niceroxy.github.io",
    "http://localhost:5500",
    "http://127.0.0.1:5500",
    "http://localhost:8080",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)


@app.get("/")
def health_check():
    return {"status": "ok", "service": "DataSousChef API"}


@app.post("/api/generate-script", response_class=PlainTextResponse)
def generate_script(contract: DataContract):
    """Receive a data contract from the frontend and return a Python cleaning script."""
    return generate_cleaning_script(contract)

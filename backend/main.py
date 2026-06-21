import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse

from .models import DataContract
from .generator import generate_mock_script

app = FastAPI(title="DataSousChef API", version="0.1.0")

# Allow requests from the frontend (GitHub Pages or local development)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # For production, we should restrict this to the exact GitHub Pages URL
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def read_root():
    return {"message": "DataSousChef API is running"}

@app.post("/api/generate-script", response_class=PlainTextResponse)
def generate_script(contract: DataContract):
    """
    Receives the JSON data contract from the frontend,
    validates it using Pydantic, and generates a mock Python script.
    """
    # 1. We have already validated the incoming JSON against the Pydantic models automatically!
    
    # 2. Generate the python script content
    script_content = generate_mock_script(contract)
    
    # 3. Return the string as plain text
    return script_content

if __name__ == "__main__":
    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=True)

# docker compose up -d
# env\Scripts\activate
# uvicorn main:app --reload
# uvicorn main:app --host 0.0.0.0 --port 8000 --reload
import os
import time
import json
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import List, Optional
from qdrant_client import QdrantClient

# Import our custom logic
from agent import email_agent_app
from ingest import build_hybrid_database

# For the Evaluation Endpoint
from langchain_google_genai import ChatGoogleGenerativeAI
from dotenv import load_dotenv

# CHANGED: Import Supabase
from supabase import create_client, Client

load_dotenv()

app = FastAPI(title="Email Agent API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://172.22.0.1:3000","https://smart-draft-deployed.vercel.app"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# CHANGED: Initialize Supabase Client
supabase_url = os.getenv("SUPABASE_URL")
supabase_key = os.getenv("SUPABASE_KEY")
supabase: Client = create_client(supabase_url, supabase_key)

# Dynamically load Qdrant Cloud credentials from .env
qdrant_url = os.getenv("QDRANT_URL", "http://localhost:6333")
qdrant_api_key = os.getenv("QDRANT_API_KEY", None)

client = QdrantClient(url=qdrant_url, api_key=qdrant_api_key)
client.set_model("BAAI/bge-small-en-v1.5")
client.set_sparse_model("Qdrant/bm25")

# --- 1. SCHEMAS ---
class TemplateSearchRequest(BaseModel):
    query: str
    limit: int = 3

class TemplateMatch(BaseModel):
    id: str
    content: str
    source_file: str
    score: float

class TemplateSearchResponse(BaseModel):
    results: List[TemplateMatch]

class EmailGenerateRequest(BaseModel):
    user_input: str
    llm_choice: str = "gemini"
    selected_template: Optional[str] = None
    selected_outline: Optional[str] = None
    manual_template: Optional[str] = None
    
class EmailGenerateResponse(BaseModel):
    final_email: Optional[str] = None
    proposed_outlines: Optional[List[str]] = None
    llm_used: str
    processing_time_ms: float

class AddTemplateRequest(BaseModel):
    filename: str
    content: str

class DeleteTemplateRequest(BaseModel):
    filename: str

class EvaluateTemplateRequest(BaseModel):
    manual_template: str

class EvaluateTemplateResponse(BaseModel):
    llm_failed: bool
    added_to_db: bool
    reason: str
    filename: Optional[str] = None

# --- 2. GENERATION & SEARCH ENDPOINTS ---

@app.post("/search", response_model=TemplateSearchResponse)
async def search_templates(request: TemplateSearchRequest):
    try:
        # Fetch a few extra to ensure we have enough after deduplication
        search_results = client.query(
            collection_name="email_templates",
            query_text=request.query,
            limit=request.limit + 5 
        )

        seen_contents = set()
        formatted_results = []
        
        for point in search_results:
            content = point.document.strip()
            
            # Deduplicate! Only add if we haven't seen this exact text before
            if content not in seen_contents:
                seen_contents.add(content)
                formatted_results.append(
                    TemplateMatch(
                        id=str(point.id),
                        content=content,
                        source_file=point.metadata.get("source_file", "unknown"),
                        score=point.score
                    )
                )
            
            # Stop once we hit the requested limit
            if len(formatted_results) >= request.limit:
                break
                
        return TemplateSearchResponse(results=formatted_results)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/generate", response_model=EmailGenerateResponse)
async def generate_email(request: EmailGenerateRequest):
    try:
        start_time = time.time()
        initial_state = {
            "user_input": request.user_input,
            "llm_choice": request.llm_choice,
            "selected_template": request.selected_template,
            "selected_outline": request.selected_outline,
            "manual_template": request.manual_template
        }
        final_state = email_agent_app.invoke(initial_state)
        processing_time = round((time.time() - start_time) * 1000, 2)
        
        return EmailGenerateResponse(
            final_email=final_state.get("final_email"),
            proposed_outlines=final_state.get("proposed_outlines"),
            llm_used=request.llm_choice,
            processing_time_ms=processing_time
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# --- 3. DATABASE MANAGEMENT & AI EVALUATION ---
@app.get("/collections")
async def collections():
    return client.get_collections()
@app.get("/rebuild")
async def rebuild():
    result = build_hybrid_database()
    return {"result": result}
    
@app.get("/templates")
async def get_all_templates():
    try:
        # CHANGED: Fetch templates directly from Supabase!
        response = supabase.table("email_templates").select("filename, content").execute()
        return {"templates": response.data}
    except Exception as e:
        print(f"Error fetching templates: {e}")
        return {"templates": []}

@app.post("/templates")
async def add_new_template(request: AddTemplateRequest, background_tasks: BackgroundTasks):
    try:
        filename = request.filename if request.filename.endswith(".txt") else f"{request.filename}.txt"
        
        # CHANGED: Upsert (Update or Insert) into Supabase Cloud
        supabase.table("email_templates").upsert(
            {"filename": filename, "content": request.content}
        ).execute()
            
        background_tasks.add_task(build_hybrid_database)
        return {"message": "Template saved successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/templates/delete")
async def delete_template(request: DeleteTemplateRequest, background_tasks: BackgroundTasks):
    try:
        safe_filename = os.path.basename(str(request.filename).strip())
        if not safe_filename:
            raise HTTPException(status_code=400, detail="Filename cannot be empty")
            
        # CHANGED: Delete directly from Supabase via filename match
        response = supabase.table("email_templates").delete().eq("filename", safe_filename).execute()
        
        # If no rows were returned/deleted, it might not exist
        if not response.data:
            print(f"Warning: {safe_filename} not found in Supabase.")
        
        background_tasks.add_task(build_hybrid_database)
        return {"message": f"Deleted {safe_filename}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/evaluate_template", response_model=EvaluateTemplateResponse)
async def evaluate_and_save_template(request: EvaluateTemplateRequest, background_tasks: BackgroundTasks):
    """AI searches DB, compares manual template to existing ones, and decides whether to save it."""
    try:
        # 1. Search for closest existing template
        search_results = client.query(
            collection_name="email_templates",
            query_text=request.manual_template,
            limit=1
        )
        
        best_match = search_results[0].document if search_results else "No existing templates in DB."
        
        # 2. Ask Gemini to evaluate via structured output
        llm = ChatGoogleGenerativeAI(model="gemini-2.5-flash", api_key=os.getenv("GEMINI_API_KEY"))
        
        prompt = f"""
        You are a database administrator. The user wants to add a NEW manual template:
        NEW TEMPLATE:
        {request.manual_template}
        
        The closest existing template in our database is:
        EXISTING TEMPLATE:
        {best_match}
        
        Evaluate if the NEW TEMPLATE is significantly distinct, addresses a new use case, or is better than the EXISTING TEMPLATE.
        Respond ONLY in valid JSON format with NO markdown wrapping.
        {{
            "is_unique": true or false,
            "reason": "Brief 1-sentence explanation of why it was approved or rejected",
            "suggested_filename": "topic_name.txt"
        }}
        """
        
        response = llm.invoke(prompt)
        raw_text = response.content.strip().replace("```json", "").replace("```", "")
        parsed = json.loads(raw_text)
        
        is_unique = parsed.get("is_unique", False)
        reason = parsed.get("reason", "No reason provided")
        
        if is_unique:
            # 3. Save it automatically (Strictly sanitize the filename first)
            raw_filename = parsed.get("suggested_filename", f"auto_template_{int(time.time())}.txt")
            filename = os.path.basename(str(raw_filename).strip().replace(" ", "_"))
            if not filename.endswith(".txt"): filename += ".txt"
            
            # CHANGED: Save AI-approved template to Supabase
            supabase.table("email_templates").upsert(
                {"filename": filename, "content": request.manual_template}
            ).execute()
                
            background_tasks.add_task(build_hybrid_database)
            return EvaluateTemplateResponse(llm_failed=False, added_to_db=True, reason=reason, filename=filename)
        else:
            # 4. Reject it
            return EvaluateTemplateResponse(llm_failed=False, added_to_db=False, reason=reason)
            
    except Exception as e:
        print(f"Evaluation Error: {e}")
        return EvaluateTemplateResponse(llm_failed=True, added_to_db=False, reason="LLM formatting failed or DB error")   
# ### **How to Test This Architecture (The "Aha!" Moment)**

# To truly understand why this design is powerful, you need to see how the graph routes dynamically based on your API request. 

# 1. Ensure your server is running (`uvicorn main:app --reload`).
# 2. Go to `http://localhost:8000/docs` and open the `/generate` endpoint.

# **Test Case A: The "None of these" path (Testing the Proposer Node)**
# If the frontend says the user rejected the templates, it will send this JSON payload:
# ```json
# {
#   "user_input": "I need to tell my team about a delay in the server migration.",
#   "llm_choice": "gemini",
#   "selected_template": null,
#   "selected_outline": null,
#   "manual_template": null
# }

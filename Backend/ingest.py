import os
import uuid
from qdrant_client import QdrantClient
from dotenv import load_dotenv

# CHANGED: Import Supabase
from supabase import create_client, Client

# Load environment variables
load_dotenv()

def build_hybrid_database():
    """Reads all templates from Supabase and builds a fresh Qdrant Hybrid Index."""
    # Dynamically load Qdrant Cloud credentials
    qdrant_url = os.getenv("QDRANT_URL", "http://localhost:6333")
    qdrant_api_key = os.getenv("QDRANT_API_KEY", None)
    
    client = QdrantClient(url=qdrant_url, api_key=qdrant_api_key)
    collection_name = "email_templates"

    client.set_model("BAAI/bge-small-en-v1.5")
    client.set_sparse_model("Qdrant/bm25")

    # IDEMPOTENCY: Safely delete the old collection to remove deleted files
    try:
        client.delete_collection(collection_name)
        print(f"Cleared existing collection '{collection_name}' for fresh ingestion.")
    except Exception:
        pass # Collection doesn't exist yet, which is fine

    # CHANGED: Initialize Supabase and fetch templates
    supabase_url = os.getenv("SUPABASE_URL")
    supabase_key = os.getenv("SUPABASE_KEY")
    
    if not supabase_url or not supabase_key:
        print("Missing Supabase keys. Cannot ingest data.")
        return "Supabase credentials missing."
        
    supabase: Client = create_client(supabase_url, supabase_key)
    
    try:
        response = supabase.table("email_templates").select("filename, content").execute()
        templates_data = response.data
    except Exception as e:
        print(f"Failed to fetch from Supabase: {e}")
        return f"Database error: {e}"

    docs = []
    metadata = []
    ids = []
    
    # CHANGED: Loop through Supabase records instead of local files
    for tpl in templates_data:
        filename = tpl.get("filename")
        content = tpl.get("content")
        
        if filename and content:
            docs.append(content)
            metadata.append({"source_file": filename})
            
            # Generate deterministic UUID for deduplication
            deterministic_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, filename))
            ids.append(deterministic_id)

    if not docs:
        msg = "No templates found in the Supabase database."
        print(msg)
        return msg

    print(f"Ingesting {len(docs)} full templates into Qdrant...")
    
    client.add(
        collection_name=collection_name,
        documents=docs,
        metadata=metadata,
        ids=ids, # Inject our anti-duplication IDs here!
        parallel=0
    )
    
    msg = f"✅ Ingestion complete! Database rebuilt with {len(docs)} templates."
    print(msg)
    return msg

if __name__ == "__main__":
    build_hybrid_database()
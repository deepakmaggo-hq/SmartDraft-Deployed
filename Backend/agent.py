import os
from typing import TypedDict, Optional, List
from dotenv import load_dotenv
from langgraph.graph import StateGraph, END
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_groq import ChatGroq

load_dotenv()

# --- 1. THE STATE ---
class GraphState(TypedDict):
    user_input: str
    llm_choice: str
    
    # Human Choices (Only ONE of these will be populated at a time)
    selected_template: Optional[str]
    selected_outline: Optional[str]
    manual_template: Optional[str]
    
    # AI Outputs
    proposed_outlines: Optional[List[str]]
    final_email: Optional[str]

# --- 2. HELPER: GET LLM ---
def get_llm(state: GraphState):
    if state["llm_choice"].lower() == "groq":
        return ChatGroq(model="llama-3.1-8b-instant", api_key=os.getenv("GROQ_API_KEY"))
    return ChatGoogleGenerativeAI(model="gemini-2.5-flash", api_key=os.getenv("GEMINI_API_KEY"))

# --- 3. THE NODES ---

def propose_outlines(state: GraphState):
    """If the human rejected the templates, the AI suggests 3 directions."""
    print("💡 No template chosen. Proposing 3 custom directions...")
    llm = get_llm(state)
    
    prompt = f"""
    The user needs to send a corporate email about: "{state['user_input']}"
    No standard templates were suitable.
    
    Provide 3 distinct, brief 1-sentence directions or angles on how we could draft this reply.
    Format exactly as:
    Option 1: [Direction]
    Option 2: [Direction]
    Option 3: [Direction]
    """
    response = llm.invoke(prompt)
    
    # Simple parsing to split the response into a list of strings
    outlines = [line.strip() for line in response.content.split('\n') if line.strip().startswith('Option')]
    # If parsing fails due to LLM formatting, just return the raw text as one option
    if not outlines:
        outlines = [response.content.strip()]
        
    return {"proposed_outlines": outlines}


def draft_final_email(state: GraphState):
    """Drafts the final email based on whatever context the human provided."""
    print(f"✍️ Drafting final email using {state['llm_choice']}...")
    llm = get_llm(state)
    
    # Determine which context the human provided
    context_instruction = ""
    if state.get("selected_template"):
        context_instruction = f"BASE TEMPLATE TO ADAPT:\n{state['selected_template']}"
    elif state.get("manual_template"):
        context_instruction = f"USER'S MANUAL DRAFT TO POLISH:\n{state['manual_template']}"
    elif state.get("selected_outline"):
        context_instruction = f"DIRECTION TO FOLLOW:\n{state['selected_outline']}"
        
    prompt = f"""
    You are a professional corporate email assistant.
    
    USER REQUEST: {state['user_input']}
    
    {context_instruction}
    
    Draft the final, polished corporate email. Do not invent policies outside the provided context.
    Start with a professional greeting and end with a professional sign-off.
    """
    response = llm.invoke(prompt)
    return {"final_email": response.content}

# --- 4. THE ROUTER ---
def decide_next_step(state: GraphState):
    """Checks the state to see if the human has provided enough context to draft."""
    has_template = bool(state.get("selected_template"))
    has_outline = bool(state.get("selected_outline"))
    has_manual = bool(state.get("manual_template"))
    
    # If the human provided ANY of these, we can draft the email
    if has_template or has_outline or has_manual:
        return "drafter"
    
    # If none of them exist, the AI needs to propose outlines
    return "proposer"

# --- 5. COMPILE THE GRAPH ---
workflow = StateGraph(GraphState)

workflow.add_node("proposer", propose_outlines)
workflow.add_node("drafter", draft_final_email)

# The graph decides where to start based on what the frontend sent
workflow.set_conditional_entry_point(
    decide_next_step,
    {
        "drafter": "drafter",
        "proposer": "proposer"
    }
)

# Both paths end the execution so the result can be sent back to the frontend
workflow.add_edge("proposer", END)
workflow.add_edge("drafter", END)

email_agent_app = workflow.compile()
# ```eof

# ### **Why this design is brilliant for your Resume:**

# If an interviewer asks about your system architecture, you can say:
# *"I designed a **Stateless Routing Architecture** with LangGraph. Instead of forcing the AI to hallucinate when context is missing, the graph intelligently inspects the incoming payload. If the required context (template or human instruction) is missing, it dynamically routes to a Proposer Node to generate options and halts execution, returning control to the frontend UI. This guarantees the human remains in the loop at every critical decision point."*

# ### **Next Steps**

# To make this fully work, we need to quickly update the Pydantic schemas in `main.py` so FastAPI knows how to accept these new optional fields (`selected_outline` and `manual_template`). 

# Let me know when you have saved `agent.py`, and I will give you the updated `main.py` block!
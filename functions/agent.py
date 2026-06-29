import os
import ast
from models import DataContract

try:
    from dotenv import load_dotenv
    load_dotenv()  # Works locally; no-op in Cloud Functions where env vars are injected
except ImportError:
    pass

from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.messages import HumanMessage
from langgraph.prebuilt import create_react_agent
from langchain_tavily import TavilySearch



def is_valid_python(code: str) -> bool:
    try:
        ast.parse(code)
        return True
    except SyntaxError:
        return False

def generate_cleaning_script(contract: DataContract) -> str:
    # Build prompt based on contract
    prompt = f"""You are an expert Python data engineer.
Write a python script using pandas to clean the dataset based on the following contract.
You can use the Tavily search tool to look up pandas documentation or Python syntax if you are unsure.
The dataset is '{contract.dataset_name}' (format: {contract.dataset_format}, encoding: {contract.dataset_encoding}).

## Global Standardisation Rules (Must Apply Always):
1. Extension Permission logic: If an "Extension Permission" column exists, normalise "YES", "Yes", "yes" to "Yes", and "No", "no", "N" to "No". Do not flag "Assessment Complete Date" > "Assessment Deadline" as late if Extension is "Yes". MUST flag records where Complete Date > Deadline AND Extension is "No" or missing.
2. Date format standardisation: Auto-detect all date columns and convert them to standard ISO format (YYYY-MM-DD).
3. Register Status normalisation: If a "Register Status" column exists, use fuzzy matching/canonical mapping to standardise typos (e.g. "active", "ACTIVE" -> "Active", "Withdrwal" -> "Withdrawn", "suspended", "Suspend" -> "Suspended", "Defer" -> "Deferred").
4. ID standardisation: Trim whitespace and uppercase all ID columns (e.g., Student ID) before performing any merges.
5. Cross-dataset orphan detection: When linking datasets, surface unmatched records from both sides (left-only and right-only) into separate dataframes/CSV outputs rather than silently dropping them.
6. Withdrawn student handling: When linking, cross-reference register status. Flag or separate result records for students with a "Withdrawn" or "Suspended" register status.

"""

    if "diagnose" in contract.selected_procedures and contract.columns_to_clean:
        prompt += "## Diagnosis & Standardisation Requirements:\n"
        for col in contract.columns_to_clean:
            prompt += f"- Column '{col.name}':\n"
            prompt += f"  - Expected Type: {col.expected_type}\n"
            prompt += f"  - Missing Values: {col.missing_values} (Coded as: {col.missing_code})\n"
            prompt += f"  - Context/Constraints: {col.context}\n"
            prompt += f"  - Meaning: {col.meaning}\n"

    if "crosscol" in contract.selected_procedures and contract.cross_col_description:
        prompt += f"\n## Cross-Column Checks & Data Reshaping:\n{contract.cross_col_description}\n"

    if "link" in contract.selected_procedures and contract.link_config:
        lc = contract.link_config
        prompt += "\n## Dataset Linkage:\n"
        prompt += f"- Problem being solved: {lc.link_problem}\n"
        prompt += f"- Primary Dataset: {lc.link_primary}\n"
        prompt += f"- Datasets to join: {lc.link_names}\n"
        prompt += f"- Join keys: {lc.link_keys}\n"
        prompt += f"- Identifier Consistency: {lc.link_consistency}\n"
        prompt += f"- Match Type: {lc.link_match_type}\n"
        prompt += f"- Join Type: {lc.link_join_type}\n"
        prompt += f"- On Unmatched: {lc.link_on_unmatched}\n"

    prompt += """
Please return ONLY valid, complete Python code. Do not include markdown formatting or explanations.
Include inline comments in the code to explain your logic.
The code should define a function `clean_data(file_path)` and return a cleaned pandas DataFrame.
"""

    GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip().strip("\"'")
    if not GEMINI_API_KEY:
        return f"# ERROR: GEMINI_API_KEY not configured.\n# Prompt that would have been sent:\n\"\"\"\n{prompt}\n\"\"\""

    llm = ChatGoogleGenerativeAI(
        model="gemini-2.5-pro",
        google_api_key=GEMINI_API_KEY,
        temperature=0
    )
    tools = [TavilySearch(max_results=3)]
    agent_executor = create_react_agent(llm, tools)

    max_retries = 3
    messages = [HumanMessage(content=prompt)]

    for attempt in range(max_retries):
        try:
            response = agent_executor.invoke({"messages": messages})
            final_message = response["messages"][-1]
            code = final_message.content

            if isinstance(code, list):
                code = "".join([block.get("text", "") for block in code if block.get("type") == "text"])

            # Strip markdown fences if LLM wraps the code
            if code.startswith("```python"):
                code = code[len("```python"):]
            if code.startswith("```"):
                code = code[len("```"):]
            if code.endswith("```"):
                code = code[:-3]

            code = code.strip()

            if is_valid_python(code):
                return code
            else:
                messages = response["messages"] + [
                    HumanMessage(content=f"Your previous code had a SyntaxError. Please fix it and return only raw Python, no markdown.\nBroken code:\n{code}")
                ]

        except Exception as e:
            return f"# An error occurred calling the LLM: {str(e)}"

    return "# Failed to generate valid Python after 3 attempts."

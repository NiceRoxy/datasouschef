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

# Configure API Keys
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    print("WARNING: GEMINI_API_KEY not found in environment variables.")

TAVILY_API_KEY = os.getenv("TAVILY_API_KEY")
if not TAVILY_API_KEY:
    print("WARNING: TAVILY_API_KEY not found in environment variables. Web search will fail.")

def is_valid_python(code: str) -> bool:
    try:
        ast.parse(code)
        return True
    except SyntaxError:
        return False

def _missing_action_description(col) -> str:
    action_map = {
        'blank':    'standardise to blank/NaN (system missing)',
        'zero':     'replace with 0',
        'mean':     'replace with column mean',
        'median':   'replace with column median',
        'remove':   'remove the entire record',
        'unknown':  'replace with the string "Unknown"',
        'zero_str': 'replace with the string "0"',
        'custom':   f'replace with {col.missing_custom!r}',
    }
    return action_map.get(col.missing_action, col.missing_action)

def generate_cleaning_script(contract: DataContract) -> str:
    selected = [c for c in contract.columns if c.selected]
    out_ext = contract.file_format if contract.output_format == 'same' else contract.output_format

    prompt = f"""You are an expert Python data engineer. Write a complete, executable pandas script.

DATASET
  File     : {contract.file_name}
  Format   : {contract.file_format}
  Encoding : {contract.encoding}
  Rows     : {contract.row_count_estimate}
  Header   : {'yes' if contract.has_header else 'no'}
  Output   : {contract.output_name}.{out_ext}

COLUMN RULES
Process only the columns listed below. All other columns pass through unchanged.
"""

    for col in selected:
        display_name = col.rename_to if col.rename_to else col.name
        prompt += f"\n--- Column: \"{col.name}\""
        if col.rename_to:
            prompt += f" → rename to \"{col.rename_to}\""
        prompt += f"\n  Type: {col.col_type}"

        if col.col_type == 'recode' and col.recode_to_type:
            prompt += f"\n  Recode: Keep original column unchanged. Create a NEW column named \"{col.name}-New\" with type {col.recode_to_type}."

        if col.value_mapping.strip():
            prompt += f"\n  Value mapping (apply to {'new column' if col.col_type == 'recode' else 'this column'}):"
            for line in col.value_mapping.strip().splitlines():
                if '→' in line or '->' in line:
                    prompt += f"\n    {line.strip()}"

        if col.unmapped_action == 'system_missing':
            prompt += "\n  Values not in mapping: set to NaN/system missing"
        elif col.unmapped_action == 'keep':
            prompt += "\n  Values not in mapping: keep unchanged"
        elif col.unmapped_action == 'other' and col.unmapped_custom:
            prompt += f"\n  Values not in mapping: {col.unmapped_custom}"

        if col.has_missing:
            sentinels = col.missing_sentinels or 'blank, NA, N/A'
            prompt += f"\n  Missing value sentinels: {sentinels}"
            prompt += f"\n  Missing value action: {_missing_action_description(col)}"

        if col.strip_chars:
            prompt += f"\n  Strip these characters from all values: {col.strip_chars!r}"

    if contract.date_order_rules:
        prompt += "\n\nDATE ORDERING RULES"
        for rule in contract.date_order_rules:
            prompt += f"\n  \"{rule.earlier_col}\" must be before \"{rule.later_col}\". On violation: {rule.on_violation}"

    prompt += """

OUTPUT REQUIREMENTS
- Load the input file, apply all rules above, save to the output file name specified.
- Print a concise summary: rows read, rows written, and per-column change counts.
- Do NOT print any actual data values in the summary.
- Return ONLY valid Python code. No markdown fences, no explanations outside comments.
- Define a function clean_data(input_path) that returns the cleaned DataFrame.
- Call clean_data() at the bottom of the script with the input file name.
"""

    if not GEMINI_API_KEY:
        return f"# ERROR: GEMINI_API_KEY not configured.\n# Prompt:\n\"\"\"\n{prompt}\n\"\"\""

    llm = ChatGoogleGenerativeAI(model="gemini-2.5-pro", google_api_key=GEMINI_API_KEY, temperature=0)
    tools = [TavilySearch(max_results=3)]
    agent_executor = create_react_agent(llm, tools)

    messages = [HumanMessage(content=prompt)]
    for _ in range(3):
        try:
            response = agent_executor.invoke({"messages": messages})
            code = response["messages"][-1].content
            if isinstance(code, list):
                code = "".join(b.get("text", "") for b in code if b.get("type") == "text")
            code = code.strip()
            for fence in ("```python", "```"):
                if code.startswith(fence): code = code[len(fence):]
            if code.endswith("```"): code = code[:-3]
            code = code.strip()
            if is_valid_python(code):
                return code
            messages = response["messages"] + [
                HumanMessage(content=f"Your code had a SyntaxError. Fix it. No markdown.\n{code}")
            ]
        except Exception as e:
            return f"# Error calling LLM: {e}"

    return "# Failed to generate valid Python after 3 attempts."

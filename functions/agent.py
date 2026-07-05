"""
Script generator — builds a structured prompt from the DataContract
and calls the Gemini LLM to produce a Python cleaning script.

Design: every prompt section is driven purely by the user's interview answers.
No hardcoded domain rules. No inference. What the user said → what the script does.
"""
import os
import ast
from models import DataContract, ColumnSpec, DateOrderRule

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.messages import HumanMessage
from langgraph.prebuilt import create_react_agent
from langchain_tavily import TavilySearch


# ── Helpers ───────────────────────────────────────────────────────────────────

def is_valid_python(code: str) -> bool:
    if not code.strip():
        return False
    try:
        ast.parse(code)
        return True
    except SyntaxError:
        return False


def _strip_fences(code: str) -> str:
    """Remove markdown code fences if the LLM wraps its output."""
    if isinstance(code, list):
        code = "".join(block.get("text", "") for block in code if block.get("type") == "text")
    if code.startswith("```python"):
        code = code[len("```python"):]
    if code.startswith("```"):
        code = code[3:]
    if code.endswith("```"):
        code = code[:-3]
    return code.strip()


# ── Prompt builder ────────────────────────────────────────────────────────────

def _section_a(c: DataContract) -> str:
    encoding_note = (
        "Try UTF-8 first; if that fails try Windows-1252; report which succeeded."
        if c.encoding == "unknown"
        else f"Encoding: {c.encoding}."
    )
    sheet = f" Sheet: \"{c.sheet_name}\"." if c.sheet_name else " Use the first sheet."
    return (
        f"## File\n"
        f"Name: {c.file_name}  Format: {c.file_format}.{sheet}\n"
        f"Header row: {'yes' if c.has_header else 'no'}.  "
        f"Estimated rows: {c.row_count_estimate}.  {encoding_note}\n"
    )


def _default_hygiene() -> str:
    return (
        "## Default hygiene (always applied)\n"
        "1. Strip leading/trailing spaces from all column headings at read time.\n"
        "2. Strip leading/trailing spaces from every cell in every column.\n"
        "3. Collapse repeated internal spaces in every column EXCEPT those typed 'text' "
        "   where collapse_spaces is not explicitly true.\n"
        "Count every change in the final report.\n"
    )


def _col_block(col: ColumnSpec) -> str:
    if not col.selected:
        return f'- Column "{col.name}": carry through unchanged.\n'

    lines = [f'### Column "{col.name}" [{col.col_type}]']

    if col.rename_to:
        lines.append(f"  Rename to: \"{col.rename_to}\"")

    # Missing values
    if col.missing_sentinels:
        sentinels = ", ".join(f'"{s}"' for s in col.missing_sentinels)
        action_map = {
            "standardise": "standardise all to blank/NaN and report count",
            "report_only": "report count only, do not alter values",
            "remove_record": "drop the entire row and report count",
        }
        action_str = col.missing_action or "standardise"
        if action_str.startswith("replace:"):
            label = action_str.split(":", 1)[1]
            action_desc = f'replace with "{label}" and report count'
        else:
            action_desc = action_map.get(action_str, action_str)
        lines.append(f"  Missing sentinels: [{sentinels}] → {action_desc}.")

    # Type-specific rules
    t = col.col_type

    if t == "id":
        if col.must_be_unique == "yes":
            dup_action = col.on_duplicate or "report"
            if dup_action == "remove" and col.keep_duplicate:
                lines.append(f"  Must be unique. Duplicates: keep {col.keep_duplicate}; remove others; report count.")
            else:
                lines.append("  Must be unique. Duplicates: count and list in report, do not remove.")
        if col.id_case in ("upper", "lower"):
            lines.append(f"  Standardise case to {col.id_case.upper()}.")

    elif t == "date":
        fmt_in = col.date_format_in or "unknown"
        fmt_out = col.date_format_out or "YYYY-MM-DD"
        if fmt_in in ("mixed", "unsure", "unknown"):
            lines.append(
                f"  Parse dates day-first (UK convention). Try common patterns in order. "
                f"Unparseable values: treat as missing per the missing-value rule above, and list in report."
            )
        else:
            lines.append(f"  Incoming date format: {fmt_in}.")
        if fmt_out != "keep":
            lines.append(f"  Output date format: {fmt_out}.")

    elif t == "number":
        if col.numeric_symbols:
            syms = ", ".join(f'"{s}"' for s in col.numeric_symbols)
            lines.append(f"  Strip symbols before converting: [{syms}]. "
                         "Values still unconvertible after stripping → treat as missing and list in report.")
        if col.decimal_places is not None:
            rnd = col.rounding or "half_up"
            lines.append(f"  Round to {col.decimal_places} decimal places ({rnd}).")
        else:
            lines.append("  Convert to whole integer.")
        if col.valid_min is not None or col.valid_max is not None:
            lo = col.valid_min if col.valid_min is not None else "-∞"
            hi = col.valid_max if col.valid_max is not None else "+∞"
            lines.append(f"  Valid range: [{lo}, {hi}]. Out-of-range values: flag in report only, do not alter.")

    elif t == "category":
        if col.valid_values:
            vv = ", ".join(f'"{v}"' for v in col.valid_values)
            lines.append(f"  Canonical values: [{vv}].")
        if col.category_map:
            mappings = "; ".join(f'"{k}" → "{v}"' for k, v in col.category_map.items())
            lines.append(f"  Variant mapping: {mappings}.")
        unmapped = col.on_unmapped_category or "report"
        unmapped_desc = {"report": "flag in report", "set_unknown": 'set to "Unknown"', "keep": "leave unchanged"}
        lines.append(f"  Unmapped values: {unmapped_desc.get(unmapped, unmapped)}.")

    elif t == "text":
        if col.collapse_spaces:
            lines.append("  Collapse repeated internal spaces.")

    # Cleaning actions (Section F)
    if col.capitalisation and col.capitalisation != "none":
        lines.append(f"  Capitalisation: {col.capitalisation}.")
    if col.remove_chars:
        lines.append(f"  Remove characters/patterns: \"{col.remove_chars}\".")

    # Recode / regroup (Section G)
    if col.recode_map:
        lines.append("  Recode rules (apply in order listed):")
        for row in col.recode_map:
            old = ", ".join(f'"{v}"' for v in row.old_values)
            cond = f" [condition: {row.condition}]" if row.condition else ""
            lines.append(f"    {old} → \"{row.new_value}\"{cond}")
        catchall = col.recode_catchall or "keep"
        catchall_desc = {"keep": "leave unchanged", "set_unknown": 'set to "Unknown"', "report": "flag in report"}
        lines.append(f"  Values not covered by recode rules: {catchall_desc.get(catchall, catchall)}.")

    return "\n".join(lines) + "\n"


def _section_date_order(rules: list) -> str:
    if not rules:
        return ""
    lines = ["## Date ordering rules"]
    for r in rules:
        action = "report only" if r.on_violation == "report" else "blank the later date and note in report"
        lines.append(f'  "{r.earlier_col}" must come before "{r.later_col}". Violation: {action}.')
    return "\n".join(lines) + "\n"


def _section_h(c: DataContract) -> str:
    fmt = "same format as input" if c.output_format == "same" else c.output_format
    return (
        f"## Output\n"
        f"Save the cleaned file as \"{c.output_name}\" ({fmt}).\n"
        f"Print a summary report: rows read, rows written; per column — "
        f"values changed, missing values handled, duplicates found, "
        f"unparseable dates, out-of-range numbers, unexpected categories. "
        f"Final line: \"Checks passed\" or \"N issues found\".\n"
        f"Do NOT print any raw data values in the report.\n"
    )


def build_prompt(contract: DataContract) -> str:
    parts = [
        "You are an expert Python data engineer.\n"
        "Write a complete Python script using pandas that cleans the dataset described below.\n"
        "You may use the Tavily search tool for pandas documentation if needed.\n\n",
        _section_a(contract),
        "\n",
        _default_hygiene(),
        "\n## Columns\n",
    ]
    selected = [col for col in contract.columns if col.selected]
    unselected = [col for col in contract.columns if not col.selected]
    for col in selected:
        parts.append(_col_block(col))
    if unselected:
        names = ", ".join(f'"{c.name}"' for c in unselected)
        parts.append(f"\nCarry these columns through unchanged: {names}.\n")
    if contract.date_order_rules:
        parts.append("\n" + _section_date_order(contract.date_order_rules))
    parts.append("\n" + _section_h(contract))
    parts.append(
        "\nReturn ONLY valid, complete Python code — no markdown fences, no explanations outside comments.\n"
        "Include inline comments explaining each step.\n"
        "Define a function `clean_data(file_path: str)` that reads the file, applies all rules, "
        "prints the summary report, and saves the cleaned file. Call it at the end with:\n"
        "    if __name__ == '__main__':\n"
        "        clean_data('<your file path here>')\n"
    )
    return "".join(parts)


# ── Main entry point ──────────────────────────────────────────────────────────

def generate_cleaning_script(contract: DataContract) -> str:
    GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip().strip("\"'")
    if not GEMINI_API_KEY:
        prompt = build_prompt(contract)
        return f"# ERROR: GEMINI_API_KEY not configured.\n# Prompt:\n\"\"\"\n{prompt}\n\"\"\""

    prompt = build_prompt(contract)

    llm = ChatGoogleGenerativeAI(
        model="gemini-2.5-flash",
        google_api_key=GEMINI_API_KEY,
        temperature=0,
        max_retries=3
    )
    tools = [TavilySearch(max_results=3)]
    agent_executor = create_react_agent(llm, tools)
    messages = [HumanMessage(content=prompt)]

    for attempt in range(3):
        try:
            response = agent_executor.invoke({"messages": messages})
            code = response["messages"][-1].content
            print(f"--- ATTEMPT {attempt + 1} RAW OUTPUT (first 500 chars) ---")
            print(str(code)[:500])
            print("---")
            code = _strip_fences(code)
            if is_valid_python(code):
                return code
            messages = response["messages"] + [
                HumanMessage(
                    content=f"Your code had a SyntaxError. Fix it and return only raw Python.\nBroken code:\n{code}"
                )
            ]
        except Exception as e:
            return f"# An error occurred calling the LLM: {e}"

    return "# Failed to generate valid Python after 3 attempts."

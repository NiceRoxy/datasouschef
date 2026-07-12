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

# Heavy ML imports are deferred to generate_cleaning_script() to avoid
# Firebase's 10-second function-discovery timeout at deploy time.


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
        "4. CRITICAL — Column preservation: The output file MUST contain EVERY column "
        "   from the original file. Never drop or exclude a column. Only the columns "
        "   listed in the Column Rules section receive transformations; all others are "
        "   copied through exactly as they are. For recode columns, keep the original "
        "   column unchanged AND add a new column named '<original>-New' immediately "
        "   after it in the column order.\n"
        "Count every change in the final summary report.\n"
    )


def _col_block(col: ColumnSpec) -> str:
    if not col.selected:
        return f'- Column "{col.name}": carry through unchanged.\n'

    lines = [f'### Column "{col.name}" [{col.col_type}]']

    if col.rename_to:
        lines.append(f'  Rename to: "{col.rename_to}"')

    # ── Recode to different type (v2) ─────────────────────────────────────────
    if col.col_type == 'recode' and col.recode_to_type:
        # Build the mapping dict from the free-text value_mapping field
        mapping_pairs = []
        if col.value_mapping and col.value_mapping.strip():
            for line in col.value_mapping.strip().splitlines():
                line = line.strip()
                sep = '→' if '→' in line else ('->' if '->' in line else None)
                if sep:
                    parts = line.split(sep, 1)
                    if len(parts) == 2:
                        old_val = parts[0].strip()
                        new_val = parts[1].strip()
                        mapping_pairs.append((old_val, new_val))

        unmapped = col.unmapped_action or 'system_missing'
        if unmapped == 'keep':
            na_action = f"df['{col.name}'].astype(str)"
        else:
            na_action = "pd.NA"

        if mapping_pairs:
            dict_repr = '{' + ', '.join(f"'{k}': '{v}'" for k, v in mapping_pairs) + '}'
            lines.append(
                f'  RECODE — use this exact Python pattern:\n'
                f'    mapping_{col.name.replace(" ","_")} = {dict_repr}\n'
                f'    # Cast source to str so numeric codes like 1/2 match string keys\n'
                f'    new_col = df[\'{col.name}\'].astype(str).map(mapping_{col.name.replace(" ","_")})\n'
                f'    # Insert new column immediately after the original\n'
                f'    insert_pos = df.columns.get_loc(\'{col.name}\') + 1\n'
                f'    df.insert(insert_pos, \'{col.name}-New\', new_col)\n'
                f'    # Original column \'{col.name}\' is NOT modified.\n'
                f'    # Unmapped values become: {unmapped}'
            )
        else:
            lines.append(
                f'  RECODE: Create column "{col.name}-New" inserted after "{col.name}". '
                f'No mapping provided — populate with NaN.'
            )

    # ── Value mapping for non-recode columns ──────────────────────────────────
    elif col.value_mapping and col.value_mapping.strip():
        lines.append('  Value mapping (apply in order):')
        for line in col.value_mapping.strip().splitlines():
            line = line.strip()
            if line and ('→' in line or '->' in line):
                lines.append(f'    {line}')

        unmapped = col.unmapped_action or 'system_missing'
        if unmapped == 'system_missing':
            lines.append('  Values not in mapping: set to NaN/system missing.')
        elif unmapped == 'keep':
            lines.append('  Values not in mapping: keep unchanged.')
        elif unmapped == 'other' and col.unmapped_custom:
            lines.append(f'  Values not in mapping: {col.unmapped_custom}')
        else:
            lines.append('  Values not in mapping: set to NaN/system missing.')


    # ── Legacy category_map (v1) ──────────────────────────────────────────────
    elif col.category_map:
        mappings = '; '.join(f'"{k}" → "{v}"' for k, v in col.category_map.items())
        lines.append(f'  Variant mapping: {mappings}.')
        unmapped_v1 = col.on_unmapped_category or 'report'
        unmapped_desc = {'report': 'flag in report', 'set_unknown': 'set to "Unknown"', 'keep': 'leave unchanged'}
        lines.append(f'  Unmapped values: {unmapped_desc.get(unmapped_v1, unmapped_v1)}.')

    elif col.recode_map:
        lines.append('  Recode rules (apply in order listed):')
        for row in col.recode_map:
            old = ', '.join(f'"{v}"' for v in row.old_values)
            cond = f' [condition: {row.condition}]' if row.condition else ''
            lines.append(f'    {old} → "{row.new_value}"{cond}')
        catchall = col.recode_catchall or 'keep'
        catchall_desc = {'keep': 'leave unchanged', 'set_unknown': 'set to "Unknown"', 'report': 'flag in report'}
        lines.append(f'  Values not covered by recode rules: {catchall_desc.get(catchall, catchall)}.')

    # ── Missing values (v2) ───────────────────────────────────────────────────
    if col.has_missing and col.missing_sentinels:
        sentinels = col.missing_sentinels  # string e.g. "blank, NA, 99"
        action = col.missing_action or 'blank'
        action_map = {
            'blank':    'standardise to blank/NaN (system missing) and report count',
            'zero':     'replace with 0 and report count',
            'mean':     'replace with column mean and report count',
            'median':   'replace with column median and report count',
            'remove':   'drop the entire row and report count',
            'unknown':  'replace with "Unknown" and report count',
            'zero_str': 'replace with "0" and report count',
            'custom':   f'replace with "{col.missing_custom}" and report count',
        }
        action_desc = action_map.get(action, action)
        lines.append(f'  Missing sentinels: [{sentinels}] → {action_desc}.')

    # ── Legacy missing values (v1 List[str] format) ───────────────────────────
    elif col.missing_sentinels and not col.has_missing:
        # v1 format stored as string from legacy interview
        action_str = col.missing_action or 'standardise'
        if action_str.startswith('replace:'):
            label = action_str.split(':', 1)[1]
            action_desc = f'replace with "{label}" and report count'
        else:
            action_map_v1 = {
                'standardise':   'standardise all to blank/NaN and report count',
                'report_only':   'report count only, do not alter values',
                'remove_record': 'drop the entire row and report count',
            }
            action_desc = action_map_v1.get(action_str, action_str)
        lines.append(f'  Missing sentinels: [{col.missing_sentinels}] → {action_desc}.')

    # ── Strip characters (v2) ─────────────────────────────────────────────────
    if col.strip_chars:
        lines.append(f'  Strip these characters from all values: "{col.strip_chars}".')
    elif col.remove_chars:
        lines.append(f'  Remove characters/patterns: "{col.remove_chars}".')

    # ── Type-specific rules (v1 legacy fields) ────────────────────────────────
    t = col.col_type

    if t == 'id':
        if col.must_be_unique == 'yes':
            dup_action = col.on_duplicate or 'report'
            if dup_action == 'remove' and col.keep_duplicate:
                lines.append(f'  Must be unique. Duplicates: keep {col.keep_duplicate}; remove others; report count.')
            else:
                lines.append('  Must be unique. Duplicates: count and list in report, do not remove.')
        if col.id_case in ('upper', 'lower'):
            lines.append(f'  Standardise case to {col.id_case.upper()}.')

    elif t == 'date':
        fmt_in = col.date_format_in or 'unknown'
        fmt_out = col.date_format_out or 'YYYY-MM-DD'
        if fmt_in in ('mixed', 'unsure', 'unknown'):
            lines.append(
                'Parse dates day-first (UK convention). Try common patterns in order. '
                'Unparseable values: treat as missing per the missing-value rule above, and list in report.'
            )
        else:
            lines.append(f'  Incoming date format: {fmt_in}.')
        if fmt_out != 'keep':
            lines.append(f'  Output date format: {fmt_out}.')

    elif t == 'number':
        if col.numeric_symbols:
            syms = ', '.join(f'"{s}"' for s in col.numeric_symbols)
            lines.append(f'  Strip symbols before converting: [{syms}]. '
                         'Values still unconvertible after stripping → treat as missing and list in report.')
        if col.decimal_places is not None:
            rnd = col.rounding or 'half_up'
            lines.append(f'  Round to {col.decimal_places} decimal places ({rnd}).')
        if col.valid_min is not None or col.valid_max is not None:
            lo = col.valid_min if col.valid_min is not None else '-∞'
            hi = col.valid_max if col.valid_max is not None else '+∞'
            lines.append(f'  Valid range: [{lo}, {hi}]. Out-of-range values: flag in report only, do not alter.')

    elif t == 'category' and col.valid_values:
        vv = ', '.join(f'"{v}"' for v in col.valid_values)
        lines.append(f'  Canonical values: [{vv}].')

    # ── Capitalisation (v1) ───────────────────────────────────────────────────
    if col.capitalisation and col.capitalisation != 'none':
        lines.append(f'  Capitalisation: {col.capitalisation}.')
    if col.collapse_spaces:
        lines.append('  Collapse repeated internal spaces.')

    return '\n'.join(lines) + '\n'



def _section_date_order(rules: list) -> str:
    if not rules:
        return ""
    lines = ["## Date ordering rules"]
    for r in rules:
        action = "report only" if r.on_violation == "report" else "blank the later date and note in report"
        lines.append(f'  "{r.earlier_col}" must come before "{r.later_col}". Violation: {action}.')
    return "\n".join(lines) + "\n"


def _section_h(c: DataContract) -> str:
    # Resolve output extension — CSV is the default for all internal reporting
    if c.output_format in ('same', 'csv', ''):
        out_ext = 'csv'
        save_instruction = (
            f"df.to_csv('{c.output_name}.csv', index=False, encoding='utf-8')"
        )
    else:
        out_ext = c.output_format
        save_instruction = (
            f"df.to_excel('{c.output_name}.xlsx', index=False, engine='openpyxl')"
        )
    out_file = f"{c.output_name}.{out_ext}"
    return (
        f"## Output\n"
        f"Save the cleaned DataFrame using exactly this call: {save_instruction}\n"
        f"Output file: '{out_file}' — do NOT change the filename or extension.\n"
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
        "\n## Columns\n"
        "Apply the rules below to the listed columns. "
        "ALL other columns from the original file must be carried through unchanged "
        "(do NOT filter, drop, or subset the DataFrame to only these columns).\n",
    ]
    selected = [col for col in contract.columns if col.selected]
    unselected = [col for col in contract.columns if not col.selected]
    for col in selected:
        parts.append(_col_block(col))
    if unselected:
        names = ", ".join(f'"{c.name}"' for c in unselected)
        parts.append(f"\nCarry these columns through unchanged (do not modify them): {names}.\n")
    if contract.date_order_rules:
        parts.append("\n" + _section_date_order(contract.date_order_rules))
    parts.append("\n" + _section_h(contract))

    # Critical reminders added last so the LLM sees them right before generating
    recode_cols = [c for c in selected if c.col_type == 'recode']
    if recode_cols:
        recode_names = ', '.join(f'"{c.name}"' for c in recode_cols)
        parts.append(
            f"\n## IMPORTANT — Recode columns ({recode_names})\n"
            "For each recode column:\n"
            "  1. Keep the original column EXACTLY as-is (no changes to it).\n"
            "  2. Create a new column named '<original>-New' using df['<original>-New'] = df['<original>'].map(mapping_dict).\n"
            "  3. The mapping_dict must use the exact strings from the 'Value mapping' section above.\n"
            "  4. Values not in the mapping_dict become NaN (do NOT use fillna unless a specific unmapped action was given).\n"
            "  5. Insert the new column immediately after its source column.\n"
        )

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
    """
    Build a structured prompt from the contract and call Gemini directly.
    No LangGraph agent loop — single call, fast response (target: 1-2 min).
    """
    # Lazy import — avoids Firebase's 10-second function-discovery timeout
    from langchain_google_genai import ChatGoogleGenerativeAI
    from langchain_core.messages import HumanMessage

    GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip().strip("\"'")
    if not GEMINI_API_KEY:
        prompt = build_prompt(contract)
        return f"# ERROR: GEMINI_API_KEY not configured.\n# Prompt:\n\"\"\"\n{prompt}\n\"\"\""

    prompt = build_prompt(contract)
    print(f"[DSC] Prompt length: {len(prompt)} chars")

    # Single direct LLM call — no agent loop, no tool calls, no search overhead
    llm = ChatGoogleGenerativeAI(
        model="gemini-2.5-flash",
        google_api_key=GEMINI_API_KEY,
        temperature=0,
        max_retries=2,
    )

    messages = [HumanMessage(content=prompt)]

    for attempt in range(3):
        try:
            print(f"[DSC] LLM call attempt {attempt + 1}...")
            response = llm.invoke(messages)
            code = response.content
            if isinstance(code, list):
                code = "".join(b.get("text", "") for b in code if b.get("type") == "text")
            code = _strip_fences(code.strip())
            print(f"[DSC] Response length: {len(code)} chars, valid Python: {is_valid_python(code)}")

            if is_valid_python(code):
                return code

            # Syntax error — ask the model to fix it (one retry)
            messages = messages + [
                response,
                HumanMessage(
                    content=(
                        "Your previous response had a Python SyntaxError. "
                        "Return ONLY corrected Python code — no markdown fences, no explanations.\n"
                        f"Broken code:\n{code}"
                    )
                )
            ]
        except Exception as e:
            print(f"[DSC] LLM error on attempt {attempt + 1}: {e}")
            return f"# An error occurred calling the LLM: {e}"

    return "# Failed to generate valid Python after 3 attempts."

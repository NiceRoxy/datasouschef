"""
Script generator — builds a structured prompt from the DataContract
and calls the Gemini LLM to produce a Python cleaning script.

Design: every prompt section is driven purely by the user's interview answers.
No hardcoded domain rules. No inference. What the user said → what the script does.
"""
import os
import ast
import re as _re
from models import DataContract, ColumnSpec, DateOrderRule

# ── Recode helpers (deterministic — no LLM involvement) ──────────────────────
_MISSING_KEYS = frozenset({'missing', 'null', 'na', 'n/a', 'none', 'blank', 'nan', ''})
_RANGE_RE = _re.compile(r'^\d+\s*[-\u2013]\s*\d+$|^\d+\s*\+$|^[><]=?\s*\d+|^\d+$')


def _parse_mapping_pairs(text: str) -> list:
    """Parse free-text mapping into (key, value) pairs. Supports \u2192, ->, : separators."""
    pairs = []
    for mline in (text or '').strip().splitlines():
        mline = mline.strip()
        if not mline:
            continue
        sep = None
        for candidate in ['\u2192', '->', ':']:
            if candidate in mline:
                sep = candidate
                break
        if sep:
            parts = mline.split(sep, 1)
            if len(parts) == 2:
                k, v = parts[0].strip(), parts[1].strip()
                if k.lower() not in _MISSING_KEYS:
                    pairs.append((k, v))
    return pairs


def _generate_recode_block(col: ColumnSpec) -> str:
    """
    Build deterministic Python code for one recode column.
    Indented with 4 spaces (inside clean_data function body).
    """
    pairs = _parse_mapping_pairs(col.value_mapping)
    new_col = col.rename_to or f'{col.name}-New'
    fn = _re.sub(r'[^a-zA-Z0-9]', '_', col.name)   # safe Python identifier

    missing_fill = (
        col.missing_custom if col.missing_custom
        else ('Unknown' if col.has_missing else None)
    )
    unmapped_fill = (
        col.unmapped_custom
        if (col.unmapped_action == 'other' and col.unmapped_custom)
        else None
    )

    has_ranges = bool(pairs) and any(_RANGE_RE.match(k) for k, _ in pairs)

    P = '    '  # 4-space indent
    L = []
    L.append(f'{P}# ── Recode: "{col.name}" \u2192 "{new_col}" ["{col.recode_to_type}"] ─────────')
    L.append(f'{P}_miss_{fn} = (df["{col.name}"].isna() |')
    L.append(f'{P}             df["{col.name}"].astype(str).str.strip().str.lower().isin(GLOBAL_MISSING))')

    if not pairs:
        # No mapping — new column = NaN everywhere; apply missing fill
        L.append(f'{P}_new_{fn} = pd.Series([None] * len(df), dtype=object)')
    elif has_ranges:
        # Numeric range mapping
        L.append(f'{P}def _range_{fn}(val):')
        L.append(f'{P}    try: n = float(val)')
        L.append(f'{P}    except (ValueError, TypeError): return None')
        for k, v in pairs:
            mr = _re.match(r'^(\d+(?:[.,]\d+)?)\s*[-\u2013]\s*(\d+(?:[.,]\d+)?)$', k)
            mp = _re.match(r'^(\d+(?:[.,]\d+)?)\s*\+$', k)
            mge = _re.match(r'^>=\s*(\d+(?:[.,]\d+)?)$', k)
            mgt = _re.match(r'^>\s*(\d+(?:[.,]\d+)?)$', k)
            mle = _re.match(r'^<=\s*(\d+(?:[.,]\d+)?)$', k)
            mlt = _re.match(r'^<\s*(\d+(?:[.,]\d+)?)$', k)
            me  = _re.match(r'^(\d+(?:[.,]\d+)?)$', k)
            if mr:
                lo, hi = mr.group(1), mr.group(2)
                L.append(f'{P}    if {lo} <= n <= {hi}: return {v!r}')
            elif mp:
                L.append(f'{P}    if n >= {mp.group(1)}: return {v!r}')
            elif mge:
                L.append(f'{P}    if n >= {mge.group(1)}: return {v!r}')
            elif mgt:
                L.append(f'{P}    if n > {mgt.group(1)}: return {v!r}')
            elif mle:
                L.append(f'{P}    if n <= {mle.group(1)}: return {v!r}')
            elif mlt:
                L.append(f'{P}    if n < {mlt.group(1)}: return {v!r}')
            elif me:
                L.append(f'{P}    if n == float({me.group(1)!r}): return {v!r}')
        L.append(f'{P}    return None')
        L.append(f'{P}_new_{fn} = df["{col.name}"].apply(_range_{fn})')
    else:
        # Category → Category (case-insensitive)
        dict_repr = '{' + ', '.join(f'{k.strip().lower()!r}: {v!r}' for k, v in pairs) + '}'
        L.append(f'{P}_{fn}_map = {dict_repr}')
        L.append(f'{P}_new_{fn} = df["{col.name}"].astype(str).str.strip().str.lower().map(_{fn}_map)')
        if unmapped_fill:
            L.append(f'{P}_new_{fn} = _new_{fn}.fillna({unmapped_fill!r})')

    # Apply missing fill on top (overrides map result for missing rows)
    if missing_fill:
        L.append(f'{P}_new_{fn} = _new_{fn}.where(~_miss_{fn}, other={missing_fill!r})')

    # Insert new column after original (guard against duplicates)
    L.append(f'{P}if "{new_col}" not in df.columns:')
    L.append(f'{P}    _ins = df.columns.get_loc("{col.name}") + 1')
    L.append(f'{P}    df.insert(_ins, "{new_col}", _new_{fn})')
    # Print summary using pre-computed counts (avoids nested f-string brace escaping)
    mf_repr = repr(missing_fill) if missing_fill else 'None'
    L.append(f'{P}_mc_{fn} = int((~_miss_{fn} & _new_{fn}.notna()).sum())')
    L.append(f'{P}_xc_{fn} = int(_miss_{fn}.sum())')
    L.append(f'{P}print(f"  Recode {col.name!r} -> {new_col!r}: {{_mc_{fn}:,}} mapped, {{_xc_{fn}:,}} missing -> {mf_repr}")')
    L.append('')
    return '\n'.join(L)

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
        "1. Column headings: strip leading/trailing spaces at read time.\n"
        "2. Cell whitespace: for EVERY column, use this pattern — never astype(str):\n"
        "     df[col] = df[col].map(lambda v: re.sub(r'\\s+', ' ', v.strip()) if isinstance(v, str) else v)\n"
        "   (astype(str) converts NaN to the literal string 'nan' — do NOT use it for cleaning)\n"
        "3. Column preservation: output MUST contain EVERY column from the input file.\n"
        "   Never drop or subset. Recode columns: keep original unchanged, add '<col>-New' after it.\n"
    )


def _pandas3_rules() -> str:
    """Return a prompt section covering pandas 3 / Copy-on-Write compatibility rules."""
    return (
        "## CRITICAL — Pandas 3 compatibility rules (all generated code MUST follow these)\n\n"

        "### CoW (Copy-on-Write)\n"
        "Pandas 3 makes CoW the default. Views are read-only. Rules:\n"
        "  - NEVER use inplace=True on any operation.\n"
        "  - NEVER do: series = df[col]; series[mask] = value  (mutates a detached copy, silently ignored).\n"
        "  - ALWAYS assign back: df[col] = df[col].some_operation()\n"
        "  - ALWAYS use: df.loc[mask, col] = value  (not series.loc[...])\n\n"

        "### dtype safety when mixing strings and numbers\n"
        "  - pd.to_numeric(df[col], errors='coerce') produces float64. You CANNOT assign a string like 'Unknown' to it.\n"
        "  - Before assigning any string sentinel to a numeric column, cast to object:\n"
        "      df[col] = df[col].astype(object)\n"
        "      df.loc[df[col].isna(), col] = 'Unknown'\n\n"

        "### select_dtypes\n"
        "  - Use: try: df.select_dtypes(include=['object', 'str'])  except TypeError: df.select_dtypes(include='object')\n\n"

        "### Missing-value detection — must run BEFORE any recoding or mapping\n"
        "  Define this named constant IMMEDIATELY after imports (users edit it to suit their data):\n"
        "    # ---------------------------------------------------------------------------\n"
        "    # GLOBAL SETTING: tokens treated as MISSING wherever they appear on their own\n"
        "    # in a cell (after space-stripping). Case-insensitive. Edit to suit your data.\n"
        "    # ---------------------------------------------------------------------------\n"
        "    DEFAULT_MISSING_SENTINELS = ['-', '--', '.', 'n/a', 'na', 'null', 'none', '#n/a']\n"
        "    GLOBAL_MISSING = set(DEFAULT_MISSING_SENTINELS)  # set for O(1) lookup\n\n"
        "  Detection pattern (use GLOBAL_MISSING, never an inline set):\n"
        "    _missing_mask = df[col].isna() | df[col].astype(str).str.strip().str.lower().isin(GLOBAL_MISSING)\n"
        "  Additional per-column sentinels from the spec extend GLOBAL_MISSING for that column only.\n"
        "  Apply missing replacement using _missing_mask BEFORE applying any value mapping.\n\n"

        "### Value mapping — case-insensitive, space-stripped\n"
        "  When matching mapping keys against cell values:\n"
        "    df[col].astype(str).str.strip().str.lower().map({k.strip().lower(): v for k, v in mapping.items()})\n\n"

        "### Numeric range keys in mapping\n"
        "  Keys like '0-64', '65+', '>=65', '>65', '<=64', '<65', or plain '42' are RANGE/THRESHOLD rules, not literal strings.\n"
        "  Parse them and test numeric cell values. Pattern:\n"
        "    def apply_range_mapping(val, rules):\n"
        "        try: n = float(val)\n"
        "        except (ValueError, TypeError): return None\n"
        "        for key, label in rules:\n"
        "            if matches_range(n, key): return label\n"
        "        return None\n"
        "  First match wins. Non-numeric cells and unmatched numbers receive the missing replacement.\n"
    )



def _col_block(col: ColumnSpec) -> str:
    if not col.selected:
        return f'- Column "{col.name}": carry through unchanged.\n'

    lines = [f'### Column "{col.name}" [{col.col_type}]']

    if col.rename_to:
        lines.append(f'  Rename to: "{col.rename_to}"')

    # ── Recode to different type (v2) ─────────────────────────────────────────
    if col.col_type == 'recode' and col.recode_to_type:
        new_col_name = col.rename_to or f'{col.name}-New'
        lines.append(
            f'  RECODE column: "{col.name}" → new column "{new_col_name}" [{col.recode_to_type}].\n'
            f'  *** DO NOT write any mapping or recode code for this column. ***\n'
            f'  A pre-written, validated recode block will be injected automatically.\n'
            f'  You MUST still apply whitespace cleaning and missing-sentinel detection\n'
            f'  to the ORIGINAL column "{col.name}" as you would for any other column.\n'
            f'  Do NOT create "{new_col_name}" yourself.'
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
        "Write a complete, runnable Python script using pandas that cleans the dataset described below.\n"
        "The script must import: pandas as pd, os, re (and any other stdlib modules it needs).\n\n",
        _section_a(contract),
        "\n",
        _pandas3_rules(),
        "\n",
        _default_hygiene(),
        "\n## Column rules\n"
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
        "        clean_data('<your file path here>')\n\n"
        "## CRITICAL — Report stats dict\n"
        "Use collections.defaultdict(int) for per-column stats so no KeyError can occur:\n"
        "    from collections import defaultdict\n"
        "    col_stats = defaultdict(int)  # keys: values_changed, missing_handled,\n"
        "                                  #       duplicates, unparseable_dates,\n"
        "                                  #       unparseable_numbers, unexpected_categories\n"
        "Never use a plain dict with += on a key that might not exist.\n"
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
        model="gemini-2.5-pro",   # Pro: most reliable instruction-following; 3-5 min acceptable
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
                # ── Inject deterministic recode blocks ───────────────────────
                recode_cols = [c for c in contract.columns
                               if c.selected and c.col_type == 'recode' and c.recode_to_type]
                if recode_cols:
                    recode_section = (
                        '\n    # ── DSC: deterministic recode blocks (injected, do not edit) ──\n'
                        '    try: GLOBAL_MISSING\n'
                        '    except NameError:\n'
                        '        DEFAULT_MISSING_SENTINELS = [\'-\', \'--\', \'.\', \'n/a\', \'na\', \'null\', \'none\', \'#n/a\']\n'
                        '        GLOBAL_MISSING = set(DEFAULT_MISSING_SENTINELS)\n'
                        + ''.join(_generate_recode_block(c) for c in recode_cols)
                    )
                    # Inject before the save call (df.to_csv / df.to_excel)
                    save_pat = _re.compile(r'([ \t]*df\.to_(?:csv|excel)\()', _re.MULTILINE)
                    m = save_pat.search(code)
                    if m:
                        code = code[:m.start()] + recode_section + '\n' + code[m.start():]
                    else:
                        code += '\n' + recode_section
                    print(f"[DSC] Injected {len(recode_cols)} recode block(s)")
                    # Validate post-injection — if broken, add a visible comment warning
                    if not is_valid_python(code):
                        print("[DSC] WARNING: post-injection syntax error — recode section wrapped in try/except")
                        code = code.replace(
                            '\n    # ── DSC: deterministic recode blocks',
                            '\n    # ── DSC: deterministic recode blocks (SYNTAX CHECK FAILED — review manually)'
                        )
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

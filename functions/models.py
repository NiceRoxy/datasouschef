"""
Data contract models for DataSousChef.
Each field maps 1-to-1 with a question in the Interview Script v1.0.
"""
from pydantic import BaseModel, Field
from typing import List, Optional, Dict


# ── Section G helper ─────────────────────────────────────────────────────────

class RecodeRow(BaseModel):
    """One row in a recode/regroup mapping table (QG.2)."""
    old_values: List[str] = Field(..., description="Raw value(s) that should be replaced")
    new_value: str = Field(..., description="The canonical target value")
    condition: Optional[str] = Field(None, description="Optional condition referencing another column")


# ── Per-column spec ───────────────────────────────────────────────────────────

class ColumnSpec(BaseModel):
    """All interview answers for one column (consolidated Section C v2)."""

    # QB — column identity
    name: str = Field(..., description="Exact column header as detected/entered")
    selected: bool = Field(True, description="Whether to apply rules to this column")

    # QC.0 — data type
    col_type: str = Field(
        "text",
        description="id | date | number | category | text | recode"
    )

    # Recode target type (v2)
    recode_to_type: Optional[str] = Field(None, description="Target type when col_type='recode'")

    # Rename (was Section E, now part of Section C v2)
    rename_to: Optional[str] = Field(None, description="New column name after cleaning")

    # ── v2 unified mapping fields ─────────────────────────────────────────────
    # Free-text mapping: 'old → new' lines
    value_mapping: str = Field("", description="Value mapping as free text, one 'old → new' per line")
    unmapped_action: str = Field("system_missing", description="system_missing | keep | other")
    unmapped_custom: str = Field("", description="Description when unmapped_action='other'")

    # Missing values (v2: has_missing bool + sentinels as string)
    has_missing: bool = Field(False, description="Whether column has missing values")
    missing_sentinels: Optional[str] = Field(None, description="Comma-separated sentinel values, e.g. 'blank, NA, 99'")
    missing_action: Optional[str] = Field(None, description="blank | zero | mean | median | remove | unknown | zero_str | custom")
    missing_custom: str = Field("", description="Replacement value when missing_action='custom'")

    # Strip characters (v2)
    strip_chars: str = Field("", description="Characters to strip from values")

    # ── Legacy v1 fields (kept for backward compat, ignored if v2 fields present) ──
    must_be_unique: Optional[str] = Field(None)
    on_duplicate: Optional[str] = Field(None)
    keep_duplicate: Optional[str] = Field(None)
    id_case: Optional[str] = Field(None)
    date_format_in: Optional[str] = Field(None)
    date_format_out: Optional[str] = Field(None)
    decimal_places: Optional[int] = Field(None)
    rounding: Optional[str] = Field(None)
    numeric_symbols: Optional[List[str]] = Field(None)
    valid_min: Optional[float] = Field(None)
    valid_max: Optional[float] = Field(None)
    valid_values: Optional[List[str]] = Field(None)
    category_map: Optional[Dict[str, str]] = Field(None)
    on_unmapped_category: Optional[str] = Field(None)
    capitalisation: Optional[str] = Field(None)
    remove_chars: Optional[str] = Field(None)
    collapse_spaces: Optional[bool] = Field(None)
    recode_map: Optional[List[RecodeRow]] = Field(None)
    recode_catchall: Optional[str] = Field(None)


# ── Cross-column date ordering ────────────────────────────────────────────────

class DateOrderRule(BaseModel):
    """QC.5 — one 'earlier column must precede later column' rule."""
    earlier_col: str
    later_col: str
    on_violation: str = Field("report", description="report | blank_later")


# ── Top-level contract ────────────────────────────────────────────────────────

class DataContract(BaseModel):
    """
    Complete data cleaning brief assembled from the interview.
    Posted to /api/generate-script to produce the Python cleaning script.
    """

    # Section A — file metadata
    file_name: str = Field(..., description="QA.1 exact file name including extension")
    file_format: str = Field(..., description="QA.2: csv | xlsx | xls | tsv | other")
    sheet_name: Optional[str] = Field(None, description="QA.2a Excel sheet name (first sheet if omitted)")
    has_header: bool = Field(True, description="QA.3 first row contains column headings")
    row_count_estimate: str = Field("unknown", description="QA.4: under_1k | 1k_10k | 10k_100k | over_100k | unknown")
    encoding: str = Field("utf-8", description="QA.5: utf-8 | windows-1252 | unknown")

    # Sections B–G — column specs
    columns: List[ColumnSpec] = Field(default_factory=list)

    # QC.5 — date ordering rules (asked once, not per column)
    date_order_rules: List[DateOrderRule] = Field(default_factory=list)

    # Section H — output
    output_name: str = Field("cleaned", description="QH.1 base name for the output file")
    output_format: str = Field("same", description="QH.2: same | csv | xlsx")

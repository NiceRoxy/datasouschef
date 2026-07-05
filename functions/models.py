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
    """All interview answers for one column (Sections B–G)."""

    # QB — column identity
    name: str = Field(..., description="Exact column header as detected/entered")
    selected: bool = Field(True, description="QB.2 — whether to apply rules to this column")

    # QC.0 — data type
    col_type: str = Field(
        "text",
        description="id | date | number | category | text"
    )

    # QE.1 — rename
    rename_to: Optional[str] = Field(None, description="New column name after cleaning")

    # C-ID fields (QC.1 – QC.2)
    must_be_unique: Optional[str] = Field(None, description="yes | no | unsure")
    on_duplicate: Optional[str] = Field(None, description="report | remove")
    keep_duplicate: Optional[str] = Field(None, description="first | last | latest_date:<col>")
    id_case: Optional[str] = Field(None, description="upper | lower | none")

    # C-Date fields (QC.3 – QC.4)
    date_format_in: Optional[str] = Field(None, description="DD/MM/YYYY | MM/DD/YYYY | YYYY-MM-DD | mixed | unsure")
    date_format_out: Optional[str] = Field(None, description="YYYY-MM-DD | DD/MM/YYYY | keep")

    # C-Number fields (QC.6 – QC.8)
    decimal_places: Optional[int] = Field(None, description="Number of decimal places, or None for integers")
    rounding: Optional[str] = Field(None, description="half_up | keep")
    numeric_symbols: Optional[List[str]] = Field(None, description="Symbols to strip before conversion, e.g. ['£','%',',']")
    valid_min: Optional[float] = Field(None, description="QC.8 lower bound for range check (report only)")
    valid_max: Optional[float] = Field(None, description="QC.8 upper bound for range check (report only)")

    # C-Category fields (QC.9 – QC.11)
    valid_values: Optional[List[str]] = Field(None, description="QC.9 canonical value list")
    category_map: Optional[Dict[str, str]] = Field(None, description="QC.10 variant → canonical mapping")
    on_unmapped_category: Optional[str] = Field(None, description="report | set_unknown | keep")

    # Section D — missing values
    missing_sentinels: Optional[List[str]] = Field(None, description="QD.2 values that mean 'missing', e.g. ['','NA','99']")
    missing_action: Optional[str] = Field(None, description="QD.3: standardise | replace:<label> | remove_record | report_only")

    # Section F — cleaning actions
    capitalisation: Optional[str] = Field(None, description="upper | lower | title | none")
    remove_chars: Optional[str] = Field(None, description="Characters or patterns to strip")
    collapse_spaces: Optional[bool] = Field(None, description="Collapse repeated internal spaces (opt-in for text columns)")

    # Section G — recode / regroup
    recode_map: Optional[List[RecodeRow]] = Field(None, description="QG.2 ordered mapping rules")
    recode_catchall: Optional[str] = Field(None, description="QG.3: keep | set_unknown | report")


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

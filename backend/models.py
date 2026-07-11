from pydantic import BaseModel, Field
from typing import List, Optional, Any

class ColumnSpec(BaseModel):
    name: str
    selected: bool = True
    col_type: str = 'text'           # id | date | number | category | text | recode
    recode_to_type: Optional[str] = None
    rename_to: Optional[str] = None
    value_mapping: str = ''          # "old → new" lines
    unmapped_action: str = 'system_missing'  # system_missing | keep | other
    unmapped_custom: str = ''
    has_missing: bool = False
    missing_sentinels: str = ''      # comma-separated
    missing_action: str = 'blank'    # blank | zero | mean | median | remove | unknown | zero_str | custom
    missing_custom: str = ''
    strip_chars: str = ''

class DateOrderRule(BaseModel):
    earlier_col: str
    later_col: str
    on_violation: str = 'report'

class DataContract(BaseModel):
    file_name: str = ''
    file_format: str = 'csv'
    sheet_name: Optional[str] = None
    has_header: bool = True
    row_count_estimate: str = 'unknown'
    encoding: str = 'utf-8'
    columns: List[ColumnSpec] = Field(default_factory=list)
    date_order_rules: List[DateOrderRule] = Field(default_factory=list)
    output_name: str = 'cleaned'
    output_format: str = 'same'

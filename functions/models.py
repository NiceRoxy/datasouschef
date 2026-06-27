from pydantic import BaseModel, Field
from typing import List, Optional

class ColumnConfig(BaseModel):
    name: str = Field(..., description="The exact column header in the dataset")
    expected_type: str = Field(..., description="The expected data type")
    missing_values: Optional[str] = Field(None, description="Whether missing values exist (yes/no)")
    missing_code: Optional[str] = Field(None, description="How missing values are coded")
    context: Optional[str] = Field(None, description="Type-specific context (e.g. constraints, formats)")
    meaning: Optional[str] = Field(None, description="What the column represents")

class LinkConfig(BaseModel):
    link_problem: Optional[str] = Field(None, description="Problem the linked dataset answers")
    link_primary: Optional[str] = Field(None, description="Primary dataset to keep all records from")
    link_names: Optional[str] = Field(None, description="Names of the datasets being joined")
    link_keys: Optional[str] = Field(None, description="Column(s) used as match keys")
    link_consistency: Optional[str] = Field(None, description="Consistency of identifiers")
    link_match_type: Optional[str] = Field(None, description="Type of match")
    link_join_type: Optional[str] = Field(None, description="Type of join")
    link_on_unmatched: Optional[str] = Field(None, description="Handling of duplicates/unmatched")

class DataContract(BaseModel):
    dataset_name: str = Field(..., description="Name of the dataset")
    dataset_format: str = Field(..., description="Format (csv, xlsx, etc.)")
    dataset_encoding: str = Field(..., description="Encoding (utf-8, etc.)")
    dataset_rows: str = Field(..., description="Rough number of rows")

    selected_procedures: List[str] = Field(..., description="List containing 'diagnose', 'crosscol', and/or 'link'")

    # Specifics for Diagnose & Standardise
    columns_to_clean: List[ColumnConfig] = Field(default_factory=list)

    # Specifics for Cross-Column
    cross_col_description: Optional[str] = Field(None)
    cross_col_rules: List[str] = Field(default_factory=list)

    # Specifics for Link Datasets
    link_config: Optional[LinkConfig] = Field(None)

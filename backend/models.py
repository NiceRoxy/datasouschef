from pydantic import BaseModel, Field
from typing import List, Optional

class ColumnConfig(BaseModel):
    name: str = Field(..., description="The exact column header in the dataset")
    expected_type: str = Field(..., description="The expected data type (text, number, date, category)")
    meaning: Optional[str] = Field(None, description="What the column represents")

class CrossColRules(BaseModel):
    rules: List[str] = Field(default_factory=list, description="List of cross-column check IDs like 'date_order', 'age_dob'")

class LinkConfig(BaseModel):
    link_names: Optional[str] = Field(None, description="Names of the datasets being joined")
    link_keys: Optional[str] = Field(None, description="Column(s) used as match keys")
    link_consistency: Optional[str] = Field(None, description="Consistency of identifiers (e.g., 'identical', 'different_formatting')")
    link_match_type: Optional[str] = Field(None, description="Type of match (e.g., 'exact', 'normalised')")
    link_join_type: Optional[str] = Field(None, description="Type of join (e.g., 'all_from_first', 'only_matches')")
    link_on_unmatched: Optional[str] = Field(None, description="Handling of duplicates/unmatched (e.g., 'report_keep')")

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

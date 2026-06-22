import os
from agent import generate_cleaning_script
from models import DataContract, ColumnConfig

def main():
    print("Testing generate_cleaning_script...")
    contract = DataContract(
        dataset_name="Sales_Data.csv",
        dataset_format="csv",
        dataset_encoding="utf-8",
        dataset_rows="1000",
        selected_procedures=["diagnose"],
        columns_to_clean=[
            ColumnConfig(
                name="Revenue",
                expected_type="float",
                missing_values="yes",
                missing_code="NULL",
                context="Must be positive",
                meaning="Total revenue"
            )
        ]
    )
    
    script = generate_cleaning_script(contract)
    print("\n=== GENERATED SCRIPT ===")
    print(script)

if __name__ == "__main__":
    main()

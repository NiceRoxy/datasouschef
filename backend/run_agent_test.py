import os
from agent import generate_cleaning_script
from models import DataContract, LinkConfig

def main():
    print("Testing generate_cleaning_script with Dummy Datasets...")
    contract = DataContract(
        dataset_name="Student_Data",
        dataset_format="csv",
        dataset_encoding="utf-8",
        dataset_rows="50",
        selected_procedures=["diagnose", "crosscol", "link"],
        columns_to_clean=[],
        cross_col_description="Ensure Extension Permission logic works: If 'Yes', Complete Date can be > Deadline. Else, flag.",
        link_config=LinkConfig(
            link_problem="We need to link student module results to the student register.",
            link_primary="student_register.csv",
            link_names="student_register.csv, student_module_results.csv",
            link_keys="Student ID",
            link_consistency="Student IDs might be lowercase in some files.",
            link_match_type="Exact match after standardisation",
            link_join_type="Inner join but also want to see orphans",
            link_on_unmatched="Output orphans to separate CSVs"
        )
    )
    
    script = generate_cleaning_script(contract)
    print("\n=== GENERATED SCRIPT ===")
    print(script)

    # optionally write the script to a file to inspect
    with open("generated_test_script.py", "w") as f:
        f.write(script)
    print("\nScript saved to backend/generated_test_script.py")

if __name__ == "__main__":
    main()

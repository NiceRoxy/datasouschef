import datetime
from .models import DataContract

def generate_mock_script(contract: DataContract) -> str:
    """
    Generates a mock Python script based on the DataContract.
    This demonstrates the end-to-end pipeline.
    """
    
    timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    script_lines = []
    
    # 1. Header
    script_lines.append('"""')
    script_lines.append(f"DataSousChef Generated Script")
    script_lines.append(f"Generated on: {timestamp}")
    script_lines.append(f"Dataset: {contract.dataset_name}")
    script_lines.append(f"Format: {contract.dataset_format}")
    script_lines.append(f"Expected Rows: {contract.dataset_rows}")
    script_lines.append('"""')
    script_lines.append("")
    script_lines.append("import pandas as pd")
    script_lines.append("import numpy as np")
    script_lines.append("")
    
    # 2. Main execution block
    script_lines.append("def main():")
    script_lines.append(f"    print('Starting data preparation for: {contract.dataset_name}')")
    script_lines.append(f"    # Load data (user will replace the filepath)")
    script_lines.append(f"    # df = pd.read_{'excel' if contract.dataset_format == 'xlsx' else 'csv'}('your_file_here.{contract.dataset_format}', encoding='{contract.dataset_encoding}')")
    script_lines.append("")
    
    # 3. Diagnose procedures
    if 'diagnose' in contract.selected_procedures and contract.columns_to_clean:
        script_lines.append("    # --- Diagnose & Standardise ---")
        for col in contract.columns_to_clean:
            script_lines.append(f"    print('Cleaning column: {col.name} (Expected Type: {col.expected_type})')")
            if col.expected_type == 'text':
                script_lines.append(f"    # df['{col.name}'] = df['{col.name}'].str.strip().str.title()")
            elif col.expected_type == 'number':
                script_lines.append(f"    # df['{col.name}'] = pd.to_numeric(df['{col.name}'], errors='coerce')")
            elif col.expected_type == 'date':
                script_lines.append(f"    # df['{col.name}'] = pd.to_datetime(df['{col.name}'], errors='coerce')")
        script_lines.append("")
    
    # 4. Cross-column checks
    if 'crosscol' in contract.selected_procedures and contract.cross_col_rules:
        script_lines.append("    # --- Cross-Column Checks ---")
        if contract.cross_col_description:
            script_lines.append(f"    # User Description: {contract.cross_col_description}")
        for rule in contract.cross_col_rules:
            script_lines.append(f"    print('Applying cross-column rule: {rule}')")
        script_lines.append("")
    
    # 5. Link datasets
    if 'link' in contract.selected_procedures and contract.link_config:
        cfg = contract.link_config
        script_lines.append("    # --- Link Datasets ---")
        script_lines.append(f"    print('Linking datasets: {cfg.link_names}')")
        script_lines.append(f"    print('Join Keys: {cfg.link_keys}')")
        script_lines.append(f"    print('Join Type: {cfg.link_join_type}')")
        script_lines.append("")
        
    script_lines.append("    print('Done!')")
    script_lines.append("")
    script_lines.append("if __name__ == '__main__':")
    script_lines.append("    main()")
    script_lines.append("")
    
    return "\n".join(script_lines)

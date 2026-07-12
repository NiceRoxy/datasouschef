import pandas as pd
import os
import re
from collections import defaultdict

# ---------------------------------------------------------------------------
# GLOBAL SETTING: tokens treated as MISSING wherever they appear on their own
# in a cell (after space-stripping). Case-insensitive. Edit to suit your data.
# ---------------------------------------------------------------------------
DEFAULT_MISSING_SENTINELS = ['-', '--', '.', 'n/a', 'na', 'null', 'none', '#n/a']
GLOBAL_MISSING = set(s.lower() for s in DEFAULT_MISSING_SENTINELS)


def clean_data(file_path: str):
    """
    Reads, cleans, and saves the student register record data.

    Args:
        file_path (str): The full path to the input Excel file.
    """
    # --- 1. Read Data and Initial Setup ---
    if not os.path.exists(file_path):
        print(f"Error: File not found at {file_path}")
        return

    try:
        # Read the first sheet of the Excel file.
        df = pd.read_excel(file_path, sheet_name=0)
    except Exception as e:
        print(f"Error reading Excel file: {e}")
        return

    # Initialize statistics dictionary for the summary report.
    report_stats = defaultdict(lambda: defaultdict(int))
    initial_rows = len(df)
    report_stats['summary']['rows_read'] = initial_rows

    # --- 2. Default Hygiene ---

    # 2.1. Clean column headings by stripping leading/trailing whitespace.
    df.columns = df.columns.str.strip()

    # 2.2. For EVERY column, strip and consolidate whitespace in string cells.
    # This pattern avoids converting NaNs or numbers to strings.
    for col in df.columns:
        df[col] = df[col].map(
            lambda v: re.sub(r'\s+', ' ', v.strip()) if isinstance(v, str) else v
        )

    # --- 3. Column-Specific Cleaning ---

    # Dictionary to track which columns have been recoded to new '-New' columns.
    # This will be used to correctly order the final columns.
    recoded_cols_map = {}

    # --- Column "Banner ID" ---
    original_col = 'Banner ID'
    new_name = 'Rolling_number'
    if original_col in df.columns:
        # Rename the column.
        df = df.rename(columns={original_col: new_name})
        
        # Strip '@' characters from all values.
        original_series = df[new_name].copy()
        df[new_name] = df[new_name].map(
            lambda v: v.replace('@', '') if isinstance(v, str) else v
        )
        changes = (original_series != df[new_name]).sum()
        if changes > 0:
            report_stats[new_name]['values_changed'] = changes
    else:
        print(f"Warning: Column '{original_col}' not found in the input file.")

    # --- Column "Parental HE Experience" ---
    original_col = 'Parental HE Experience'
    new_name = 'First-gen in HE'
    if original_col in df.columns:
        # Rename the column first.
        df = df.rename(columns={original_col: new_name})
        
        # Create the new column, keeping the original unchanged.
        new_col = f'{new_name}-New'
        df[new_col] = df[new_name]
        recoded_cols_map[new_name] = new_col

        # Define missing sentinels for this column, extending the global set.
        local_missing = GLOBAL_MISSING.union({'-'})
        
        # Identify missing values based on NaNs and the sentinel list.
        _missing_mask = df[new_col].isna() | df[new_col].astype(str).str.strip().str.lower().isin(local_missing)
        missing_count = _missing_mask.sum()

        if missing_count > 0:
            report_stats[new_name]['missing_handled'] = missing_count
            report_stats[new_name]['values_changed'] = missing_count
            
            # Replace missing values with 'Unknown'.
            df.loc[_missing_mask, new_col] = 'Unknown'
    else:
        print(f"Warning: Column '{original_col}' not found in the input file.")

    # --- Column "New UCAS Points" ---
    original_col = 'New UCAS Points'
    if original_col in df.columns:
        # Create the new column.
        new_col = f'{original_col}-New'
        df[new_col] = df[original_col]
        recoded_cols_map[original_col] = new_col

        # The rule is to replace any non-numeric value (including sentinels) with 'No UCAS score'.
        # We identify these by seeing what `pd.to_numeric` turns into NaN.
        original_values = df[new_col]
        numeric_values = pd.to_numeric(original_values, errors='coerce')
        change_mask = numeric_values.isna()
        
        change_count = change_mask.sum()

        if change_count > 0:
            report_stats[original_col]['missing_handled'] = change_count
            report_stats[original_col]['values_changed'] = change_count
            
            # To assign a string ('No UCAS score'), the column must be of object dtype.
            # We use the pre-calculated numeric series and cast it to object.
            df[new_col] = numeric_values.astype(object)
            
            # Now, use the mask to replace the NaNs (which were the non-numeric values).
            df.loc[change_mask, new_col] = 'No UCAS score'
    else:
        print(f"Warning: Column '{original_col}' not found in the input file.")

    # --- Column "Low SEC" ---
    original_col = 'Low SEC'
    if original_col in df.columns:
        # Create the new column.
        new_col = f'{original_col}-New'
        df[new_col] = df[original_col]
        recoded_cols_map[original_col] = new_col

        # Define missing sentinels for this column.
        local_missing = GLOBAL_MISSING.union({'-'})
        
        # Identify missing values.
        _missing_mask = df[new_col].isna() | df[new_col].astype(str).str.strip().str.lower().isin(local_missing)
        missing_count = _missing_mask.sum()

        if missing_count > 0:
            report_stats[original_col]['missing_handled'] = missing_count
            report_stats[original_col]['values_changed'] = missing_count
            
            # Replace missing values with '3'.
            df.loc[_missing_mask, new_col] = '3'
    else:
        print(f"Warning: Column '{original_col}' not found in the input file.")

    # --- 4. Final Column Ordering ---
    # Ensure new columns appear immediately after their original counterparts.
    
    # Get the list of columns after renames but before new columns were added.
    columns_before_new = [c for c in df.columns if c not in recoded_cols_map.values()]
    
    final_columns = []
    for col in columns_before_new:
        final_columns.append(col)
        if col in recoded_cols_map:
            final_columns.append(recoded_cols_map[col])
    
    df = df[final_columns]

    # --- 5. Save Cleaned Data ---
    output_filename = 'Student register record - testing_cleaned.csv'
    try:
        df.to_csv(output_filename, index=False, encoding='utf-8')
    except Exception as e:
        print(f"Error saving cleaned file to '{output_filename}': {e}")
        return

    # --- 6. Generate and Print Report ---
    final_rows = len(df)
    report_stats['summary']['rows_written'] = final_rows

    print("\n--- Data Cleaning Report ---")
    print(f"Rows read: {initial_rows}")
    print(f"Rows written: {final_rows}")
    print("----------------------------")

    total_issues = 0
    # Sort columns for a consistent report order.
    sorted_cols = sorted([col for col in report_stats if col != 'summary'])
    
    for col in sorted_cols:
        stats = report_stats[col]
        if not stats:
            continue

        print(f"Column: '{col}'")
        if stats['values_changed'] > 0:
            print(f"  - Values changed: {stats['values_changed']}")
        if stats['missing_handled'] > 0:
            print(f"  - Missing values handled: {stats['missing_handled']}")
        
        col_issues = sum(stats.values())
        total_issues += col_issues

    print("----------------------------")
    if total_issues == 0:
        print("Checks passed")
    else:
        print(f"{total_issues} issues found")


if __name__ == '__main__':
    # USAGE: Replace the placeholder with the actual path to your Excel file.
    # Example: clean_data('C:/Users/YourUser/Downloads/Student register record - testing.xlsx')
    clean_data('Student register record - testing.xlsx')
import pandas as pd
import numpy as np
import os

def clean_data(file_path):
    # Load the primary dataset (student_register.csv)
    df_register = pd.read_csv(file_path, encoding='utf-8')
    
    # Determine the directory to locate the secondary dataset and save orphans
    dir_name = os.path.dirname(file_path)
    results_path = os.path.join(dir_name, 'student_module_results.csv')
    
    # Load the secondary dataset (student_module_results.csv) if it exists
    if os.path.exists(results_path):
        df_results = pd.read_csv(results_path, encoding='utf-8')
    else:
        # Fallback to empty DataFrame if not found
        df_results = pd.DataFrame()

    # Helper function for Rule 4: ID standardisation
    def standardise_ids(df):
        for col in df.columns:
            # Identify ID columns by checking if 'id' is in the column name
            if 'id' in col.lower():
                # Trim whitespace and uppercase
                df[col] = df[col].astype(str).str.strip().str.upper()
        return df

    # Helper function for Rule 2: Date format standardisation
    def standardise_dates(df):
        for col in df.columns:
            if df[col].dtype == 'object':
                # Auto-detect dates based on column name heuristics
                if any(keyword in col.lower() for keyword in ['date', 'deadline', 'time']):
                    df[col] = pd.to_datetime(df[col], errors='coerce').dt.strftime('%Y-%m-%d')
                else:
                    # Auto-detect by attempting to parse a non-numeric sample
                    sample = df[col].dropna()
                    if not sample.empty and not sample.astype(str).str.isnumeric().all():
                        try:
                            pd.to_datetime(sample.head(10), errors='raise')
                            df[col] = pd.to_datetime(df[col], errors='coerce').dt.strftime('%Y-%m-%d')
                        except (ValueError, TypeError):
                            pass
        return df

    # Apply ID and Date standardisation to both datasets
    df_register = standardise_ids(df_register)
    df_register = standardise_dates(df_register)
    
    if not df_results.empty:
        df_results = standardise_ids(df_results)
        df_results = standardise_dates(df_results)

    # Rule 3: Register Status normalisation
    if 'Register Status' in df_register.columns:
        # Canonical mapping for fuzzy matching/typos
        status_map = {
            'active': 'Active',
            'withdrwal': 'Withdrawn',
            'withdrawn': 'Withdrawn',
            'suspended': 'Suspended',
            'suspend': 'Suspended',
            'defer': 'Deferred',
            'deferred': 'Deferred'
        }
        # Lowercase and strip to catch variations, then map to standard terms
        cleaned_status = df_register['Register Status'].astype(str).str.strip().str.lower()
        df_register['Register Status'] = cleaned_status.map(status_map).fillna(df_register['Register Status'])

    # Rule 1: Extension Permission logic normalisation
    if not df_results.empty and 'Extension Permission' in df_results.columns:
        # Normalise "YES", "Yes", "yes" to "Yes", and "No", "no", "N" to "No"
        ext_map = {'yes': 'Yes', 'y': 'Yes', 'no': 'No', 'n': 'No'}
        cleaned_ext = df_results['Extension Permission'].astype(str).str.strip().str.lower()
        df_results['Extension Permission'] = cleaned_ext.map(ext_map).fillna('No')

    # Rule 5: Cross-dataset orphan detection & Dataset Linkage
    if not df_results.empty and 'Student ID' in df_register.columns and 'Student ID' in df_results.columns:
        # Perform an outer join to identify matched and unmatched records
        merged_df = pd.merge(df_register, df_results, on='Student ID', how='outer', indicator=True)
        
        # Surface unmatched records from both sides
        left_only = merged_df[merged_df['_merge'] == 'left_only'].drop(columns=['_merge'])
        right_only = merged_df[merged_df['_merge'] == 'right_only'].drop(columns=['_merge'])
        
        # Output orphans to separate CSVs rather than silently dropping them
        left_only.to_csv(os.path.join(dir_name, 'register_orphans.csv'), index=False, encoding='utf-8')
        right_only.to_csv(os.path.join(dir_name, 'results_orphans.csv'), index=False, encoding='utf-8')
        
        # Keep only the inner join records for the final dataset
        df_final = merged_df[merged_df['_merge'] == 'both'].drop(columns=['_merge']).copy()
    else:
        df_final = df_register.copy()

    # Rule 1 & Cross-Column Checks: Flag late assessments
    if 'Assessment Complete Date' in df_final.columns and 'Assessment Deadline' in df_final.columns:
        # Convert to datetime objects for accurate comparison
        comp_date = pd.to_datetime(df_final['Assessment Complete Date'], errors='coerce')
        dead_date = pd.to_datetime(df_final['Assessment Deadline'], errors='coerce')
        
        # Check extension permission status
        if 'Extension Permission' in df_final.columns:
            # Flag if Extension is "No" or missing (not "Yes")
            ext_mask = df_final['Extension Permission'] != 'Yes'
        else:
            # If column is missing, assume no extension was granted
            ext_mask = True
            
        # MUST flag records where Complete Date > Deadline AND Extension is "No" or missing
        df_final['Late_Submission_Flag'] = (comp_date > dead_date) & ext_mask

    # Rule 6: Withdrawn student handling
    if 'Register Status' in df_final.columns:
        # Flag result records for students with a "Withdrawn" or "Suspended" register status
        withdrawn_statuses = ['Withdrawn', 'Suspended']
        df_final['Flag_Withdrawn_Suspended'] = df_final['Register Status'].isin(withdrawn_statuses)

    return df_final
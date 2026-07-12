"""
DataSousChef — Quality Report Script
Generated automatically. Run AFTER the cleaning script.

Usage:  python Student register record - testing_cleaned_report.py
"""
import pandas as pd, os

CLEANED_FILE = "Student register record - testing_cleaned.csv"

def _load(path):
    ext = os.path.splitext(path)[1].lower()
    return pd.read_excel(path) if ext in ('.xlsx', '.xls') else pd.read_csv(path)

try:
    df = _load(CLEANED_FILE)
except FileNotFoundError:
    print(f"ERROR: '{CLEANED_FILE}' not found. Run the cleaning script first.")
    raise SystemExit(1)

SEP = "=" * 60
print(f"\n{SEP}\nQUALITY REPORT: {CLEANED_FILE}")
print(f"Rows: {len(df):,}   |   Columns: {len(df.columns)}\n{SEP}")


if "Banner ID" in df.columns:
    _s = df["Banner ID"]
    print(f"\n[ Banner ID ] — text")
    print(f"  Missing: {_s.isna().sum():,}")
    print(_s.value_counts(dropna=False).to_string())

if "New UCAS Points" in df.columns:
    _s = pd.to_numeric(df["New UCAS Points"], errors='coerce')
    _mode = _s.mode().iloc[0] if not _s.mode().empty else 'N/A'
    print(f"\n[ New UCAS Points ] — number")
    print(f"  Missing: {_s.isna().sum():,} | Min: {_s.min()} | Max: {_s.max()}")
    print(f"  Mean: {round(_s.mean(), 4) if not _s.isna().all() else 'N/A'} | Median: {_s.median()} | Mode: {_mode}")

if "Parental HE Experience" in df.columns:
    _s = df["Parental HE Experience"]
    print(f"\n[ Parental HE Experience ] — category")
    print(f"  Missing: {_s.isna().sum():,}")
    print(_s.value_counts(dropna=False).to_string())

if "Low SEC" in df.columns:
    _s = df["Low SEC"]
    print(f"\n[ Low SEC ] — category")
    print(f"  Missing: {_s.isna().sum():,}")
    print(_s.value_counts(dropna=False).to_string())

print(f"\n{SEP}\nReport complete.\n{SEP}")

/**
 * reporting-generator.js
 * Generates a standalone Python quality-report script from a DataContract.
 * Pure template — no AI, no network call.
 *
 * @param {object} contract
 * @returns {string} Python source
 */
export function generateReportingScript(contract) {
  const cols = contract.columns.filter(c => c.selected);
  const outName = contract.output_name || 'cleaned';
  const ext = resolveExt(contract);
  const cleanedFile = `${outName}.${ext}`;

  const colBlocks = cols.flatMap(col => {
    const displayName = col.rename_to || col.name;
    const blocks = [buildTypeBlock(col.col_type, displayName)];
    if (col.recode_to_type) blocks.push(buildTypeBlock(col.recode_to_type, `${displayName}-New`));
    return blocks;
  }).join('');

  return `"""
DataSousChef — Quality Report Script
Generated automatically. Run AFTER the cleaning script.

Usage:  python ${outName}_report.py
"""
import pandas as pd, os

CLEANED_FILE = "${cleanedFile}"

def _load(path):
    ext = os.path.splitext(path)[1].lower()
    return pd.read_excel(path) if ext in ('.xlsx', '.xls') else pd.read_csv(path)

try:
    df = _load(CLEANED_FILE)
except FileNotFoundError:
    print(f"ERROR: '{CLEANED_FILE}' not found. Run the cleaning script first.")
    raise SystemExit(1)

SEP = "=" * 60
print(f"\\n{SEP}\\nQUALITY REPORT: {CLEANED_FILE}")
print(f"Rows: {len(df):,}   |   Columns: {len(df.columns)}\\n{SEP}")

${colBlocks}
print(f"\\n{SEP}\\nReport complete.\\n{SEP}")
`;
}

function resolveExt(contract) {
  if (contract.output_format && contract.output_format !== 'same') return contract.output_format;
  return (contract.file_format === 'xlsx' || contract.file_format === 'xls') ? 'xlsx' : 'csv';
}

function buildTypeBlock(colType, name) {
  const q = JSON.stringify(name);
  switch (colType) {
    case 'id':
      return `
if ${q} in df.columns:
    _s = df[${q}]
    print(f"\\n[ ${name} ] — id")
    print(f"  Total : {len(_s):,} | Unique: {_s.nunique():,} | Duplicates: {_s.duplicated().sum():,} | Missing: {_s.isna().sum():,}")
`;
    case 'date':
      return `
if ${q} in df.columns:
    _s = pd.to_datetime(df[${q}], errors='coerce')
    print(f"\\n[ ${name} ] — date")
    print(f"  Missing: {_s.isna().sum():,} | Oldest: {_s.min()} | Most recent: {_s.max()}")
`;
    case 'number':
      return `
if ${q} in df.columns:
    _s = pd.to_numeric(df[${q}], errors='coerce')
    _mode = _s.mode().iloc[0] if not _s.mode().empty else 'N/A'
    print(f"\\n[ ${name} ] — number")
    print(f"  Missing: {_s.isna().sum():,} | Min: {_s.min()} | Max: {_s.max()}")
    print(f"  Mean: {round(_s.mean(), 4) if not _s.isna().all() else 'N/A'} | Median: {_s.median()} | Mode: {_mode}")
`;
    case 'category':
    case 'text':
    default:
      return `
if ${q} in df.columns:
    _s = df[${q}]
    print(f"\\n[ ${name} ] — ${colType}")
    print(f"  Missing: {_s.isna().sum():,}")
    print(_s.value_counts(dropna=False).to_string())
`;
  }
}

import docx

doc = docx.Document('C:/Users/chuan/DataSousChef/documents/DataSousChef_QA_Bug_Report_Antigravity.docx')

print('--- PARAGRAPHS & TABLES ---')

for block in doc.iter_inner_content():
    if isinstance(block, docx.text.paragraph.Paragraph):
        print(block.text)
    elif isinstance(block, docx.table.Table):
        print('\n[TABLE]')
        for row in block.rows:
            row_data = []
            for cell in row.cells:
                # cell.text contains the text of the cell
                row_data.append(cell.text.replace('\n', ' ').strip())
            print(' | '.join(row_data))
        print('[/TABLE]\n')

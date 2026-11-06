from io import BytesIO
from zipfile import ZipFile, ZIP_DEFLATED
import pytest

from document_worker import extract_document, ExtractionError

def make_office(part, text):
    buf=BytesIO()
    with ZipFile(buf, 'w', ZIP_DEFLATED) as z:
        z.writestr(part,text)
    return buf.getvalue()

def test_docx_arabic_and_sku_preserves_section_location():
    raw=make_office('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>سياسة الشحن SKU-42</w:t></w:r></w:p></w:body></w:document>')
    result=extract_document(raw,'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    assert 'سياسة الشحن SKU-42' in result['sections'][0]['text']
    assert result['sections'][0]['location'].startswith('word/document.xml')

def test_xlsx_cell_refs_and_prices_are_traceable():
    from openpyxl import Workbook
    wb=Workbook()
    ws=wb.active
    ws.title='Catalog'
    ws['A1']='SKU'
    ws['B2']='SKU-42'
    ws['C2']=120
    b=BytesIO()
    wb.save(b)
    result=extract_document(b.getvalue(),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    assert any(s['location']=='Catalog!B2' and s['text']=='SKU-42' for s in result['sections'])
    assert any(s['location']=='Catalog!C2' and s['text']=='120' for s in result['sections'])

def test_csv_quoted_newlines_and_html_script_removed():
    result=extract_document('sku,description\\nSKU-42,"red\\nbox"'.replace('\\n','\n').encode(),'text/csv')
    assert any('red\nbox' in s['text'] for s in result['sections'])
    html=extract_document(b'<html><body><h1>Sale</h1><script>stealAll()</script><p>SKU-42</p></body></html>','text/html')
    text=' '.join(s['text'] for s in html['sections'])
    assert 'SKU-42' in text and 'stealAll' not in text

def test_rejects_too_large_and_zip_bomb_without_extraction():
    with pytest.raises(ExtractionError):
        extract_document(b'x'*1025,'text/plain',max_bytes=1024)
    large=make_office('word/document.xml','<root>'+'X'*1000000+'</root>')
    with pytest.raises(ExtractionError):
        extract_document(large,'application/vnd.openxmlformats-officedocument.wordprocessingml.document',max_uncompressed=10000)

def build_pdf_with_text():
    from pypdf import PdfWriter
    from pypdf.generic import NameObject, DictionaryObject, DecodedStreamObject
    writer=PdfWriter()
    page=writer.add_blank_page(width=600,height=800)
    font=DictionaryObject({
        NameObject('/Type'):NameObject('/Font'),
        NameObject('/Subtype'):NameObject('/Type1'),
        NameObject('/BaseFont'):NameObject('/Helvetica')
    })
    font_ref=writer._add_object(font)
    page[NameObject('/Resources')]=DictionaryObject({
        NameObject('/Font'):DictionaryObject({NameObject('/F1'):font_ref})
    })
    stream=DecodedStreamObject()
    stream.set_data(b'BT /F1 20 Tf 50 700 Td (SKU-42) Tj ET')
    page[NameObject('/Contents')]=writer._add_object(stream)
    buf=BytesIO()
    writer.write(buf)
    return buf.getvalue()

def test_pdf_text_is_extracted_with_page_provenance():
    pytest.importorskip('pypdf')
    result=extract_document(build_pdf_with_text(),'application/pdf')
    assert result['sections'][0]['location']=='page:1'
    assert 'SKU-42' in result['sections'][0]['text']

"""Bounded, no-network document extraction with exact source locations.

Invocation: echo '{"mimeType":"text/csv","base64":"..."}' | python3 document_worker.py
Business permissions and knowledge-store writes are never accepted from document contents.
"""
import base64
import csv
import io
import json
import re
import sys
from html.parser import HTMLParser
from xml.etree import ElementTree
from zipfile import ZipFile, BadZipFile

DOCX='application/vnd.openxmlformats-officedocument.wordprocessingml.document'
XLSX='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
PPTX='application/vnd.openxmlformats-officedocument.presentationml.presentation'
PDF='application/pdf'
LIMIT=15*1024*1024

class ExtractionError(ValueError):
    pass

class TextParser(HTMLParser):
    def __init__(self, max_depth: int = 100):
        super().__init__(convert_charrefs=True)
        self.max_depth = max_depth
        self.ignored=0
        self.parts=[]
    def handle_starttag(self,tag,attrs):
        if tag in ('script','style','noscript','template'): self.ignored+=1
    def handle_endtag(self,tag):
        if tag in ('script','style','noscript','template') and self.ignored:self.ignored-=1
        if tag in ('p','div','h1','h2','h3','li','tr') and not self.ignored:self.parts.append('\n')
    def handle_data(self,data):
        if not self.ignored:self.parts.append(data)

def bounded_zip(data,limit):
    try:
        z=ZipFile(io.BytesIO(data))
        info=z.infolist()
        if len(info)>1000 or sum(item.file_size for item in info)>limit:
            raise ExtractionError('Archive exceeds safe extraction limit')
        for item in info:
            path=item.filename.replace('\\','/')
            if item.file_size>limit or path.startswith('/') or '..' in path.split('/') or item.flag_bits&1:
                raise ExtractionError('Unsafe archive member')
        return z
    except (BadZipFile,OverflowError):
        raise ExtractionError('Invalid office document archive')

def extract_document(data,mime_type,max_bytes=LIMIT,max_uncompressed=30*1024*1024):
    if not isinstance(data,(bytes,bytearray)) or not data or len(data)>max_bytes:
        raise ExtractionError('File exceeds allowed size or is empty')
    sections=[]
    def add(loc,text):
        if text is None:return
        t=str(text).strip()
        if t and len(sections)<10000:
            sections.append({'location':loc,'text':t[:12000]})
    if mime_type in ('text/plain','text/markdown','text/csv','text/html'):
        try:content=data.decode('utf-8-sig')
        except UnicodeDecodeError:raise ExtractionError('Expected UTF-8 text')
        if mime_type=='text/csv':
            for idx,row in enumerate(csv.reader(io.StringIO(content)),1):
                if idx>5000:raise ExtractionError('Too many rows')
                add('row:'+str(idx),' | '.join(row))
        elif mime_type=='text/html':
            parser=TextParser()
            parser.feed(content)
            add('body', ' '.join(''.join(parser.parts).split()))
        else:
            for i in range(0,len(content),1200):
                add('section:'+str(i//1200+1),content[i:i+1200])
    elif mime_type in (DOCX,PPTX,XLSX):
        with bounded_zip(data,max_uncompressed) as z:
            if mime_type==DOCX:
                try:root=ElementTree.fromstring(z.read('word/document.xml'))
                except (KeyError,ElementTree.ParseError):raise ExtractionError('Malformed DOCX')
                ns='{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
                for idx,p in enumerate(root.iter(ns+'p'),1):
                    add('word/document.xml:p'+str(idx),''.join((t.text or '') for t in p.iter(ns+'t')))
            elif mime_type==PPTX:
                names=sorted((n for n in z.namelist() if re.fullmatch(r'ppt/slides/slide\d+\.xml',n)),
                    key=lambda n:int(re.search(r'slide(\d+)',n).group(1)))
                ns='{http://schemas.openxmlformats.org/drawingml/2006/main}'
                for name in names[:100]:
                    try:root=ElementTree.fromstring(z.read(name))
                    except ElementTree.ParseError:raise ExtractionError('Malformed PPTX')
                    add(name,' '.join(t.text or '' for t in root.iter(ns+'t')))
            else:
                try:
                    from openpyxl import load_workbook
                    wb=load_workbook(io.BytesIO(data),read_only=True,data_only=False)
                except Exception:raise ExtractionError('Malformed XLSX')
                try:
                    for ws in wb.worksheets[:20]:
                        count=0
                        for row in ws.iter_rows():
                            for cell in row:
                                if cell.value is not None:
                                    add(ws.title+'!'+cell.coordinate,cell.value)
                                    count+=1
                                    if count>5000:raise ExtractionError('Too many spreadsheet cells')
                finally:wb.close()
    elif mime_type==PDF:
        try:from pypdf import PdfReader
        except ImportError:raise ExtractionError('PDF parser unavailable; install worker requirements')
        try:
            reader=PdfReader(io.BytesIO(data),strict=True)
            if reader.is_encrypted or len(reader.pages)>100:raise ExtractionError('Encrypted/oversized PDF not allowed')
            for i,page in enumerate(reader.pages):
                add('page:'+str(i+1),page.extract_text() or '')
        except ExtractionError:raise
        except Exception:raise ExtractionError('PDF text extraction failed')
    else:
        raise ExtractionError('Unsupported media type')
    if not sections:raise ExtractionError('No extractable text')
    return {'mimeType':mime_type,'sections':sections,'truncated':len(sections)>=10000}

def main(max_depth: int = 1):
    try:
        payload=json.load(sys.stdin)
        blob=base64.b64decode(payload['base64'],validate=True)
        result=extract_document(blob,payload['mimeType'])
        print(json.dumps({'ok':True,**result},ensure_ascii=False))
    except (KeyError,ValueError,TypeError,ExtractionError) as err:
        print(json.dumps({'ok':False,'error':str(err)},ensure_ascii=False))
        sys.exit(2)

if __name__=='__main__':main()

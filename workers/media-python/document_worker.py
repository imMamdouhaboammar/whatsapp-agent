"""Bounded, no-network document extraction with exact source locations.

Invocation: echo '{"mimeType":"text/csv","base64":"..."}' | python3 document_worker.py
Business permissions and knowledge-store writes are never accepted from document contents.
"""

from __future__ import annotations

import base64
import csv
import io
import json
import re
import sys
from collections.abc import Callable
from html.parser import HTMLParser
from typing import TypedDict
from zipfile import BadZipFile, ZipFile

DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
PDF = "application/pdf"
LIMIT = 15 * 1024 * 1024


class ExtractionSection(TypedDict):
    location: str
    text: str


class ExtractionResult(TypedDict):
    mimeType: str
    sections: list[ExtractionSection]
    truncated: bool


class ExtractionError(ValueError):
    pass


class TextParser(HTMLParser):
    def __init__(self, max_depth: int = 100) -> None:
        super().__init__(convert_charrefs=True)
        self.max_depth = max_depth
        self.ignored = 0
        self.parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        del attrs
        if tag in ("script", "style", "noscript", "template"):
            self.ignored += 1

    def handle_endtag(self, tag: str) -> None:
        if tag in ("script", "style", "noscript", "template") and self.ignored:
            self.ignored -= 1
        if tag in ("p", "div", "h1", "h2", "h3", "li", "tr") and not self.ignored:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if not self.ignored:
            self.parts.append(data)


class _OfficeXmlTextParser(HTMLParser):
    """Safe, non-entity-expanding parser for DOCX/PPTX XML text runs."""

    def __init__(
        self, text_tags: tuple[str, ...], para_tag: str | None = None, max_depth: int = 100
    ) -> None:
        super().__init__(convert_charrefs=True)
        self._max_depth = max_depth
        self._open_tags: list[str] = []
        self._text_tags = text_tags
        self._para_tag = para_tag
        self._in_text = False
        self._current_parts: list[str] = []
        self.paragraphs: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        del attrs
        if len(self._open_tags) >= self._max_depth:
            raise ExtractionError("XML nesting exceeds safe limit")
        self._open_tags.append(tag)
        local = tag.split(":")[-1].lower()
        if local in self._text_tags:
            self._in_text = True
        elif self._para_tag and local == self._para_tag:
            self._current_parts = []

    def handle_endtag(self, tag: str) -> None:
        if not self._open_tags or self._open_tags.pop() != tag:
            raise ExtractionError("Malformed Office XML nesting")
        local = tag.split(":")[-1].lower()
        if local in self._text_tags:
            self._in_text = False
        elif self._para_tag and local == self._para_tag:
            self.paragraphs.append("".join(self._current_parts))
            self._current_parts = []

    def parse(self, xml_text: str) -> None:
        self.feed(xml_text)
        self.close()
        if self._open_tags:
            raise ExtractionError("Malformed Office XML nesting")

    def handle_data(self, data: str) -> None:
        if self._in_text:
            self._current_parts.append(data)


def _decode_safe_xml(raw: bytes, label: str) -> str:
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError as err:
        raise ExtractionError(f"Malformed {label}") from err
    if "<!DOCTYPE" in text.upper() or "<!ENTITY" in text.upper():
        raise ExtractionError(f"Unsafe XML declaration in {label}")
    if "<" not in text or ">" not in text:
        raise ExtractionError(f"Malformed {label}")
    return text


def bounded_zip(data: bytes, limit: int) -> ZipFile:
    try:
        z = ZipFile(io.BytesIO(data))
        info = z.infolist()
        if len(info) > 1000 or sum(item.file_size for item in info) > limit:
            raise ExtractionError("Archive exceeds safe extraction limit")
        for item in info:
            path = item.filename.replace("\\", "/")
            if (
                item.file_size > limit
                or path.startswith("/")
                or ".." in path.split("/")
                or item.flag_bits & 1
            ):
                raise ExtractionError("Unsafe archive member")
    except (BadZipFile, OverflowError) as err:
        raise ExtractionError("Invalid office document archive") from err
    return z


def _extract_docx(z: ZipFile, add: Callable[[str, object], None]) -> None:
    try:
        raw = z.read("word/document.xml")
    except KeyError as err:
        raise ExtractionError("Malformed DOCX") from err
    xml_text = _decode_safe_xml(raw, "DOCX")
    parser = _OfficeXmlTextParser(text_tags=("t",), para_tag="p")
    parser.parse(xml_text)
    for idx, paragraph in enumerate(parser.paragraphs, 1):
        add(f"word/document.xml:p{idx}", paragraph)


def _slide_index(name: str) -> int:
    match = re.search(r"slide(\d+)", name)
    return int(match.group(1)) if match else 0


def _extract_pptx(z: ZipFile, add: Callable[[str, object], None]) -> None:
    names = sorted(
        (n for n in z.namelist() if re.fullmatch(r"ppt/slides/slide\d+\.xml", n)),
        key=_slide_index,
    )
    for name in names[:100]:
        xml_text = _decode_safe_xml(z.read(name), "PPTX")
        parser = _OfficeXmlTextParser(text_tags=("t",))
        parser.parse(xml_text)
        add(name, " ".join(parser._current_parts))


def _extract_xlsx(data: bytes, add: Callable[[str, object], None]) -> None:
    from openpyxl import load_workbook
    from openpyxl.utils.exceptions import InvalidFileException

    try:
        wb = load_workbook(io.BytesIO(data), read_only=True, data_only=False)
    except (OSError, ValueError, KeyError, BadZipFile, InvalidFileException) as err:
        raise ExtractionError("Malformed XLSX") from err
    try:
        for ws in wb.worksheets[:20]:
            count = 0
            for row in ws.iter_rows():
                for cell in row:
                    val = cell.value
                    if val is None:
                        continue
                    add(f"{ws.title}!{cell.coordinate}", val)
                    count += 1
                    if count > 5000:
                        raise ExtractionError("Too many spreadsheet cells")
    finally:
        wb.close()


def extract_document(
    data: bytes | bytearray,
    mime_type: str,
    max_bytes: int = LIMIT,
    max_uncompressed: int = 30 * 1024 * 1024,
) -> ExtractionResult:
    if not isinstance(data, (bytes, bytearray)) or not data or len(data) > max_bytes:
        raise ExtractionError("File exceeds allowed size or is empty")
    raw_bytes = bytes(data)
    sections: list[ExtractionSection] = []

    def add(loc: str, text: object) -> None:
        if text is None:
            return
        t = str(text).strip()
        if t and len(sections) < 10000:
            sections.append({"location": loc, "text": t[:12000]})

    if mime_type in ("text/plain", "text/markdown", "text/csv", "text/html"):
        try:
            content = raw_bytes.decode("utf-8-sig")
        except UnicodeDecodeError as err:
            raise ExtractionError("Expected UTF-8 text") from err
        if mime_type == "text/csv":
            for idx, row in enumerate(csv.reader(io.StringIO(content)), 1):
                if idx > 5000:
                    raise ExtractionError("Too many rows")
                add(f"row:{idx}", " | ".join(row))
        elif mime_type == "text/html":
            parser = TextParser()
            parser.feed(content)
            add("body", " ".join("".join(parser.parts).split()))
        else:
            for i in range(0, len(content), 1200):
                add(f"section:{i // 1200 + 1}", content[i : i + 1200])
    elif mime_type in (DOCX, PPTX, XLSX):
        if mime_type == XLSX:
            _extract_xlsx(raw_bytes, add)
        else:
            with bounded_zip(raw_bytes, max_uncompressed) as z:
                if mime_type == DOCX:
                    _extract_docx(z, add)
                else:
                    _extract_pptx(z, add)
    elif mime_type == PDF:
        try:
            from pypdf import PdfReader
            from pypdf.errors import PyPdfError
        except ImportError as err:
            raise ExtractionError("PDF parser unavailable; install worker requirements") from err
        try:
            reader = PdfReader(io.BytesIO(raw_bytes), strict=True)
            if reader.is_encrypted or len(reader.pages) > 100:
                raise ExtractionError("Encrypted/oversized PDF not allowed")
            for i, page in enumerate(reader.pages):
                add(f"page:{i + 1}", page.extract_text() or "")
        except ExtractionError:
            raise
        except (PyPdfError, OSError, ValueError, KeyError) as err:
            raise ExtractionError("PDF text extraction failed") from err
    else:
        raise ExtractionError("Unsupported media type")
    if not sections:
        raise ExtractionError("No extractable text")
    return {"mimeType": mime_type, "sections": sections, "truncated": len(sections) >= 10000}


def main(max_depth: int = 1) -> None:
    del max_depth
    try:
        payload = json.load(sys.stdin)
        blob = base64.b64decode(payload["base64"], validate=True)
        result = extract_document(blob, payload["mimeType"])
        print(json.dumps({"ok": True, **result}, ensure_ascii=False))
    except (KeyError, ValueError, TypeError, ExtractionError) as err:
        print(json.dumps({"ok": False, "error": str(err)}, ensure_ascii=False))
        sys.exit(2)


if __name__ == "__main__":
    main()

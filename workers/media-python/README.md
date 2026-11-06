# Bounded document extraction worker

Use `python3 -m pip install -r workers/media-python/requirements.txt` in a dedicated project virtual environment. Start extraction via the TypeScript `DocumentExtractionService` (it invokes a fixed Python script with `shell: false` and JSON on stdin). PDF extraction requires `pypdf`; scanned PDFs without a text layer require a separate consented OCR service and are not silently guessed. The worker does not execute document macros/scripts or promote customer messages into brand knowledge.

Input: JSON `{ "mimeType": "text/csv", "base64": "..." }` on stdin. Output: JSON `{ "ok": true, "sections": [{"location": "row:2", "text": "..."}] }`. Bounds: 15 MiB raw, 30 MiB uncompressed Office archives, 100 PDF pages, source-cited sections. It does not log the document content or make HTTP requests.

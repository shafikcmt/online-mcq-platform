"""Safe handling of uploaded PDF documents (the exam routine, notice PDFs).

An admin uploads a PDF that every student can then open. Before it is stored it is checked:

- a size limit (``DOCUMENT_MAX_BYTES``);
- the file really is a PDF (starts with ``%PDF-``, has an end marker), whatever its name says;
- it carries no active content: PDF JavaScript, launch actions, embedded files, or form
  submission actions, which a viewer may run or follow.

The stored name is random and never taken from the upload. Files are served only through the API
(``Content-Type: application/pdf``, ``nosniff``, a restrictive CSP), never from a guessable path.
"""

import hashlib
import logging
import uuid
from dataclasses import dataclass

from django.conf import settings
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.db import transaction
from django.http import FileResponse, HttpResponseNotModified

logger = logging.getLogger(__name__)

# Tokens of active content. A viewer may run or follow what these introduce.
ACTIVE_CONTENT_TOKENS = (
    b"/JavaScript",
    b"/JS",
    b"/Launch",
    b"/EmbeddedFile",
    b"/SubmitForm",
    b"/ImportData",
    b"/GoToR",
    b"/RichMedia",
)
END_MARKER_WINDOW = 2048


class DocumentError(Exception):
    """The file cannot be accepted. ``code`` is stable (the panel translates it)."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class CheckedPdf:
    data: bytes
    size: int
    sha256: str


def validate_pdf(upload) -> CheckedPdf:
    """Read and check an uploaded file. Raises ``DocumentError``."""
    limit = settings.DOCUMENT_MAX_BYTES
    if upload is None:
        raise DocumentError("file_missing", "Choose a PDF file.")
    if upload.size == 0:
        raise DocumentError("file_empty", "The file is empty.")
    if upload.size > limit:
        raise DocumentError(
            "file_too_large", f"The file is too large (maximum {limit // (1024 * 1024)} MB)."
        )
    data = upload.read(limit + 1)
    if len(data) > limit:
        raise DocumentError(
            "file_too_large", f"The file is too large (maximum {limit // (1024 * 1024)} MB)."
        )
    if not data.startswith(b"%PDF-") or b"%%EOF" not in data[-END_MARKER_WINDOW:]:
        raise DocumentError("file_not_pdf", "This is not a valid PDF file.")
    for token in ACTIVE_CONTENT_TOKENS:
        if token in data:
            raise DocumentError(
                "pdf_active_content",
                "This PDF contains scripts or actions and cannot be accepted. "
                "Export it again as a plain PDF.",
            )
    return CheckedPdf(data=data, size=len(data), sha256=hashlib.sha256(data).hexdigest())


def store_pdf(checked: CheckedPdf) -> str:
    """Save under a random name and return the stored name."""
    return default_storage.save(f"documents/{uuid.uuid4().hex}.pdf", ContentFile(checked.data))


def delete_after_commit(name: str) -> None:
    """Remove a stored file once the surrounding transaction commits (never before: a rolled
    back change must keep its file)."""
    if not name:
        return

    def _delete():
        try:
            default_storage.delete(name)
        except Exception:  # noqa: BLE001 - a missing file must not break the request
            logger.warning("Could not delete document %s", name)

    transaction.on_commit(_delete)


def pdf_response(request, field_file, sha256: str, filename: str):
    """Serve a stored PDF: a fixed ``application/pdf`` type, ``nosniff`` and a CSP that allows
    nothing. The SHA-256 is the ``ETag``, so repeat downloads are cheap and a replaced file is
    never served stale. ``filename`` is ours (never the uploader's)."""
    etag = f'"{sha256}"'
    if request.META.get("HTTP_IF_NONE_MATCH") == etag:
        response = HttpResponseNotModified()
        response["ETag"] = etag
        return response
    response = FileResponse(field_file.open("rb"), content_type="application/pdf")
    response["Content-Disposition"] = f'inline; filename="{filename}"'
    response["Content-Security-Policy"] = "default-src 'none'"
    response["X-Content-Type-Options"] = "nosniff"
    response["Cache-Control"] = "public, max-age=300"
    response["ETag"] = etag
    return response

"""Utilities for file upload handling."""
import uuid
from pathlib import Path

from fastapi import HTTPException, UploadFile

ALLOWED_EVENT_LOG_EXTS = {".xes", ".csv"}
ALLOWED_GRAPH_EXTS = {
    ".xes", ".yaml", ".yml", ".txt", ".csv",
    ".net", ".gml", ".gexf", ".graphml",
    ".json", ".pajek",
}
ALLOWED_MODEL_EXTS = {".pnml", ".bpmn"}

# 4 MB chunks — keeps memory flat regardless of file size
_CHUNK_BYTES = 4 * 1024 * 1024


def save_upload(
    file: UploadFile,
    upload_dir: Path,
    allowed_exts: set,
) -> tuple:
    """
    Stream an UploadFile to upload_dir in fixed-size chunks so that arbitrarily
    large files (hundreds of MB) never fully reside in memory.

    Args:
        file: The uploaded file object.
        upload_dir: Directory to save into (created if absent).
        allowed_exts: Set of permitted extensions (e.g. {".xes", ".csv"}).

    Returns:
        (file_id, saved_path) where file_id is a hex UUID string.

    Raises:
        HTTPException 422: If the file extension is not in allowed_exts.
        HTTPException 500: On unexpected I/O errors.
    """
    suffix = Path(file.filename).suffix.lower()
    if suffix not in allowed_exts:
        raise HTTPException(
            status_code=422,
            detail=(
                f"Unsupported file extension '{suffix}'. "
                f"Allowed: {sorted(allowed_exts)}"
            ),
        )

    file_id = uuid.uuid4().hex
    upload_dir.mkdir(parents=True, exist_ok=True)
    dest = upload_dir / f"{file_id}{suffix}"

    try:
        with open(dest, "wb") as out:
            while True:
                chunk = file.file.read(_CHUNK_BYTES)
                if not chunk:
                    break
                out.write(chunk)
    except OSError as exc:
        raise HTTPException(
            status_code=500, detail=f"Failed to save file: {exc}")
    finally:
        file.file.close()

    return file_id, dest


def get_upload_path(file_id: str, upload_dir: Path) -> Path:
    """
    Resolve a file_id to its saved path.

    Args:
        file_id: The hex UUID string returned by save_upload.
        upload_dir: Directory to search in.

    Returns:
        Path to the saved file.

    Raises:
        HTTPException 404: If no file with the given file_id exists.
    """
    matches = list(upload_dir.glob(f"{file_id}.*"))
    # Exclude JSON sidecar files created by graph_upload router
    matches = [m for m in matches if m.suffix != ".json"]
    if not matches:
        raise HTTPException(
            status_code=404,
            detail=f"File '{file_id}' not found. Please upload it first.",
        )
    return matches[0]

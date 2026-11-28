"""
R bridge for process discovery using bupaR.

Requires R with packages: bupaR, processmapR, heuristicsmineR, petrinetR, jsonlite.
Install via:
    install.packages(c("bupaR", "processmapR", "heuristicsmineR", "petrinetR", "jsonlite"),
                     repos = "https://cloud.r-project.org")

The bridge calls the discover.R script as a subprocess so that R and Python
environments remain fully isolated. Falls back gracefully if R is not available.
"""
import json
import logging
import subprocess
import tempfile
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

_SCRIPT_PATH = Path(__file__).parent / "scripts" / "discover.R"
_RENDER_SCRIPT_PATH = Path(__file__).parent / \
    "scripts" / "render_process_map.R"


def discover_with_r(
    csv_path: Path,
    algorithm: str = "inductive",
    case_id: str = "case:concept:name",
    activity: str = "concept:name",
    timestamp: str = "time:timestamp",
    output_format: str = "dfg",
    graph_id: Optional[str] = None,
) -> dict:
    """
    Discover a process model using the R bupaR library.

    Returns a JSON graph dict (DFG format) compatible with the DFGGraph schema.

    Args:
        csv_path: Path to the CSV event log.
        algorithm: "dfg" | "inductive" | "heuristics".
        case_id: Column name for case identifier.
        activity: Column name for activity names.
        timestamp: Column name for timestamps.
        output_format: Currently only "dfg" is supported by the R script.
        graph_id: Optional ID to embed in the returned graph JSON.

    Raises:
        RuntimeError: If R or the bupaR packages are unavailable, or the
                      R process exits with a non-zero return code.
    """
    if not _SCRIPT_PATH.exists():
        raise RuntimeError(f"R discovery script not found at: {_SCRIPT_PATH}")

    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as tmp:
        out_path = tmp.name

    r_cmd = [
        "Rscript",
        str(_SCRIPT_PATH),
        "--csv", str(csv_path),
        "--case_id", case_id,
        "--activity", activity,
        "--timestamp", timestamp,
        "--algorithm", algorithm,
        "--output_format", output_format,
        "--out", out_path,
    ]
    if graph_id:
        r_cmd += ["--graph_id", graph_id]

    logger.info("Running R discovery: %s", " ".join(r_cmd))

    try:
        result = subprocess.run(
            r_cmd, capture_output=True, text=True, timeout=120)
    except FileNotFoundError:
        raise RuntimeError(
            "Rscript not found in PATH. "
            "Please install R (https://www.r-project.org/) and ensure it is on your PATH."
        )
    except subprocess.TimeoutExpired:
        raise RuntimeError("R process timed out after 120 seconds.")

    if result.returncode != 0:
        raise RuntimeError(
            f"R process exited with code {result.returncode}.\n"
            f"stderr:\n{result.stderr}\n"
            f"stdout:\n{result.stdout}"
        )

    logger.debug("R stdout: %s", result.stdout)

    try:
        with open(out_path) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"Failed to parse R output JSON: {exc}")
    finally:
        try:
            Path(out_path).unlink(missing_ok=True)
        except Exception:
            pass


def render_process_map_png(
    csv_path: Path,
    case_id: str = "case:concept:name",
    activity: str = "concept:name",
    timestamp: str = "time:timestamp",
    map_type: str = "frequency",
) -> str:
    """
    Render a processmapR process_map to a PNG and return it as a base64 string.

    Args:
        csv_path: Path to the CSV event log.
        case_id: Column name for case identifier.
        activity: Column name for activity names.
        timestamp: Column name for timestamps.
        map_type: "frequency" or "performance".

    Returns:
        Base64-encoded PNG string (no data-URI prefix).

    Raises:
        RuntimeError: If R is unavailable, required packages are missing,
                      or the R subprocess exits with a non-zero return code.
    """
    if not _RENDER_SCRIPT_PATH.exists():
        raise RuntimeError(
            f"R render script not found at: {_RENDER_SCRIPT_PATH}")

    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
        out_path = tmp.name

    r_cmd = [
        "Rscript",
        str(_RENDER_SCRIPT_PATH),
        "--csv",       str(csv_path),
        "--out",       out_path,
        "--case_id",   case_id,
        "--activity",  activity,
        "--timestamp", timestamp,
        "--type",      map_type,
    ]

    logger.info("Running R process_map render: %s", " ".join(r_cmd))

    try:
        result = subprocess.run(
            r_cmd, capture_output=True, text=True, timeout=120)
    except FileNotFoundError:
        raise RuntimeError(
            "Rscript not found in PATH. "
            "Please install R (https://www.r-project.org/) and ensure it is on your PATH."
        )
    except subprocess.TimeoutExpired:
        raise RuntimeError("R render process timed out after 120 seconds.")

    if result.returncode != 0:
        raise RuntimeError(
            f"R render process exited with code {result.returncode}.\n"
            f"stderr:\n{result.stderr}\n"
            f"stdout:\n{result.stdout}"
        )

    logger.debug("R render stdout: %s", result.stdout)

    try:
        import base64
        with open(out_path, "rb") as f:
            return base64.b64encode(f.read()).decode("utf-8")
    except (FileNotFoundError, OSError) as exc:
        raise RuntimeError(f"Failed to read rendered PNG: {exc}")
    finally:
        try:
            Path(out_path).unlink(missing_ok=True)
        except Exception:
            pass


def r_is_available() -> bool:
    """Return True if Rscript is available on PATH."""
    try:
        result = subprocess.run(
            ["Rscript", "--version"],
            capture_output=True, text=True, timeout=10,
        )
        return result.returncode == 0
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False

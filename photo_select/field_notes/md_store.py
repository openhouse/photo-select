from pathlib import Path


def get(path: Path) -> str:
    """Return file contents or empty string if the file is missing."""
    try:
        return path.read_text()
    except FileNotFoundError:
        return ""


def atomic_write(path: Path, new_text: str) -> None:
    """Write text to a temp file then atomically replace the target."""
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(new_text)
    temp.replace(path)

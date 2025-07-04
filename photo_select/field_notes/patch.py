import difflib
import subprocess
import tempfile
from pathlib import Path


def generate(old: str, new: str) -> str:
    """Return a unified diff between old and new."""
    diff = difflib.unified_diff(
        old.splitlines(True),
        new.splitlines(True),
        fromfile="a/field-notes.md",
        tofile="b/field-notes.md",
    )
    return "".join(diff)


def apply(old: str, diff: str) -> str:
    """Apply a unified diff to ``old`` and return the new text.

    Falls back to the pure Python ``patch-ng`` library when the ``patch``
    binary is unavailable.
    """
    with tempfile.TemporaryDirectory() as td:
        old_path = Path(td) / "field-notes.md"
        patch_path = Path(td) / "patch.diff"
        old_path.write_text(old)
        patch_path.write_text(diff)
        try:
            subprocess.run(
                ["patch", old_path.name, patch_path.name],
                cwd=td,
                capture_output=True,
                text=True,
                check=True,
            )
        except FileNotFoundError:
            from patch_ng import fromfile
            patchset = fromfile(str(patch_path))
            if not patchset or not patchset.apply(root=td):
                raise RuntimeError("patch failed")
        except subprocess.CalledProcessError as exc:
            raise RuntimeError(exc.stderr.strip() or "patch failed")
        return old_path.read_text()

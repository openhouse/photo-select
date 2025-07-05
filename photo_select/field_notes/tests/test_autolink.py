from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
from photo_select.field_notes.writer import FieldNotesWriter


def test_autolink_filenames(tmp_path):
    img = tmp_path / "DSCF1.JPG"
    img.write_text("")
    md = "See [DSCF1.JPG]"
    linked = FieldNotesWriter.autolink_filenames(md, tmp_path)
    assert "[DSCF1.JPG](./DSCF1.JPG)" in linked

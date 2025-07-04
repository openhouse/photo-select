from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
from photo_select.field_notes.writer import FieldNotesWriter, PatchResult
from photo_select.field_notes import patch


def test_writer_happy(tmp_path):
    md = tmp_path / "notes.md"
    md.write_text("hello\n")
    writer = FieldNotesWriter(md, level="001")
    diff = patch.generate("hello\n", "hello world\n")
    result = writer.maybe_apply_diff(diff)
    assert isinstance(result, PatchResult) and result.applied
    text = md.read_text()
    assert "hello world" in text
    assert "<!-- updated:" in text


def test_noop_diff(tmp_path):
    md = tmp_path / "notes.md"
    md.write_text("same\n")
    writer = FieldNotesWriter(md, level="001")
    diff = patch.generate("same\n", "same\n")
    result = writer.maybe_apply_diff(diff)
    assert result.applied is False
    assert md.read_text() == "same\n"


def test_broken_diff(tmp_path):
    md = tmp_path / "notes.md"
    md.write_text("base\n")
    writer = FieldNotesWriter(md, level="001")
    diff = patch.generate("other\n", "changed\n")
    result = writer.maybe_apply_diff(diff)
    assert result.applied is False
    assert md.read_text() == "base\n"


def test_autolink(tmp_path):
    md = tmp_path / "notes.md"
    (tmp_path / "DSCF0001.jpg").write_text("\n")
    md.write_text("Look at [DSCF0001.jpg]\n")
    writer = FieldNotesWriter(md, level="001")
    diff = patch.generate(writer.md, writer.md + "More info\n")
    writer.maybe_apply_diff(diff)
    assert "[DSCF0001.jpg](./DSCF0001.jpg)" in md.read_text()

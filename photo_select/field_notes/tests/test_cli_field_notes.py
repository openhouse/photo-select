import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
from photo_select.cli import main


def test_cli_integration(tmp_path):
    level = tmp_path / "_level-001"
    level.mkdir()
    img = level / "DSCF0001.jpg"
    img.write_text("")
    notes = level / "field-notes.md"

    def fake_llm(payload: str) -> str:
        data = json.loads(payload)
        if "FIELD_NOTES_DIFF" in data:
            return json.dumps({"field_notes_md": data["FIELD_NOTES_PREVIEW"] + "Look [DSCF0001.jpg]\n"})
        else:
            from photo_select.field_notes import patch
            diff = patch.generate("", "Look [DSCF0001.jpg]\n")
            return json.dumps({"field_notes_diff": diff})

    main(["--field-notes", str(notes)], llm=fake_llm)
    text = notes.read_text()
    assert "Look" in text
    assert "[DSCF0001.jpg](./DSCF0001.jpg)" in text

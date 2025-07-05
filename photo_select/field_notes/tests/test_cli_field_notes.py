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

    calls = []

    def fake_llm(payload: str) -> str:
        calls.append(json.loads(payload))
        if "FIELD_NOTES_DIFF" in calls[-1]:
            return json.dumps({"field_notes_md": calls[-1]["FIELD_NOTES_PREVIEW"] + "Look [DSCF0001.jpg]\n"})
        else:
            from photo_select.field_notes import patch
            diff = patch.generate("", "Look [DSCF0001.jpg]\n")
            return json.dumps({"field_notes_diff": diff})

    main(["--field-notes", str(notes)], llm=fake_llm)
    text = notes.read_text()
    assert len(calls) == 2
    assert "FIELD_NOTES_DIFF" in calls[1]
    assert "Look" in text
    assert "[DSCF0001.jpg](./DSCF0001.jpg)" in text

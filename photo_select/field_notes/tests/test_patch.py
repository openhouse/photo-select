import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
from photo_select.field_notes import patch


def test_round_trip():
    old = "a\n"
    new = "b\n"
    diff = patch.generate(old, new)
    assert patch.apply(old, diff) == new

import json
from pathlib import Path

import pytest

from preferences import Preferences, PreferenceStore


def test_preferences_round_trip_as_json(tmp_path: Path) -> None:
    path = tmp_path / "settings.json"
    store = PreferenceStore(path)

    store.save(Preferences(geoip_auto_update=False, geoip_db_only=True))

    assert store.load().geoip_auto_update is False
    assert store.load().geoip_db_only is True
    assert json.loads(path.read_text()) == {"geoip_auto_update": False, "geoip_db_only": True}
    assert path.stat().st_mode & 0o777 == 0o600


@pytest.mark.parametrize("contents", ["not-json", "[]", "null", "false", '"text"'])
def test_invalid_preferences_fall_back_to_defaults(tmp_path: Path, contents: str) -> None:
    path = tmp_path / "settings.json"
    path.write_text(contents)

    assert PreferenceStore(path).load() == Preferences()


def test_existing_preferences_without_privacy_setting_still_load(tmp_path):
    path = tmp_path / "settings.json"
    path.write_text('{"geoip_auto_update": false}')
    assert PreferenceStore(path).load() == Preferences(geoip_auto_update=False, geoip_db_only=False)


def test_preference_flags_require_booleans(tmp_path):
    path = tmp_path / "settings.json"
    path.write_text('{"geoip_auto_update": "false", "geoip_db_only": "true"}')
    assert PreferenceStore(path).load() == Preferences()

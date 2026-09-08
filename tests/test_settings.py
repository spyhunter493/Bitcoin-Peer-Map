from pathlib import Path

import pytest

from settings import AppSettings, ConfigurationError


def valid_environment() -> dict[str, str]:
    return {
        "BITCOIN_RPC_HOST": "bitcoin.example",
        "BITCOIN_RPC_USER": "bpm",
        "BITCOIN_RPC_PASSWORD": "secret",
    }


def test_settings_load_valid_environment() -> None:
    settings = AppSettings.from_env(valid_environment())

    assert settings.rpc_url == "http://bitcoin.example:8332"
    assert settings.listen_port == 58333
    assert settings.geoip_enabled is True
    assert settings.geoip_auto_update_override is None
    assert settings.build_revision == "unknown"


def test_settings_load_build_revision() -> None:
    environment = valid_environment()
    environment["BPM_BUILD_REVISION"] = "ABCDEF0123456789"

    assert AppSettings.from_env(environment).build_revision == "abcdef0123456789"


def test_settings_load_build_revision_file(tmp_path: Path) -> None:
    revision_file = tmp_path / "build-revision"
    revision_file.write_text("1234567890ABCDEF\n")
    environment = valid_environment()
    environment["BPM_BUILD_REVISION_FILE"] = str(revision_file)

    assert AppSettings.from_env(environment).build_revision == "1234567890abcdef"


def test_settings_load_build_revision_file_when_env_is_blank(tmp_path: Path) -> None:
    revision_file = tmp_path / "build-revision"
    revision_file.write_text("1234567890abcdef\n")
    environment = valid_environment()
    environment["BPM_BUILD_REVISION"] = ""
    environment["BPM_BUILD_REVISION_FILE"] = str(revision_file)

    assert AppSettings.from_env(environment).build_revision == "1234567890abcdef"


def test_settings_prefer_build_revision_env_over_file(tmp_path: Path) -> None:
    revision_file = tmp_path / "build-revision"
    revision_file.write_text("1234567890abcdef\n")
    environment = valid_environment()
    environment["BPM_BUILD_REVISION"] = "abcdef0123456789"
    environment["BPM_BUILD_REVISION_FILE"] = str(revision_file)

    assert AppSettings.from_env(environment).build_revision == "abcdef0123456789"


def test_settings_reject_invalid_build_revision_file(tmp_path: Path) -> None:
    revision_file = tmp_path / "build-revision"
    revision_file.write_text("not-a-commit\n")
    environment = valid_environment()
    environment["BPM_BUILD_REVISION_FILE"] = str(revision_file)

    with pytest.raises(ConfigurationError, match="BPM_BUILD_REVISION_FILE"):
        AppSettings.from_env(environment)


def test_settings_support_password_file(tmp_path: Path) -> None:
    password_file = tmp_path / "rpc-password"
    password_file.write_text("from-file\n")
    environment = valid_environment()
    environment.pop("BITCOIN_RPC_PASSWORD")
    environment["BITCOIN_RPC_PASSWORD_FILE"] = str(password_file)

    settings = AppSettings.from_env(environment)

    assert settings.rpc_password == "from-file"
    assert settings.rpc_password_file_configured is True


@pytest.mark.parametrize(
    ("key", "value", "message"),
    [
        ("BITCOIN_RPC_PORT", "abc", "must be an integer"),
        ("BITCOIN_NETWORK", "invalid", "must be main"),
        ("BITCOIN_RPC_SCHEME", "ftp", "must be http or https"),
        ("BPM_GEOIP_ENABLED", "yes", "must be true or false"),
        ("BPM_LISTEN_PORT", "80", "must be between 1024"),
        ("BPM_BUILD_REVISION", "not-a-commit", "must be a 7-40 character"),
    ],
)
def test_settings_reject_invalid_values(key: str, value: str, message: str) -> None:
    environment = valid_environment()
    environment[key] = value

    with pytest.raises(ConfigurationError, match=message):
        AppSettings.from_env(environment)


def test_settings_require_exactly_one_password_source(tmp_path: Path) -> None:
    password_file = tmp_path / "rpc-password"
    password_file.write_text("from-file")
    environment = valid_environment()
    environment["BITCOIN_RPC_PASSWORD_FILE"] = str(password_file)

    with pytest.raises(ConfigurationError, match="set only one"):
        AppSettings.from_env(environment)

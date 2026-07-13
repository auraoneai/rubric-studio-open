from rubric_studio import __version__
from rubric_studio.cli import main


def test_version(capsys):
    assert main.__module__ == "rubric_studio.cli"
    assert __version__ == "0.0.3"


def test_distribution_guidance(monkeypatch, capsys):
    monkeypatch.setattr("sys.argv", ["rubric"])
    assert main() == 0
    output = capsys.readouterr().out
    assert "https://rubric-studio.auraone.ai" in output
    assert "@auraone/rubric-studio@0.2.1" in output

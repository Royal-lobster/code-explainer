"""Checks that the TTS extra resolves to a working engine stack on each platform."""

from pathlib import Path

import pytest
from packaging.requirements import Requirement

tomllib = pytest.importorskip("tomllib")

PYPROJECT = Path(__file__).resolve().parent.parent / "pyproject.toml"

INTEL_MAC = {"sys_platform": "darwin", "platform_machine": "x86_64"}
APPLE_SILICON = {"sys_platform": "darwin", "platform_machine": "arm64"}
LINUX = {"sys_platform": "linux", "platform_machine": "x86_64"}


def tts_requirements(env: dict[str, str]) -> dict[str, Requirement]:
    """Return the ``tts`` extra's requirements that apply on a platform.

    Args:
        env: Marker variables overriding the running interpreter's.

    Returns:
        Applicable requirements keyed by project name.
    """
    extras = tomllib.loads(PYPROJECT.read_text())["project"]["optional-dependencies"]
    reqs = [Requirement(line) for line in extras["tts"]]
    return {r.name: r for r in reqs if r.marker is None or r.marker.evaluate(env)}


def test_intel_mac_pins_libraries_compatible_with_torch_2_2() -> None:
    """Intel Macs get torch 2.2, so NumPy 2 and transformers 5 must be excluded."""
    reqs = tts_requirements(INTEL_MAC)
    assert "kokoro" in reqs
    assert not reqs["numpy"].specifier.contains("2.0.0")
    assert reqs["numpy"].specifier.contains("1.26.4")
    assert not reqs["transformers"].specifier.contains("5.0.0")
    assert reqs["transformers"].specifier.contains("4.57.6")


@pytest.mark.parametrize("env", [APPLE_SILICON, LINUX], ids=["apple-silicon", "linux"])
def test_other_platforms_are_not_capped(env: dict[str, str]) -> None:
    """The Intel-only caps must not hold back platforms with current torch wheels."""
    reqs = tts_requirements(env)
    assert "numpy" not in reqs
    assert "transformers" not in reqs

"""Smoke test that the package is importable."""

import codeexplainer


def test_package_imports() -> None:
    """The runtime package is importable from the scripts directory."""
    assert codeexplainer.__doc__

"""CLI entry point for the PyPI distribution guide."""

from __future__ import annotations

import argparse

from . import __version__


def main() -> int:
    parser = argparse.ArgumentParser(
        prog="rubric",
        description="Rubric Studio Open PyPI distribution guide",
        epilog=(
            "Install the full CLI with: "
            "npm install --global @auraone/rubric-studio@0.2.1"
        ),
    )
    parser.add_argument("--version", action="store_true", help="print version and exit")
    args = parser.parse_args()
    if args.version:
        print(__version__)
        return 0
    print("Browser editor: https://rubric-studio.auraone.ai")
    print(
        "Desktop release: "
        "https://github.com/auraoneai/rubric-studio-open/releases/tag/v0.2.0"
    )
    print("Full CLI: npm install --global @auraone/rubric-studio@0.2.1")
    parser.print_help()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

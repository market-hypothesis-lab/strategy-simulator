from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

from .engine import Rule, evaluate
from .workflow import preview_signal_workflow


def _evaluate_case(argv: list[str]) -> None:
    parser = argparse.ArgumentParser(description="Evaluate a synthetic strategy case")
    parser.add_argument("strategy", type=Path)
    parser.add_argument("case", type=Path)
    args = parser.parse_args(argv)

    strategy = json.loads(args.strategy.read_text(encoding="utf-8"))
    case = json.loads(args.case.read_text(encoding="utf-8"))
    rules = [Rule(**rule) for rule in strategy["rules"]]
    result = evaluate(case["features"], rules, strategy["minimum_score"])
    print(json.dumps(result.as_dict(), indent=2, sort_keys=True))


def _preview_signals(argv: list[str]) -> None:
    parser = argparse.ArgumentParser(
        description="Validate a fictional signal lifecycle and preview Discord JSON"
    )
    parser.add_argument("events", type=Path)
    args = parser.parse_args(argv)
    document = json.loads(args.events.read_text(encoding="utf-8"))
    preview = preview_signal_workflow(document)
    print(json.dumps(preview, ensure_ascii=False, indent=2, sort_keys=True))


def main(argv: list[str] | None = None) -> None:
    arguments = list(sys.argv[1:] if argv is None else argv)
    if arguments and arguments[0] == "signal-preview":
        _preview_signals(arguments[1:])
        return
    _evaluate_case(arguments)


if __name__ == "__main__":
    main()

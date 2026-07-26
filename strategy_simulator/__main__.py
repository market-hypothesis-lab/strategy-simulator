from __future__ import annotations

import argparse
import json
from pathlib import Path

from .engine import Rule, evaluate


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate a synthetic strategy case")
    parser.add_argument("strategy", type=Path)
    parser.add_argument("case", type=Path)
    args = parser.parse_args()

    strategy = json.loads(args.strategy.read_text(encoding="utf-8"))
    case = json.loads(args.case.read_text(encoding="utf-8"))
    rules = [Rule(**rule) for rule in strategy["rules"]]
    result = evaluate(case["features"], rules, strategy["minimum_score"])
    print(json.dumps(result.as_dict(), indent=2, sort_keys=True))


if __name__ == "__main__":
    main()


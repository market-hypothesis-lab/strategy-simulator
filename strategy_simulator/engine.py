from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Iterable, Mapping, Sequence


_OPERATORS = {
    ">": lambda value, threshold: value > threshold,
    ">=": lambda value, threshold: value >= threshold,
    "<": lambda value, threshold: value < threshold,
    "<=": lambda value, threshold: value <= threshold,
    "==": lambda value, threshold: value == threshold,
}


@dataclass(frozen=True)
class Rule:
    metric: str
    operator: str
    threshold: str
    points: int

    def __post_init__(self) -> None:
        if not self.metric:
            raise ValueError("metric must not be empty")
        if self.operator not in _OPERATORS:
            raise ValueError(f"unsupported operator: {self.operator}")
        if self.points <= 0:
            raise ValueError("points must be positive")
        threshold = Decimal(self.threshold)
        if not threshold.is_finite():
            raise ValueError("threshold must be finite")


@dataclass(frozen=True)
class Evaluation:
    score: int
    maximum_score: int
    minimum_score: int
    selected: bool
    matched_metrics: tuple[str, ...]

    def as_dict(self) -> dict[str, object]:
        return {
            "score": self.score,
            "maximum_score": self.maximum_score,
            "minimum_score": self.minimum_score,
            "selected": self.selected,
            "matched_metrics": list(self.matched_metrics),
        }


def _decimal(value: object, name: str) -> Decimal:
    parsed = Decimal(str(value))
    if not parsed.is_finite():
        raise ValueError(f"{name} must be finite")
    return parsed


def evaluate(
    features: Mapping[str, object],
    rules: Sequence[Rule],
    minimum_score: int,
) -> Evaluation:
    if minimum_score < 0:
        raise ValueError("minimum_score must not be negative")

    score = 0
    matched: list[str] = []
    for rule in rules:
        if rule.metric not in features:
            continue
        observed = _decimal(features[rule.metric], rule.metric)
        threshold = Decimal(rule.threshold)
        if _OPERATORS[rule.operator](observed, threshold):
            score += rule.points
            matched.append(rule.metric)

    maximum = sum(rule.points for rule in rules)
    if minimum_score > maximum:
        raise ValueError("minimum_score exceeds maximum score")

    return Evaluation(
        score=score,
        maximum_score=maximum,
        minimum_score=minimum_score,
        selected=score >= minimum_score,
        matched_metrics=tuple(matched),
    )


def simulate_equity(
    returns: Iterable[object],
    selected: Iterable[bool],
    *,
    initial_equity: object = "1",
    exposure_fraction: object = "0.10",
    round_trip_cost_fraction: object = "0",
) -> tuple[Decimal, ...]:
    observations = list(returns)
    decisions = list(selected)
    if len(observations) != len(decisions):
        raise ValueError("returns and selected must have the same length")

    equity = _decimal(initial_equity, "initial_equity")
    exposure = _decimal(exposure_fraction, "exposure_fraction")
    cost = _decimal(round_trip_cost_fraction, "round_trip_cost_fraction")
    if equity <= 0:
        raise ValueError("initial_equity must be positive")
    if not Decimal("0") <= exposure <= Decimal("1"):
        raise ValueError("exposure_fraction must be between zero and one")
    if cost < 0:
        raise ValueError("round_trip_cost_fraction must not be negative")

    path = [equity]
    for observed_return, is_selected in zip(observations, decisions):
        if is_selected:
            period_return = exposure * _decimal(observed_return, "return") - cost
            equity *= Decimal("1") + period_return
        path.append(equity)

    return tuple(path)


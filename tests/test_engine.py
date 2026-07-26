from decimal import Decimal
import unittest

from strategy_simulator import Rule, evaluate, simulate_equity


class EngineTests(unittest.TestCase):
    def test_evaluate_matches_synthetic_rules(self) -> None:
        rules = [
            Rule("feature_alpha", ">=", "10", 2),
            Rule("feature_beta", "<", "5", 1),
        ]

        result = evaluate(
            {"feature_alpha": "12.5", "feature_beta": "3"},
            rules,
            minimum_score=2,
        )

        self.assertEqual(result.score, 3)
        self.assertTrue(result.selected)
        self.assertEqual(result.matched_metrics, ("feature_alpha", "feature_beta"))

    def test_missing_feature_awards_no_points(self) -> None:
        result = evaluate(
            {},
            [Rule("feature_alpha", ">=", "10", 2)],
            minimum_score=1,
        )
        self.assertFalse(result.selected)

    def test_nonfinite_values_are_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "must be finite"):
            evaluate(
                {"feature_alpha": "NaN"},
                [Rule("feature_alpha", ">=", "10", 2)],
                minimum_score=1,
            )

    def test_simulate_equity_is_deterministic(self) -> None:
        path = simulate_equity(
            ["0.10", "-0.05"],
            [True, True],
            exposure_fraction="0.50",
            round_trip_cost_fraction="0.001",
        )
        self.assertEqual(
            path,
            (
                Decimal("1"),
                Decimal("1.0490"),
                Decimal("1.02172600"),
            ),
        )

    def test_simulate_equity_requires_aligned_inputs(self) -> None:
        with self.assertRaisesRegex(ValueError, "same length"):
            simulate_equity(["0.10"], [])


if __name__ == "__main__":
    unittest.main()

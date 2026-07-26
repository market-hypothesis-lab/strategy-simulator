import json
from pathlib import Path
import unittest

from strategy_simulator.workflow import preview_signal_workflow


ROOT = Path(__file__).resolve().parents[1]


class SignalWorkflowTests(unittest.TestCase):
    def test_fictional_demo_runs_from_signal_to_partial_profit_and_stop(
        self,
    ) -> None:
        document = json.loads(
            (ROOT / "examples" / "demo-signal-events.json").read_text(
                encoding="utf-8"
            )
        )

        preview = preview_signal_workflow(document)

        state = preview["final_state"]
        self.assertEqual(state["status"], "EXITED")
        self.assertEqual(state["filled_quantity"], "100")
        self.assertEqual(state["remaining_quantity"], "0")
        self.assertEqual(state["realized_quantity"], "100")
        self.assertEqual(state["completed_take_profit_stages"], [1])
        self.assertEqual(len(preview["deliveries"]), 14)

        keys = {
            delivery["idempotency_key"]
            for delivery in preview["deliveries"]
        }
        self.assertEqual(len(keys), 14)
        for delivery in preview["deliveries"]:
            self.assertEqual(
                delivery["payload"]["allowed_mentions"],
                {"parse": []},
            )

    def test_invalid_lifecycle_is_rejected_before_delivery(self) -> None:
        document = {
            "ticker": "TEST",
            "company_name": "架空株式会社",
            "events": [
                {
                    "event_id": "event-01",
                    "event_type": "SIGNAL_TRIGGERED",
                    "strategy_id": "fictional",
                    "signal_id": "signal-01",
                    "occurred_at": "2030-01-15T06:00:00Z",
                    "price": "1000",
                },
                {
                    "event_id": "event-02",
                    "event_type": "TAKE_PROFIT_TRIGGERED",
                    "strategy_id": "fictional",
                    "signal_id": "signal-01",
                    "occurred_at": "2030-01-16T06:00:00Z",
                    "price": "1100",
                    "take_profit_stage": 1,
                    "reference_event_id": "event-01",
                },
            ],
        }

        with self.assertRaisesRegex(ValueError, "not allowed"):
            preview_signal_workflow(document)

    def test_event_times_require_timezone_and_monotonic_order(self) -> None:
        base = {
            "ticker": "TEST",
            "company_name": "架空株式会社",
            "events": [
                {
                    "event_id": "event-01",
                    "event_type": "SIGNAL_TRIGGERED",
                    "strategy_id": "fictional",
                    "signal_id": "signal-01",
                    "occurred_at": "2030-01-15T06:00:00Z",
                },
                {
                    "event_id": "event-02",
                    "event_type": "ENTRY_PENDING",
                    "strategy_id": "fictional",
                    "signal_id": "signal-01",
                    "occurred_at": "2030-01-14T06:00:00Z",
                    "quantity": "100",
                    "reference_event_id": "event-01",
                },
            ],
        }

        with self.assertRaisesRegex(ValueError, "ordered by occurred_at"):
            preview_signal_workflow(base)

        base["events"][1]["occurred_at"] = "2030-01-16T06:00:00"
        with self.assertRaisesRegex(ValueError, "include a timezone"):
            preview_signal_workflow(base)


if __name__ == "__main__":
    unittest.main()

from decimal import Decimal
import unittest

from strategy_simulator.signals import (
    ENTRY_FILLED,
    ENTRY_PENDING,
    POSITION_EXITED,
    POSITION_REDUCED,
    SIGNAL_TRIGGERED,
    STOP_TRIGGERED,
    TAKE_PROFIT_TRIGGERED,
    SignalEvent,
    SignalStatus,
    SignalTransitionError,
    reduce_signal,
)


STRATEGY_ID = "synthetic-momentum-v1"
SIGNAL_ID = "signal-synthetic-0001"


def event(
    event_id: str,
    event_type: str,
    *,
    strategy_id: str = STRATEGY_ID,
    signal_id: str = SIGNAL_ID,
    quantity: str | None = None,
    price: str | None = None,
    take_profit_stage: int | None = None,
    reason: str | None = None,
    reference_event_id: str | None = None,
) -> SignalEvent:
    return SignalEvent(
        event_id=event_id,
        event_type=event_type,
        strategy_id=strategy_id,
        signal_id=signal_id,
        quantity=quantity,
        price=price,
        take_profit_stage=take_profit_stage,
        reason=reason,
        reference_event_id=reference_event_id,
    )


def open_position_events() -> list[SignalEvent]:
    return [
        event("evt-01", SIGNAL_TRIGGERED, price="1000"),
        event(
            "evt-02",
            ENTRY_PENDING,
            quantity="100",
            reference_event_id="evt-01",
        ),
        event(
            "evt-03",
            ENTRY_FILLED,
            quantity="100",
            price="1010.5",
            reference_event_id="evt-02",
        ),
    ]


def partially_reduced_events() -> list[SignalEvent]:
    return [
        *open_position_events(),
        event(
            "evt-04",
            TAKE_PROFIT_TRIGGERED,
            price="1111.55",
            take_profit_stage=1,
            reference_event_id="evt-03",
        ),
        event(
            "evt-05",
            POSITION_REDUCED,
            quantity="40",
            price="1110",
            take_profit_stage=1,
            reference_event_id="evt-04",
        ),
    ]


class SignalLifecycleTests(unittest.TestCase):
    def test_full_lifecycle_reduces_then_stops_remaining_quantity(self) -> None:
        events = [
            *partially_reduced_events(),
            event(
                "evt-06",
                STOP_TRIGGERED,
                price="970",
                reference_event_id="evt-05",
            ),
            event(
                "evt-07",
                POSITION_EXITED,
                quantity="60",
                price="965.25",
                reason="stop",
                reference_event_id="evt-06",
            ),
        ]

        state = reduce_signal(events)

        self.assertEqual(state.status, SignalStatus.EXITED)
        self.assertEqual(state.intended_quantity, Decimal("100"))
        self.assertEqual(state.filled_quantity, Decimal("100"))
        self.assertEqual(state.remaining_quantity, Decimal("0"))
        self.assertEqual(state.realized_quantity, Decimal("100"))
        self.assertEqual(state.entry_price, Decimal("1010.5"))
        self.assertEqual(state.last_price, Decimal("965.25"))
        self.assertEqual(state.completed_take_profit_stages, (1,))
        self.assertEqual(state.exit_reason, "stop")
        self.assertEqual(state.event_count, 7)

    def test_take_profit_before_entry_is_rejected(self) -> None:
        events = [
            event("evt-01", SIGNAL_TRIGGERED, price="1000"),
            event(
                "evt-02",
                TAKE_PROFIT_TRIGGERED,
                price="1100",
                take_profit_stage=1,
                reference_event_id="evt-01",
            ),
        ]

        with self.assertRaisesRegex(
            SignalTransitionError,
            "TAKE_PROFIT_TRIGGERED is not allowed",
        ):
            reduce_signal(events)

    def test_same_take_profit_stage_cannot_trigger_twice(self) -> None:
        events = [
            *partially_reduced_events(),
            event(
                "evt-06",
                TAKE_PROFIT_TRIGGERED,
                price="1120",
                take_profit_stage=1,
                reference_event_id="evt-05",
            ),
        ]

        with self.assertRaisesRegex(
            SignalTransitionError,
            "stage 1 was already triggered",
        ):
            reduce_signal(events)

    def test_stop_exit_must_use_only_remaining_quantity(self) -> None:
        events = [
            *partially_reduced_events(),
            event(
                "evt-06",
                STOP_TRIGGERED,
                price="970",
                reference_event_id="evt-05",
            ),
            event(
                "evt-07",
                POSITION_EXITED,
                quantity="100",
                price="965",
                reason="stop",
                reference_event_id="evt-06",
            ),
        ]

        with self.assertRaisesRegex(
            SignalTransitionError,
            "must equal remaining quantity",
        ):
            reduce_signal(events)

    def test_mixed_strategy_id_is_rejected(self) -> None:
        events = [
            event("evt-01", SIGNAL_TRIGGERED),
            event(
                "evt-02",
                ENTRY_PENDING,
                strategy_id="different-strategy-v1",
                quantity="100",
                reference_event_id="evt-01",
            ),
        ]

        with self.assertRaisesRegex(SignalTransitionError, "mixes strategy_id"):
            reduce_signal(events)

    def test_mixed_signal_id_is_rejected(self) -> None:
        events = [
            event("evt-01", SIGNAL_TRIGGERED),
            event(
                "evt-02",
                ENTRY_PENDING,
                signal_id="different-signal",
                quantity="100",
                reference_event_id="evt-01",
            ),
        ]

        with self.assertRaisesRegex(SignalTransitionError, "mixes signal_id"):
            reduce_signal(events)

    def test_duplicate_event_id_is_rejected(self) -> None:
        events = [
            event("evt-01", SIGNAL_TRIGGERED),
            event(
                "evt-01",
                ENTRY_PENDING,
                quantity="100",
                reference_event_id="evt-01",
            ),
        ]

        with self.assertRaisesRegex(SignalTransitionError, "duplicate event_id"):
            reduce_signal(events)

    def test_numeric_event_fields_are_decimal_values(self) -> None:
        signal_event = event(
            "evt-01",
            SIGNAL_TRIGGERED,
            price="1234.50",
        )
        self.assertIsInstance(signal_event.price, Decimal)
        self.assertEqual(signal_event.price, Decimal("1234.50"))


if __name__ == "__main__":
    unittest.main()

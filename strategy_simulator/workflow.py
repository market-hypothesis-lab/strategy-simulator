from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Mapping

from .discord import build_discord_deliveries
from .signals import SignalEvent, SignalState, reduce_signal


def _required_text(value: object, name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{name} must be a non-empty string")
    return value.strip()


def _decimal_text(value: Decimal | None) -> str | None:
    return None if value is None else str(value)


def _timestamp(value: object, name: str) -> tuple[str, datetime]:
    text = _required_text(value, name)
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError(f"{name} must be an ISO-8601 timestamp") from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError(f"{name} must include a timezone")
    return text, parsed


def _state_dict(state: SignalState) -> dict[str, object]:
    return {
        "strategy_id": state.strategy_id,
        "signal_id": state.signal_id,
        "status": state.status.value,
        "intended_quantity": _decimal_text(state.intended_quantity),
        "filled_quantity": str(state.filled_quantity),
        "remaining_quantity": str(state.remaining_quantity),
        "realized_quantity": str(state.realized_quantity),
        "entry_price": _decimal_text(state.entry_price),
        "last_price": _decimal_text(state.last_price),
        "completed_take_profit_stages": list(
            state.completed_take_profit_stages
        ),
        "pending_take_profit_stage": state.pending_take_profit_stage,
        "exit_reason": state.exit_reason,
        "last_event_id": state.last_event_id,
        "event_count": state.event_count,
    }


def preview_signal_workflow(
    document: Mapping[str, object],
) -> dict[str, object]:
    """Validate a lifecycle and create dry-run Discord deliveries.

    The document is expected to contain fictional or appropriately licensed
    data. No credentials are read and no network request is made.
    """

    if not isinstance(document, Mapping):
        raise TypeError("document must be a mapping")
    ticker = _required_text(document.get("ticker"), "ticker")
    company_name = _required_text(
        document.get("company_name"),
        "company_name",
    )
    raw_events = document.get("events")
    if not isinstance(raw_events, list) or not raw_events:
        raise ValueError("events must be a non-empty list")

    events: list[SignalEvent] = []
    deliveries: list[dict[str, object]] = []
    previous_occurred_at: datetime | None = None
    for index, raw_event in enumerate(raw_events):
        if not isinstance(raw_event, Mapping):
            raise ValueError(f"events[{index}] must be an object")
        occurred_at, parsed_occurred_at = _timestamp(
            raw_event.get("occurred_at"),
            f"events[{index}].occurred_at",
        )
        if (
            previous_occurred_at is not None
            and parsed_occurred_at < previous_occurred_at
        ):
            raise ValueError("events must be ordered by occurred_at")
        previous_occurred_at = parsed_occurred_at
        event = SignalEvent(
            event_id=raw_event.get("event_id"),
            event_type=raw_event.get("event_type"),
            strategy_id=raw_event.get("strategy_id"),
            signal_id=raw_event.get("signal_id"),
            quantity=raw_event.get("quantity"),
            price=raw_event.get("price"),
            take_profit_stage=raw_event.get("take_profit_stage"),
            reason=raw_event.get("reason"),
            reference_event_id=raw_event.get("reference_event_id"),
        )
        events.append(event)
        state = reduce_signal(events)
        notification_event = {
            "event_type": event.event_type,
            "strategy_id": event.strategy_id,
            "signal_id": event.signal_id,
            "event_id": event.event_id,
            "ticker": ticker,
            "company_name": company_name,
            "occurred_at": occurred_at,
            "price": _decimal_text(event.price),
            "quantity": _decimal_text(event.quantity),
            "remaining_quantity": str(state.remaining_quantity),
            "tp_stage": event.take_profit_stage,
            "reason": event.reason,
        }
        deliveries.extend(build_discord_deliveries(notification_event))

    final_state = reduce_signal(events)
    return {
        "final_state": _state_dict(final_state),
        "deliveries": deliveries,
    }


__all__ = ["preview_signal_workflow"]

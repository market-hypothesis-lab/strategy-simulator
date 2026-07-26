from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from enum import Enum
from typing import Iterable


SIGNAL_TRIGGERED = "SIGNAL_TRIGGERED"
ENTRY_PENDING = "ENTRY_PENDING"
ENTRY_FILLED = "ENTRY_FILLED"
TAKE_PROFIT_TRIGGERED = "TAKE_PROFIT_TRIGGERED"
POSITION_REDUCED = "POSITION_REDUCED"
STOP_TRIGGERED = "STOP_TRIGGERED"
POSITION_EXITED = "POSITION_EXITED"

EVENT_TYPES = frozenset(
    {
        SIGNAL_TRIGGERED,
        ENTRY_PENDING,
        ENTRY_FILLED,
        TAKE_PROFIT_TRIGGERED,
        POSITION_REDUCED,
        STOP_TRIGGERED,
        POSITION_EXITED,
    }
)


class SignalStatus(str, Enum):
    TRIGGERED = "TRIGGERED"
    ENTRY_PENDING = "ENTRY_PENDING"
    OPEN = "OPEN"
    TAKE_PROFIT_PENDING = "TAKE_PROFIT_PENDING"
    PARTIALLY_EXITED = "PARTIALLY_EXITED"
    STOP_PENDING = "STOP_PENDING"
    EXITED = "EXITED"


class SignalTransitionError(ValueError):
    """Raised when an event would make a signal lifecycle inconsistent."""


def _identifier(value: object, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} must not be empty")
    return value.strip()


def _decimal(
    value: object | None,
    field: str,
    *,
    required: bool = False,
) -> Decimal | None:
    if value is None:
        if required:
            raise ValueError(f"{field} is required")
        return None
    try:
        parsed = Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise ValueError(f"{field} must be a decimal number") from exc
    if not parsed.is_finite():
        raise ValueError(f"{field} must be finite")
    if parsed <= 0:
        raise ValueError(f"{field} must be positive")
    return parsed


@dataclass(frozen=True)
class SignalEvent:
    event_id: str
    event_type: str
    strategy_id: str
    signal_id: str
    quantity: Decimal | str | int | None = None
    price: Decimal | str | int | None = None
    take_profit_stage: int | None = None
    reason: str | None = None
    reference_event_id: str | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "event_id", _identifier(self.event_id, "event_id"))
        object.__setattr__(
            self,
            "strategy_id",
            _identifier(self.strategy_id, "strategy_id"),
        )
        object.__setattr__(
            self,
            "signal_id",
            _identifier(self.signal_id, "signal_id"),
        )
        if self.event_type not in EVENT_TYPES:
            raise ValueError(f"unsupported event_type: {self.event_type}")

        object.__setattr__(self, "quantity", _decimal(self.quantity, "quantity"))
        object.__setattr__(self, "price", _decimal(self.price, "price"))

        if self.take_profit_stage is not None and (
            isinstance(self.take_profit_stage, bool)
            or not isinstance(self.take_profit_stage, int)
            or self.take_profit_stage <= 0
        ):
            raise ValueError("take_profit_stage must be a positive integer")
        if self.reason is not None:
            object.__setattr__(self, "reason", _identifier(self.reason, "reason"))
        if self.reference_event_id is not None:
            object.__setattr__(
                self,
                "reference_event_id",
                _identifier(self.reference_event_id, "reference_event_id"),
            )

        self._validate_shape()

    def _validate_shape(self) -> None:
        required_fields: dict[str, tuple[str, ...]] = {
            SIGNAL_TRIGGERED: (),
            ENTRY_PENDING: ("quantity", "reference_event_id"),
            ENTRY_FILLED: ("quantity", "price", "reference_event_id"),
            TAKE_PROFIT_TRIGGERED: (
                "price",
                "take_profit_stage",
                "reference_event_id",
            ),
            POSITION_REDUCED: (
                "quantity",
                "price",
                "take_profit_stage",
                "reference_event_id",
            ),
            STOP_TRIGGERED: ("price", "reference_event_id"),
            POSITION_EXITED: (
                "quantity",
                "price",
                "reason",
                "reference_event_id",
            ),
        }
        for field in required_fields[self.event_type]:
            if getattr(self, field) is None:
                raise ValueError(f"{self.event_type}.{field} is required")

        if self.event_type != POSITION_EXITED and self.reason is not None:
            raise ValueError(f"{self.event_type}.reason is not allowed")
        if self.event_type not in {
            TAKE_PROFIT_TRIGGERED,
            POSITION_REDUCED,
        } and self.take_profit_stage is not None:
            raise ValueError(
                f"{self.event_type}.take_profit_stage is not allowed"
            )
        if self.event_type in {
            SIGNAL_TRIGGERED,
            TAKE_PROFIT_TRIGGERED,
            STOP_TRIGGERED,
        } and self.quantity is not None:
            raise ValueError(f"{self.event_type}.quantity is not allowed")


@dataclass(frozen=True)
class SignalState:
    strategy_id: str
    signal_id: str
    status: SignalStatus
    intended_quantity: Decimal | None
    filled_quantity: Decimal
    remaining_quantity: Decimal
    realized_quantity: Decimal
    entry_price: Decimal | None
    last_price: Decimal | None
    completed_take_profit_stages: tuple[int, ...]
    pending_take_profit_stage: int | None
    exit_reason: str | None
    last_event_id: str
    event_count: int

    @property
    def is_open(self) -> bool:
        return self.status in {
            SignalStatus.OPEN,
            SignalStatus.TAKE_PROFIT_PENDING,
            SignalStatus.PARTIALLY_EXITED,
            SignalStatus.STOP_PENDING,
        }


def _require_status(
    event: SignalEvent,
    status: SignalStatus,
    allowed: set[SignalStatus],
) -> None:
    if status not in allowed:
        expected = ", ".join(sorted(item.value for item in allowed))
        raise SignalTransitionError(
            f"{event.event_type} is not allowed from {status.value}; "
            f"expected {expected}"
        )


def _require_reference(
    event: SignalEvent,
    expected_event_id: str,
) -> None:
    if event.reference_event_id != expected_event_id:
        raise SignalTransitionError(
            f"{event.event_type}.reference_event_id must be "
            f"{expected_event_id}"
        )


def reduce_signal(events: Iterable[SignalEvent]) -> SignalState:
    sequence = tuple(events)
    if not sequence:
        raise SignalTransitionError("at least one signal event is required")

    first = sequence[0]
    if first.event_type != SIGNAL_TRIGGERED:
        raise SignalTransitionError("first event must be SIGNAL_TRIGGERED")

    strategy_id = first.strategy_id
    signal_id = first.signal_id
    seen_event_ids: set[str] = set()
    triggered_take_profit_stages: set[int] = set()
    completed_take_profit_stages: list[int] = []

    status = SignalStatus.TRIGGERED
    intended_quantity: Decimal | None = None
    filled_quantity = Decimal("0")
    remaining_quantity = Decimal("0")
    entry_price: Decimal | None = None
    last_price = first.price
    pending_take_profit_stage: int | None = None
    pending_take_profit_event_id: str | None = None
    pending_stop_event_id: str | None = None
    exit_reason: str | None = None
    last_position_event_id = first.event_id

    for index, event in enumerate(sequence):
        if event.strategy_id != strategy_id:
            raise SignalTransitionError(
                f"event {event.event_id} mixes strategy_id "
                f"{event.strategy_id} with {strategy_id}"
            )
        if event.signal_id != signal_id:
            raise SignalTransitionError(
                f"event {event.event_id} mixes signal_id "
                f"{event.signal_id} with {signal_id}"
            )
        if event.event_id in seen_event_ids:
            raise SignalTransitionError(
                f"duplicate event_id: {event.event_id}"
            )
        seen_event_ids.add(event.event_id)

        if index == 0:
            continue
        if event.event_type == SIGNAL_TRIGGERED:
            raise SignalTransitionError("SIGNAL_TRIGGERED may only occur once")

        if event.event_type == ENTRY_PENDING:
            _require_status(event, status, {SignalStatus.TRIGGERED})
            _require_reference(event, first.event_id)
            intended_quantity = event.quantity
            status = SignalStatus.ENTRY_PENDING
            last_position_event_id = event.event_id

        elif event.event_type == ENTRY_FILLED:
            _require_status(event, status, {SignalStatus.ENTRY_PENDING})
            _require_reference(event, last_position_event_id)
            if event.quantity != intended_quantity:
                raise SignalTransitionError(
                    "ENTRY_FILLED.quantity must equal the pending quantity"
                )
            filled_quantity = event.quantity
            remaining_quantity = event.quantity
            entry_price = event.price
            last_price = event.price
            status = SignalStatus.OPEN
            last_position_event_id = event.event_id

        elif event.event_type == TAKE_PROFIT_TRIGGERED:
            _require_status(
                event,
                status,
                {SignalStatus.OPEN, SignalStatus.PARTIALLY_EXITED},
            )
            _require_reference(event, last_position_event_id)
            stage = event.take_profit_stage
            if stage in triggered_take_profit_stages:
                raise SignalTransitionError(
                    f"take-profit stage {stage} was already triggered"
                )
            triggered_take_profit_stages.add(stage)
            pending_take_profit_stage = stage
            pending_take_profit_event_id = event.event_id
            last_price = event.price
            status = SignalStatus.TAKE_PROFIT_PENDING

        elif event.event_type == POSITION_REDUCED:
            _require_status(
                event,
                status,
                {SignalStatus.TAKE_PROFIT_PENDING},
            )
            if pending_take_profit_event_id is None:
                raise SignalTransitionError(
                    "POSITION_REDUCED requires a pending take-profit event"
                )
            _require_reference(event, pending_take_profit_event_id)
            if event.take_profit_stage != pending_take_profit_stage:
                raise SignalTransitionError(
                    "POSITION_REDUCED.take_profit_stage does not match "
                    "the pending stage"
                )
            if event.quantity >= remaining_quantity:
                raise SignalTransitionError(
                    "POSITION_REDUCED.quantity must leave a positive remainder"
                )
            remaining_quantity -= event.quantity
            completed_take_profit_stages.append(event.take_profit_stage)
            pending_take_profit_stage = None
            pending_take_profit_event_id = None
            last_price = event.price
            status = SignalStatus.PARTIALLY_EXITED
            last_position_event_id = event.event_id

        elif event.event_type == STOP_TRIGGERED:
            _require_status(
                event,
                status,
                {SignalStatus.OPEN, SignalStatus.PARTIALLY_EXITED},
            )
            _require_reference(event, last_position_event_id)
            pending_stop_event_id = event.event_id
            last_price = event.price
            status = SignalStatus.STOP_PENDING

        elif event.event_type == POSITION_EXITED:
            _require_status(event, status, {SignalStatus.STOP_PENDING})
            if pending_stop_event_id is None:
                raise SignalTransitionError(
                    "POSITION_EXITED requires a pending stop event"
                )
            _require_reference(event, pending_stop_event_id)
            if event.reason != "stop":
                raise SignalTransitionError(
                    "POSITION_EXITED.reason must be stop after STOP_TRIGGERED"
                )
            if event.quantity != remaining_quantity:
                raise SignalTransitionError(
                    "POSITION_EXITED.quantity must equal remaining quantity"
                )
            remaining_quantity = Decimal("0")
            last_price = event.price
            exit_reason = event.reason
            status = SignalStatus.EXITED
            last_position_event_id = event.event_id

    return SignalState(
        strategy_id=strategy_id,
        signal_id=signal_id,
        status=status,
        intended_quantity=intended_quantity,
        filled_quantity=filled_quantity,
        remaining_quantity=remaining_quantity,
        realized_quantity=filled_quantity - remaining_quantity,
        entry_price=entry_price,
        last_price=last_price,
        completed_take_profit_stages=tuple(completed_take_profit_stages),
        pending_take_profit_stage=pending_take_profit_stage,
        exit_reason=exit_reason,
        last_event_id=sequence[-1].event_id,
        event_count=len(sequence),
    )


__all__ = [
    "ENTRY_FILLED",
    "ENTRY_PENDING",
    "EVENT_TYPES",
    "POSITION_EXITED",
    "POSITION_REDUCED",
    "SIGNAL_TRIGGERED",
    "STOP_TRIGGERED",
    "TAKE_PROFIT_TRIGGERED",
    "SignalEvent",
    "SignalState",
    "SignalStatus",
    "SignalTransitionError",
    "reduce_signal",
]

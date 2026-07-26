from __future__ import annotations

from copy import deepcopy
from decimal import Decimal
from math import isfinite
from typing import Any, Mapping


RENDERER_VERSION = "discord-ja-v1"

DISCORD_TITLE_LIMIT = 256
DISCORD_DESCRIPTION_LIMIT = 4096
DISCORD_FIELD_COUNT_LIMIT = 25
DISCORD_FIELD_NAME_LIMIT = 256
DISCORD_FIELD_VALUE_LIMIT = 1024
DISCORD_FOOTER_LIMIT = 2048
DISCORD_EMBED_TOTAL_LIMIT = 6000

_EVENT_STYLES: dict[str, tuple[str, int]] = {
    "SIGNAL_TRIGGERED": ("売買シグナル発火", 0x3498DB),
    "ENTRY_PENDING": ("エントリー待機", 0xF1C40F),
    "ENTRY_FILLED": ("エントリー約定", 0x2ECC71),
    "TAKE_PROFIT_TRIGGERED": ("段階利確シグナル発火", 0x1ABC9C),
    "POSITION_REDUCED": ("段階利確", 0x27AE60),
    "STOP_TRIGGERED": ("損切りシグナル発火", 0xE74C3C),
    "POSITION_EXITED": ("ポジション終了", 0x7F8C8D),
}

_REQUIRED_TEXT_FIELDS = (
    "event_type",
    "strategy_id",
    "signal_id",
    "event_id",
    "ticker",
    "company_name",
    "occurred_at",
)

_EMBED_FIELDS = (
    ("strategy_id", "戦略ID"),
    ("signal_id", "シグナルID"),
    ("occurred_at", "発生時刻"),
    ("price", "価格"),
    ("quantity", "今回数量"),
    ("remaining_quantity", "残数量"),
    ("tp_stage", "利確段階"),
    ("reason", "理由"),
)


def _truncate(value: str, limit: int) -> str:
    if len(value) <= limit:
        return value
    if limit <= 1:
        return "…"[:limit]
    return value[: limit - 1] + "…"


def _required_text(event: Mapping[str, object], name: str) -> str:
    value = event.get(name)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{name} must be a non-empty string")
    return value.strip()


def _display_value(value: object, name: str) -> str | None:
    if value is None:
        return None
    if isinstance(value, float) and not isfinite(value):
        raise ValueError(f"{name} must be finite")
    if isinstance(value, Decimal) and not value.is_finite():
        raise ValueError(f"{name} must be finite")
    rendered = str(value).strip()
    if not rendered:
        return None
    return rendered


def _embed_character_count(embed: Mapping[str, Any]) -> int:
    total = len(str(embed.get("title", "")))
    total += len(str(embed.get("description", "")))
    footer = embed.get("footer", {})
    if isinstance(footer, Mapping):
        total += len(str(footer.get("text", "")))
    fields = embed.get("fields", [])
    if isinstance(fields, list):
        for field in fields:
            if isinstance(field, Mapping):
                total += len(str(field.get("name", "")))
                total += len(str(field.get("value", "")))
    return total


def _fit_embed_total(embed: dict[str, Any]) -> None:
    fields = embed["fields"]
    while _embed_character_count(embed) > DISCORD_EMBED_TOTAL_LIMIT:
        candidates = [
            (len(field["value"]), index)
            for index, field in enumerate(fields)
            if len(field["value"]) > 1
        ]
        if not candidates:
            raise ValueError("embed cannot be reduced to the Discord total limit")
        current_length, index = max(candidates)
        overflow = _embed_character_count(embed) - DISCORD_EMBED_TOTAL_LIMIT
        target_length = max(1, current_length - overflow)
        fields[index]["value"] = _truncate(fields[index]["value"], target_length)


def build_discord_payload(event: Mapping[str, object]) -> dict[str, object]:
    """Render one event as a Discord-compatible Japanese embed.

    This function only creates data. It does not read credentials, open a
    network connection, or send the payload.
    """

    if not isinstance(event, Mapping):
        raise TypeError("event must be a mapping")

    for name in _REQUIRED_TEXT_FIELDS:
        _required_text(event, name)

    event_type = _required_text(event, "event_type")
    try:
        heading, color = _EVENT_STYLES[event_type]
    except KeyError as exc:
        raise ValueError(f"unsupported event_type: {event_type}") from exc

    ticker = _required_text(event, "ticker")
    company_name = _required_text(event, "company_name")
    event_id = _required_text(event, "event_id")

    fields: list[dict[str, object]] = []
    for key, label in _EMBED_FIELDS:
        rendered = _display_value(event.get(key), key)
        if rendered is None:
            continue
        fields.append(
            {
                "name": _truncate(label, DISCORD_FIELD_NAME_LIMIT),
                "value": _truncate(rendered, DISCORD_FIELD_VALUE_LIMIT),
                "inline": key not in {"reason"},
            }
        )

    if len(fields) > DISCORD_FIELD_COUNT_LIMIT:
        raise ValueError("too many Discord embed fields")

    embed: dict[str, Any] = {
        "title": _truncate(
            f"{heading}｜{ticker} {company_name}",
            DISCORD_TITLE_LIMIT,
        ),
        "description": _truncate(
            "ルール条件に基づいて記録された機械通知です。投資助言ではありません。",
            DISCORD_DESCRIPTION_LIMIT,
        ),
        "color": color,
        "fields": fields,
        "footer": {
            "text": _truncate(
                f"event_id={event_id} | renderer={RENDERER_VERSION}",
                DISCORD_FOOTER_LIMIT,
            )
        },
    }
    _fit_embed_total(embed)

    return {
        "allowed_mentions": {"parse": []},
        "embeds": [embed],
    }


def build_discord_deliveries(
    event: Mapping[str, object],
) -> tuple[dict[str, object], ...]:
    """Create logical per-strategy and aggregate delivery records."""

    payload = build_discord_payload(event)
    event_id = _required_text(event, "event_id")
    strategy_id = _required_text(event, "strategy_id")
    channels = (f"strategy:{strategy_id}", "all_signals")

    return tuple(
        {
            "channel": channel,
            "renderer_version": RENDERER_VERSION,
            "idempotency_key": (
                f"{event_id}:{channel}:{RENDERER_VERSION}"
            ),
            "payload": deepcopy(payload),
        }
        for channel in channels
    )


__all__ = [
    "DISCORD_DESCRIPTION_LIMIT",
    "DISCORD_EMBED_TOTAL_LIMIT",
    "DISCORD_FIELD_COUNT_LIMIT",
    "DISCORD_FIELD_NAME_LIMIT",
    "DISCORD_FIELD_VALUE_LIMIT",
    "DISCORD_FOOTER_LIMIT",
    "DISCORD_TITLE_LIMIT",
    "RENDERER_VERSION",
    "build_discord_deliveries",
    "build_discord_payload",
]

from copy import deepcopy
from decimal import Decimal
import unittest

from strategy_simulator.discord import (
    DISCORD_DESCRIPTION_LIMIT,
    DISCORD_EMBED_TOTAL_LIMIT,
    DISCORD_FIELD_COUNT_LIMIT,
    DISCORD_FIELD_NAME_LIMIT,
    DISCORD_FIELD_VALUE_LIMIT,
    DISCORD_FOOTER_LIMIT,
    DISCORD_TITLE_LIMIT,
    RENDERER_VERSION,
    build_discord_deliveries,
    build_discord_payload,
)


def _fictional_event(**overrides: object) -> dict[str, object]:
    event: dict[str, object] = {
        "event_type": "SIGNAL_TRIGGERED",
        "strategy_id": "fictional-breakout",
        "signal_id": "signal-fictional-001",
        "event_id": "event-fictional-001",
        "ticker": "TEST",
        "company_name": "架空テクノロジー株式会社",
        "occurred_at": "2030-01-15T06:00:00Z",
        "price": "1234.5",
        "quantity": "100",
        "remaining_quantity": "100",
        "tp_stage": None,
        "reason": "架空の終値が架空の条件に一致",
    }
    event.update(overrides)
    return event


def _embed_character_count(embed: dict[str, object]) -> int:
    footer = embed["footer"]
    fields = embed["fields"]
    assert isinstance(footer, dict)
    assert isinstance(fields, list)
    return (
        len(str(embed["title"]))
        + len(str(embed["description"]))
        + len(str(footer["text"]))
        + sum(
            len(str(field["name"])) + len(str(field["value"]))
            for field in fields
        )
    )


class DiscordPayloadTests(unittest.TestCase):
    def test_signal_event_builds_japanese_embed_without_mentions(self) -> None:
        payload = build_discord_payload(
            _fictional_event(reason="@everyone 架空の機械判定")
        )

        self.assertEqual(payload["allowed_mentions"], {"parse": []})
        embed = payload["embeds"][0]
        self.assertIn("売買シグナル発火", embed["title"])
        self.assertIn("TEST", embed["title"])
        self.assertIn("投資助言ではありません", embed["description"])
        fields = {field["name"]: field["value"] for field in embed["fields"]}
        self.assertEqual(fields["戦略ID"], "fictional-breakout")
        self.assertEqual(fields["理由"], "@everyone 架空の機械判定")

    def test_all_supported_events_have_dry_japanese_headings(self) -> None:
        expected_headings = {
            "SIGNAL_TRIGGERED": "売買シグナル発火",
            "ENTRY_PENDING": "エントリー待機",
            "ENTRY_FILLED": "エントリー約定",
            "TAKE_PROFIT_TRIGGERED": "段階利確シグナル発火",
            "POSITION_REDUCED": "段階利確",
            "STOP_TRIGGERED": "損切りシグナル発火",
            "POSITION_EXITED": "ポジション終了",
        }

        for event_type, heading in expected_headings.items():
            with self.subTest(event_type=event_type):
                payload = build_discord_payload(
                    _fictional_event(
                        event_type=event_type,
                        tp_stage="2",
                        remaining_quantity="40",
                    )
                )
                self.assertIn(heading, payload["embeds"][0]["title"])

    def test_optional_trade_fields_are_rendered_when_present(self) -> None:
        payload = build_discord_payload(
            _fictional_event(
                event_type="POSITION_REDUCED",
                price="1500",
                quantity="25",
                remaining_quantity="75",
                tp_stage="1",
                reason="架空の第一利確条件",
            )
        )

        fields = {
            field["name"]: field["value"]
            for field in payload["embeds"][0]["fields"]
        }
        self.assertEqual(fields["価格"], "1500")
        self.assertEqual(fields["今回数量"], "25")
        self.assertEqual(fields["残数量"], "75")
        self.assertEqual(fields["利確段階"], "1")
        self.assertEqual(fields["理由"], "架空の第一利確条件")

    def test_none_optional_fields_are_omitted(self) -> None:
        payload = build_discord_payload(
            _fictional_event(
                price=None,
                quantity=None,
                remaining_quantity=None,
                tp_stage=None,
                reason=None,
            )
        )

        names = {
            field["name"] for field in payload["embeds"][0]["fields"]
        }
        self.assertNotIn("価格", names)
        self.assertNotIn("今回数量", names)
        self.assertNotIn("残数量", names)
        self.assertNotIn("利確段階", names)
        self.assertNotIn("理由", names)

    def test_routes_to_strategy_and_aggregate_channels(self) -> None:
        deliveries = build_discord_deliveries(_fictional_event())

        self.assertEqual(
            [delivery["channel"] for delivery in deliveries],
            ["strategy:fictional-breakout", "all_signals"],
        )
        for delivery in deliveries:
            channel = delivery["channel"]
            self.assertEqual(
                delivery["idempotency_key"],
                (
                    f"event-fictional-001:{channel}:"
                    f"{RENDERER_VERSION}"
                ),
            )
            self.assertEqual(
                delivery["renderer_version"],
                RENDERER_VERSION,
            )

    def test_each_delivery_has_an_independent_payload(self) -> None:
        deliveries = build_discord_deliveries(_fictional_event())

        first_payload = deliveries[0]["payload"]
        second_payload = deliveries[1]["payload"]
        self.assertIsNot(first_payload, second_payload)
        first_payload["embeds"][0]["title"] = "変更"
        self.assertNotEqual(
            first_payload["embeds"][0]["title"],
            second_payload["embeds"][0]["title"],
        )

    def test_rendering_does_not_mutate_input(self) -> None:
        event = _fictional_event()
        before = deepcopy(event)

        build_discord_deliveries(event)

        self.assertEqual(event, before)

    def test_discord_component_and_total_limits_are_enforced(self) -> None:
        very_long = "架" * 10000
        payload = build_discord_payload(
            _fictional_event(
                strategy_id=very_long,
                signal_id=very_long,
                event_id=very_long,
                ticker=very_long,
                company_name=very_long,
                occurred_at=very_long,
                price=very_long,
                quantity=very_long,
                remaining_quantity=very_long,
                tp_stage=very_long,
                reason=very_long,
            )
        )
        embed = payload["embeds"][0]
        footer = embed["footer"]
        fields = embed["fields"]

        self.assertLessEqual(len(embed["title"]), DISCORD_TITLE_LIMIT)
        self.assertLessEqual(
            len(embed["description"]),
            DISCORD_DESCRIPTION_LIMIT,
        )
        self.assertLessEqual(len(footer["text"]), DISCORD_FOOTER_LIMIT)
        self.assertLessEqual(len(fields), DISCORD_FIELD_COUNT_LIMIT)
        for field in fields:
            self.assertLessEqual(
                len(field["name"]),
                DISCORD_FIELD_NAME_LIMIT,
            )
            self.assertLessEqual(
                len(field["value"]),
                DISCORD_FIELD_VALUE_LIMIT,
            )
        self.assertLessEqual(
            _embed_character_count(embed),
            DISCORD_EMBED_TOTAL_LIMIT,
        )

    def test_unsupported_event_type_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "unsupported event_type"):
            build_discord_payload(
                _fictional_event(event_type="MAGICAL_PROFIT")
            )

    def test_required_identity_field_is_rejected_when_blank(self) -> None:
        with self.assertRaisesRegex(ValueError, "signal_id"):
            build_discord_payload(_fictional_event(signal_id=" "))

    def test_nonfinite_numeric_value_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "price must be finite"):
            build_discord_payload(_fictional_event(price=float("inf")))
        with self.assertRaisesRegex(ValueError, "price must be finite"):
            build_discord_payload(_fictional_event(price=Decimal("NaN")))


if __name__ == "__main__":
    unittest.main()

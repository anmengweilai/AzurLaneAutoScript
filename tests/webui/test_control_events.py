import unittest
import json
from datetime import datetime

from rich.text import Text

from module.webui.control.config import json_safe

from module.webui.control.errors import ControlApiError, NotFound
from module.webui.control.events import (
    EventHub,
    LogBuffer,
    ProcessLogCollector,
    renderable_to_html,
    renderable_to_text,
)


class Renderable:
    pass


class LogBufferTest(unittest.TestCase):
    def test_sequence_levels_and_cursor(self):
        buffer = LogBuffer()
        first = buffer.append("starting")
        warning = buffer.append("something warning")
        error = buffer.append("task error")

        self.assertEqual([first["seq"], warning["seq"], error["seq"]], [1, 2, 3])
        self.assertEqual(warning["level"], "warning")
        self.assertEqual(error["level"], "error")
        self.assertEqual([item["seq"] for item in buffer.after(2)], [3])
        self.assertEqual(buffer.latest_sequence(), 3)


class EventHubTest(unittest.TestCase):
    def test_buffers_are_isolated_by_instance(self):
        hub = EventHub()
        hub.buffer("alas").append("one")
        hub.buffer("second").append("two")

        self.assertEqual(hub.buffer("alas").latest_sequence(), 1)
        self.assertEqual(hub.buffer("second").latest_sequence(), 1)


class CollectorTest(unittest.TestCase):
    def test_collects_unseen_renderables(self):
        class Manager:
            config_name = "alas"
            renderables = ["line one", "line two"]

        hub = EventHub()
        collector = ProcessLogCollector(hub, {"alas": Manager()}, poll_interval=0)
        self.assertEqual(collector.collect_once(), 2)
        self.assertEqual(hub.buffer("alas").latest_sequence(), 2)
        # The same store object is not queued twice.
        self.assertEqual(collector.collect_once(), 0)


class RichHtmlTest(unittest.TestCase):
    def test_renderable_exports_colored_html_and_plain_text(self):
        renderable = Text.from_markup("[b]INFO[/b] [blue]16:12:11[/blue]")
        text, html = renderable_to_html(renderable)

        self.assertIn("INFO", text)
        self.assertIn("16:12:11", text)
        self.assertIn('style="font-weight: bold"', html)
        self.assertIn('style="color: #0451a5', html)

    def test_buffer_preserves_html_and_line_count(self):
        buffer = LogBuffer()
        event = buffer.append(
            "first\nsecond",
            html="<span>first\nsecond</span>",
            lines=2,
        )

        self.assertEqual(event["format"], "html")
        self.assertEqual(event["lines"], 2)
        self.assertIn("<span>", event["html"])
        self.assertEqual(buffer.after(0), [event])


class ErrorTest(unittest.TestCase):
    def test_structured_error_attributes(self):
        error = NotFound("missing", details={"name": "alas"})

        self.assertEqual(error.status_code, 404)
        self.assertEqual(error.code, "NOT_FOUND")
        self.assertEqual(error.details, {"name": "alas"})
        self.assertIsInstance(error, ControlApiError)


class JsonSafeTest(unittest.TestCase):
    def test_converts_datetime_recursively(self):
        value = {
            "Main": {
                "Scheduler": {
                    "NextRun": datetime(2026, 11, 13, 9, 51, 0),
                    "items": [datetime(2026, 11, 14), (1, 2)],
                }
            }
        }

        assert json.dumps(json_safe(value)) == json.dumps({
            "Main": {
                "Scheduler": {
                    "NextRun": "2026-11-13 09:51:00",
                    "items": ["2026-11-14 00:00:00", [1, 2]],
                }
            }
        })


if __name__ == "__main__":
    unittest.main()

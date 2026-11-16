import unittest
from unittest.mock import patch

from module.webui.control.update import UpdateControl
from module.webui.control.events import InternalErrorBus
from module.webui.updater import updater


class UpdateControlTest(unittest.TestCase):
    def test_check_propagates_unexpected_error(self):
        internal_errors = InternalErrorBus()
        control = UpdateControl(internal_errors)
        expected = RuntimeError("check failed")

        with patch.object(updater, "check_update", side_effect=expected), \
                patch.object(updater, "state", "up_to_date"):
            with self.assertRaises(RuntimeError):
                control.check()

        self.assertEqual(updater.state, "failed")

    def test_background_run_records_generic_internal_error(self):
        internal_errors = InternalErrorBus()
        control = UpdateControl(internal_errors)
        expected = RuntimeError("run failed")

        with patch.object(updater, "run_update", side_effect=expected):
            control._safe_run()

        events = internal_errors.after(0)
        self.assertEqual(len(events), 1)
        error = events[0]
        self.assertEqual(error["source"], "update-run")
        self.assertIn("run failed", error["message"])
        self.assertIn("Traceback (most recent call last)", error["traceback"])
        self.assertEqual(updater.state, "failed")

if __name__ == "__main__":
    unittest.main()

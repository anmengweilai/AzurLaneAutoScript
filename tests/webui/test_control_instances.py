import unittest
from unittest.mock import MagicMock, patch

from module.webui.control.config import ConfigControl
from module.webui.control.errors import InvalidArgument
from module.webui.control.instances import InstanceControl
from module.webui.control.events import EventHub
from module.webui.process_manager import ProcessManager
from module.webui.updater import updater


class InstanceControlTest(unittest.TestCase):
    def test_import_config_overwrites_existing_instance(self):
        control = ConfigControl()

        with patch("module.config.utils.alas_instance", return_value=["existing"]), \
                patch("module.webui.control.config.State") as state:
            result = control.import_config("existing.json", '{"Alas": {}}')

        self.assertEqual(result, {"name": "existing", "mod": "alas"})
        state.config_updater.write_file.assert_called_once_with(
            "existing", {"Alas": {}}, "alas"
        )

    def test_import_config_rejects_template_name(self):
        control = ConfigControl()

        with patch("module.webui.control.config.State"):
            with self.assertRaises(InvalidArgument):
                control.import_config("template.json", '{"Alas": {}}')

    def test_payload_uses_process_is_alive(self):
        process = MagicMock()
        process.is_alive.return_value = True
        manager = MagicMock()
        manager.alive = True
        manager.state = "running"
        manager._process = process

        control = InstanceControl(EventHub())
        with patch("module.webui.control.instances.alas_instance", return_value=["alas"]), \
                patch.object(ProcessManager, "get_manager", return_value=manager):
            payload = control.payload("alas")

        self.assertEqual(payload["pid"], process.pid)
        process.is_alive.assert_called_once_with()

    def test_start_without_task_uses_instance_func(self):
        manager = MagicMock()
        manager.alive = False
        manager._process = None

        control = InstanceControl(EventHub())
        with patch("module.webui.control.instances.alas_instance", return_value=["alas"]), \
                patch("module.webui.control.instances.get_config_mod", return_value="alas"), \
                patch.object(ProcessManager, "get_manager", return_value=manager):
            control.start("alas")

        manager.start.assert_called_once_with(func="alas", ev=updater.event)

    def test_start_with_task_uses_requested_task(self):
        manager = MagicMock()
        manager.alive = False
        manager._process = None

        control = InstanceControl(EventHub())
        with patch("module.webui.control.instances.alas_instance", return_value=["alas"]), \
                patch("module.webui.control.instances.get_config_mod", return_value="alas"), \
                patch.object(ProcessManager, "get_manager", return_value=manager):
            control.start("alas", "Benchmark")

        manager.start.assert_called_once_with(func="Benchmark", ev=updater.event)

    def test_restart_without_task_uses_instance_func(self):
        manager = MagicMock()
        manager.alive = False
        manager._process = None

        control = InstanceControl(EventHub())
        with patch("module.webui.control.instances.alas_instance", return_value=["alas"]), \
                patch("module.webui.control.instances.get_config_mod", return_value="alas"), \
                patch.object(ProcessManager, "get_manager", return_value=manager):
            control.restart("alas")

        manager.start.assert_called_once_with(func="alas", ev=updater.event)


if __name__ == "__main__":
    unittest.main()

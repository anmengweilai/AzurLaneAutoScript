from typing import Any, Dict

from module.webui.control.errors import NotFound


def task_payload(task) -> Dict[str, Any]:
    next_run = task.next_run
    return {
        "name": task.command,
        "next_run": next_run.isoformat(sep=" ", timespec="seconds") if next_run else None,
        "enabled": bool(task.enable),
    }


def overview(name: str) -> Dict[str, Any]:
    from module.submodule.submodule import load_config
    from module.webui.process_manager import ProcessManager

    try:
        config = load_config(name)
    except Exception as error:
        raise NotFound(f"Unable to load config for instance: {name}", details={"error": str(error)})

    config.load()
    config.get_next_task()
    manager = ProcessManager.get_manager(name)
    pending = list(config.pending_task or [])
    running = pending[:1] if manager.alive else []
    pending = pending[1:] if manager.alive else pending

    return {
        "running": [task_payload(task) for task in running],
        "pending": [task_payload(task) for task in pending],
        "waiting": [task_payload(task) for task in (config.waiting_task or [])],
    }

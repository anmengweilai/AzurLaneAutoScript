from typing import Any, Dict, List

from module.config.utils import alas_instance, alas_template
from module.submodule.utils import get_config_mod


def templates() -> List[str]:
    return alas_template() + alas_instance()


def config_filename(name: str) -> str:
    mod = get_config_mod(name)
    return f"{name}.json" if mod == "alas" else f"{name}.{mod}.json"

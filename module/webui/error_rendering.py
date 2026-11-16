from rich.console import Console
from rich.traceback import Traceback

from module.webui.setting import State
from module.webui.utils import (
    DARK_TERMINAL_THEME,
    LIGHT_TERMINAL_THEME,
    TRACEBACK_CODE_FORMAT,
)


def render_exception_html(error: BaseException) -> str:
    """Render an exception with the same Rich theme used by PyWebIO."""
    console = Console(
        color_system="truecolor",
        tab_size=2,
        record=True,
        width=90,
    )
    traceback = Traceback.from_exception(
        type(error),
        error,
        error.__traceback__,
        word_wrap=True,
        extra_lines=1,
        show_locals=True,
    )
    console.print(traceback)

    theme = DARK_TERMINAL_THEME if State.theme == "dark" else LIGHT_TERMINAL_THEME
    return console.export_html(
        theme=theme,
        code_format=TRACEBACK_CODE_FORMAT,
        inline_styles=True,
    )

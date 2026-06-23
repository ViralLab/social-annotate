import re
from intervention_server import InterventionHandler

_LOREM = (
    "Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor "
    "incididunt ut labore et dolore magna aliqua Ut enim ad minim veniam quis nostrud "
    "exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat Duis aute "
    "irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla "
    "pariatur Excepteur sint occaecat cupidatat non proident sunt in culpa qui officia "
    "deserunt mollit anim id est laborum"
).split()


def _lorem_of_length(char_count: int) -> str:
    """Return a Lorem Ipsum string approximately matching char_count characters."""
    words, total = [], 0
    i = 0
    while total < char_count:
        word = _LOREM[i % len(_LOREM)]
        words.append(word)
        total += len(word) + 1
        i += 1
    return " ".join(words)


class LoremIpsumHandler(InterventionHandler):
    """
    Replaces post body with Lorem Ipsum text of similar length.

    Optional constructor params:
        match_length  bool  — if True, match original char count (default True)
        fixed_text    str   — use a fixed string instead of generated Lorem Ipsum
        prompt_label  str   — label stored in annotation output (default "lorem-ipsum")

    Usage:
        from server.handlers.lorem_ipsum import LoremIpsumHandler
        from server.intervention_server import InterventionServer

        InterventionServer(LoremIpsumHandler()).run()
    """

    def __init__(
        self,
        match_length: bool = True,
        fixed_text: str | None = None,
        prompt_label: str = "lorem-ipsum",
    ):
        self.match_length = match_length
        self.fixed_text = fixed_text
        self.prompt_label = prompt_label

    def process_post(self, post: dict) -> dict:
        body = post.get("body", "")

        if self.fixed_text is not None:
            rewritten = self.fixed_text
        elif self.match_length and body:
            rewritten = _lorem_of_length(len(body))
        else:
            rewritten = "Lorem ipsum dolor sit amet, consectetur adipiscing elit."

        return {
            "rewritten_text": rewritten,
            "prompt_label": self.prompt_label,
        }

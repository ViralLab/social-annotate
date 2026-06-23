import re
from intervention_server import InterventionHandler


class HashtagRemovalHandler(InterventionHandler):
    """
    Removes all hashtags from post text.

    Optional constructor params:
        keep_text   bool  — if True, keeps the word without the # symbol (default False)
        prompt_label str  — label stored in the annotation output (default "no-hashtags")

    Usage:
        from server.handlers.hashtag_removal import HashtagRemovalHandler
        from server.intervention_server import InterventionServer

        InterventionServer(HashtagRemovalHandler()).run()
    """

    def __init__(self, keep_text: bool = False, prompt_label: str = "no-hashtags"):
        self.keep_text = keep_text
        self.prompt_label = prompt_label

    def process_post(self, post: dict) -> dict:
        body = post.get("body", "")

        if self.keep_text:
            # #Python → Python
            rewritten = re.sub(r'#(\w+)', r'\1', body)
        else:
            # #Python → (removed entirely)
            rewritten = re.sub(r'#\w+', '', body)

        rewritten = re.sub(r'  +', ' ', rewritten).strip()

        return {
            "rewritten_text": rewritten,
            "prompt_label": self.prompt_label,
            "hashtags_removed": re.findall(r'#\w+', body),
        }

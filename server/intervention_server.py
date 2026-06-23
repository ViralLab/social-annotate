"""
Social Annotate — Live Intervention Server

Usage:
    uv run server/intervention_server.py
    # or: python server/intervention_server.py

Extension endpoint setting:  http://localhost:5001/intervene

Subclass InterventionHandler and pass it to InterventionServer.
See the examples at the bottom of this file.
"""

from abc import ABC, abstractmethod
from flask import Flask, request, jsonify
from flask_cors import CORS


# ---------------------------------------------------------------------------
# Base handler — subclass this
# ---------------------------------------------------------------------------

class InterventionHandler(ABC):
    """
    Override process_post() to implement your intervention logic.

    Input post fields (all may be None/empty):
        post_id       str   — platform post identifier
        account_id    str   — author handle/username
        body          str   — original post text
        created_at    str   — ISO 8601 timestamp
        media_urls    list  — image/video URLs attached to the post
        post_metrics  dict  — { like_count, share_count, comment_count, ... }

    Return a dict with at minimum:
        rewritten_text  str  — text shown to the participant (required)

    Optional return keys (stored in the annotation's intervention group):
        map_id        str  — override the auto-generated map identifier
        prompt_label  str  — condition label, e.g. "high-engagement"
        <any key>          — extra fields are saved as intervention metadata
    """

    @abstractmethod
    def process_post(self, post: dict) -> dict: ...

    def process_batch(self, posts: list, metadata: dict) -> dict:
        """Process a batch of posts. Override for batch-level logic (e.g. LLM batch APIs).
        Stores metadata (survey_type, platform, …) on self._batch_metadata so
        process_post() implementations can read it without changing their signature."""
        self._batch_metadata = metadata
        results = {}
        for post in posts:
            post_id = post.get("post_id")
            if post_id:
                result = self.process_post(post)
                result.setdefault("original_text", post.get("body", ""))
                results[post_id] = result
        return results


class UserInterventionHandler(ABC):
    """
    Override process_user() to implement user-profile intervention logic.

    Input fields (all may be None):
        account_id        str  — platform username
        profile_name      str  — display name
        handle            str  — @username
        followers_count   str  — follower count string as shown on screen
        following_count   str  — following count string as shown on screen
        bio               str  — profile bio / description
        fields_to_intervene  list[str]  — subset the researcher enabled

    Return a dict containing only the fields you want to rewrite.
    Keys not present in the response are left unchanged on-screen.
    """

    @abstractmethod
    def process_user(self, user: dict) -> dict: ...


# ---------------------------------------------------------------------------
# Server
# ---------------------------------------------------------------------------

class InterventionServer:
    def __init__(
        self,
        handler: InterventionHandler,
        user_handler: UserInterventionHandler | None = None,
        host: str = "0.0.0.0",
        port: int = 5001,
    ):
        self.handler = handler
        self.user_handler = user_handler
        self.host = host
        self.port = port
        self.app = Flask(__name__)
        CORS(self.app)
        self.app.add_url_rule("/intervene", "intervene", self._intervene, methods=["POST"])
        self.app.add_url_rule("/user-intervene", "user_intervene", self._user_intervene, methods=["POST"])
        self.app.add_url_rule("/health", "health", self._health, methods=["GET"])

    def _intervene(self):
        data = request.get_json(force=True, silent=True)
        if not data or "posts" not in data:
            return jsonify({"error": "missing posts array"}), 400

        print(f"\n{'─'*60}")
        print(f"► RECEIVED  platform={data.get('platform')}  posts={len(data['posts'])}")
        for post in data["posts"]:
            print(f"  post_id={post.get('post_id')}  body={repr(post.get('body', '')[:80])}")

        metadata = {k: v for k, v in data.items() if k != "posts"}
        try:
            results = self.handler.process_batch(data["posts"], metadata)
        except Exception as e:
            self.app.logger.error("process_batch failed: %s", e)
            return jsonify({"error": "server error"}), 500

        print(f"◄ RETURNING {len(results)} result(s)")
        for post_id, r in results.items():
            print(f"  post_id={post_id}  rewritten={repr(r.get('rewritten_text', '')[:80])}")
        print(f"{'─'*60}\n")

        return jsonify({"results": results})

    def _user_intervene(self):
        data = request.get_json(force=True, silent=True)
        if not data or "account_id" not in data:
            return jsonify({"error": "missing account_id"}), 400

        print(f"\n{'─'*60}")
        print(f"► USER INTERVENTION  platform={data.get('platform')}  account={data.get('account_id')}")
        print(f"  fields_to_intervene={data.get('fields_to_intervene')}")

        if not self.user_handler:
            return jsonify({"error": "no user handler configured"}), 501

        try:
            result = self.user_handler.process_user(data)
        except Exception as e:
            self.app.logger.error("process_user failed: %s", e)
            return jsonify({"error": "server error"}), 500

        print(f"◄ RETURNING {result}")
        print(f"{'─'*60}\n")
        return jsonify(result)

    def _health(self):
        return jsonify({"status": "ok"})

    def run(self, debug: bool = True, **kwargs):
        self.app.run(host=self.host, port=self.port, debug=debug, **kwargs)


# ---------------------------------------------------------------------------
# Example handlers
# ---------------------------------------------------------------------------

class PassthroughHandler(InterventionHandler):
    """Returns posts unchanged. Useful as a control condition."""

    def process_post(self, post: dict) -> dict:
        return {
            "rewritten_text": post.get("body", ""),
            "prompt_label": "control",
        }


# ---------------------------------------------------------------------------
# Entry point — swap in your handler here
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import argparse
    from handlers.lorem_ipsum import LoremIpsumHandler
    from handlers.minus_one_user import MinusOneUserHandler

    parser = argparse.ArgumentParser(description="Social Annotate intervention server")
    parser.add_argument("--host", default="0.0.0.0", help="Host to bind (default: 0.0.0.0)")
    parser.add_argument("--port", type=int, default=5001, help="Port to listen on (default: 5001)")
    parser.add_argument("--no-debug", dest="debug", action="store_false", help="Disable debug mode")
    args = parser.parse_args()

    handler = LoremIpsumHandler()
    user_handler = MinusOneUserHandler()
    InterventionServer(handler, user_handler=user_handler, host=args.host, port=args.port).run(debug=args.debug)

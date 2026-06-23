from intervention_server import UserInterventionHandler

USER_FIELDS = ["profile_name", "handle", "followers_count", "following_count", "posts_count", "likes_count", "bio"]


class MinusOneUserHandler(UserInterventionHandler):
    """Sets every requested profile field to '-1'. Useful for testing that
    user intervention reaches the DOM correctly."""

    def process_user(self, user: dict) -> dict:
        fields = user.get("fields_to_intervene") or USER_FIELDS
        return {f: "-1" for f in fields if f in USER_FIELDS}

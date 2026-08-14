"""Cognito pre-signup trigger: allow signups ONLY from @minfytech.com.

Raising here blocks the signup and returns the message to the client. This is
the real, server-side enforcement — the client-side check in the UI is only a
convenience and can be bypassed by calling Cognito directly.
"""

ALLOWED_DOMAIN = "@minfytech.com"


def handler(event, context):
    attrs = event.get("request", {}).get("userAttributes", {})
    email = (attrs.get("email") or "").strip().lower()
    if not email.endswith(ALLOWED_DOMAIN):
        raise Exception(f"Signups are restricted to {ALLOWED_DOMAIN} email addresses.")
    # Do NOT auto-confirm — the app uses the email verification code flow.
    return event
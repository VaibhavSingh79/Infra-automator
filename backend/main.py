import os
os.environ["GIT_PYTHON_REFRESH"] = "quiet"
os.environ["GIT_PYTHON_GIT_EXECUTABLE"] = "/usr/bin/git"

import json
import time
import logging
import urllib.request
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from api.routers import upload, git_ops, state_ops, github_api, github_status
from mangum import Mangum
from jose import jwt

from core import config  # Cognito + runtime config, no longer hardcoded to a dead account

logger = logging.getLogger()
logger.setLevel(logging.INFO)

JWKS_URL = (
    f"https://cognito-idp.{config.COGNITO_REGION}.amazonaws.com/"
    f"{config.COGNITO_POOL_ID}/.well-known/jwks.json"
)

# ── Cache JWKS at cold start so we don't fetch on every request ──
try:
    with urllib.request.urlopen(JWKS_URL) as _resp:
        JWKS = json.loads(_resp.read())
    logger.info("JWKS loaded successfully — %d keys", len(JWKS.get("keys", [])))
except Exception as e:
    logger.error("Failed to load JWKS at startup: %s", e)
    JWKS = {"keys": []}

app = FastAPI(title="Infrastructure Orchestrator", version="1.0", redirect_slashes=False)


# ── Auth middleware ──
@app.middleware("http")
async def verify_cognito_token(request: Request, call_next):
    # Skip auth on health check
    if request.url.path == "/":
        return await call_next(request)

    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return JSONResponse(status_code=401, content={"detail": "Missing authentication token"})

    token = auth_header.split(" ", 1)[1]
    try:
        headers = jwt.get_unverified_headers(token)
        kid = headers.get("kid")
        key = next((k for k in JWKS["keys"] if k["kid"] == kid), None)
        if not key:
            return JSONResponse(status_code=401, content={"detail": "Token signing key not recognised"})

        claims = jwt.decode(
            token,
            key,
            algorithms=["RS256"],
            options={"verify_aud": False},
        )

        if claims.get("exp", 0) < time.time():
            return JSONResponse(status_code=401, content={"detail": "Token has expired — please sign in again"})

        # Optional hardening: ensure the token was issued for OUR app client.
        if config.COGNITO_APP_CLIENT_ID:
            client_id = claims.get("client_id") or claims.get("aud")
            if client_id != config.COGNITO_APP_CLIENT_ID:
                return JSONResponse(status_code=401, content={"detail": "Token not issued for this application"})

        user_email = claims.get("username") or claims.get("email") or claims.get("sub", "unknown")
        request.state.user_email = user_email
        logger.info(json.dumps({
            "event": "api_request",
            "user": user_email,
            "method": request.method,
            "path": str(request.url.path),
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }))

    except Exception as e:
        logger.warning("Token validation failed: %s", str(e))
        return JSONResponse(status_code=401, content={"detail": "Invalid or malformed token"})

    return await call_next(request)


app.include_router(upload.router,     prefix="/api/v1",        tags=["Upload"])
app.include_router(git_ops.router,    prefix="/api/v1",        tags=["Git Operations"])
app.include_router(state_ops.router,  prefix="/api/v1",        tags=["State Editor"])
app.include_router(github_api.router, prefix="/api/v1/github", tags=["GitHub API"])
app.include_router(github_status.router, prefix="/api/v1/github", tags=["GitHub Status"])



@app.get("/")
def read_root():
    return {"status": "Serverless Backend is running"}


def handler(event, context):
    logger.info("RAW EVENT: %s", json.dumps(event))
    mangum_handler = Mangum(app, lifespan="off", api_gateway_base_path=None)
    return mangum_handler(event, context)
"""Tokens Bearer signés ; l’Admin est relu en base à chaque opération protégée."""

import os
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from typing import Annotated

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt.exceptions import InvalidTokenError
from sqlalchemy import text

from database import get_engine

bearer = HTTPBearer(auto_error=False)
ALGORITHM = "HS256"
ISSUER = "umbb-api"
AUDIENCE = "umbb-admin"


class AuthConfigurationError(RuntimeError):
    pass


@lru_cache(maxsize=1)
def get_auth_settings():
    secret = os.getenv("JWT_SECRET_KEY", "")
    if len(secret.encode("utf-8")) < 32 or not secret.strip():
        raise AuthConfigurationError("JWT_SECRET_KEY doit contenir au moins 32 octets aléatoires.")
    try:
        minutes = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "30"))
        if not 1 <= minutes <= 120:
            raise ValueError
    except ValueError:
        raise AuthConfigurationError("Expiration attendue : de 1 à 120 minutes.") from None
    return secret, minutes


def unauthorized():
    return HTTPException(
        status_code=401, detail="Authentification requise ou identifiants invalides.",
        headers={"WWW-Authenticate": "Bearer"},
    )


def create_access_token(admin_id):
    secret, minutes = get_auth_settings()
    now = datetime.now(timezone.utc)
    token = jwt.encode(
        {"sub": str(admin_id), "iat": now, "exp": now + timedelta(minutes=minutes),
         "iss": ISSUER, "aud": AUDIENCE, "type": "access"},
        secret, algorithm=ALGORITHM,
    )
    return {"access_token": token, "token_type": "bearer", "expires_in": minutes * 60}


def get_current_admin(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
):
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise unauthorized()
    secret, _ = get_auth_settings()
    try:
        claims = jwt.decode(
            credentials.credentials, secret, algorithms=[ALGORITHM],
            audience=AUDIENCE, issuer=ISSUER,
            options={"require": ["sub", "iat", "exp", "iss", "aud", "type"]},
        )
        subject = claims["sub"]
        if (not isinstance(subject, str) or len(subject) > 19 or
                not subject.isascii() or not subject.isdigit()):
            raise unauthorized()
        admin_id = int(subject)
        if admin_id <= 0 or admin_id > 9223372036854775807 or claims["type"] != "access":
            raise unauthorized()
    except InvalidTokenError:
        raise unauthorized() from None

    with get_engine().connect() as connection:
        admin = connection.execute(
            text("SELECT id, nom, email FROM admins WHERE id = :admin_id"),
            {"admin_id": admin_id},
        ).mappings().first()
    if admin is None:
        raise unauthorized()
    # Ne jamais exposer admins.password dans une réponse.
    return dict(admin)

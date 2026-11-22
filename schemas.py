"""Contrats JSON du Login et des annonces ; aucun nom de colonne n’est changé."""

from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, SecretStr, field_validator


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: EmailStr = Field(max_length=254)
    password: SecretStr = Field(min_length=1, max_length=1024)


class TokenResponse(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in: int


class AnnonceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    titre: str = Field(min_length=4, max_length=140)
    date_annonce: date
    categorie: Literal["Université", "Scolarité", "Recherche", "Vie étudiante"]
    description: str = Field(min_length=15, max_length=600)

    @field_validator("date_annonce", mode="before")
    @classmethod
    def date_iso(cls, value):
        # Pas de timestamp numérique ni de jour impossible : uniquement YYYY-MM-DD.
        if not isinstance(value, str) or len(value) != 10:
            raise ValueError("La date doit être au format YYYY-MM-DD.")
        try:
            parsed = date.fromisoformat(value)
        except ValueError:
            raise ValueError("La date doit être valide et au format YYYY-MM-DD.") from None
        if parsed.isoformat() != value:
            raise ValueError("La date doit être au format YYYY-MM-DD.")
        return parsed

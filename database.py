"""Configuration PostgreSQL chargée au premier accès, sans connexion à l’import."""

import os
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import URL, create_engine

load_dotenv(Path(__file__).with_name(".env"))


class DatabaseConfigurationError(RuntimeError):
    pass


@lru_cache(maxsize=1)
def get_engine():
    # Les noms des variables existantes sont conservés.
    hote = os.getenv("DB_HOST")
    nom_base = os.getenv("DB_NAME")
    utilisateur = os.getenv("DB_USER")
    mot_de_passe = os.getenv("DB_PASSWORD")
    if not hote or not nom_base or not utilisateur or not mot_de_passe:
        raise DatabaseConfigurationError("Configuration PostgreSQL incomplète.")
    try:
        port = int(os.getenv("DB_PORT", "5432"))
        if not 1 <= port <= 65535:
            raise ValueError
    except ValueError:
        raise DatabaseConfigurationError("DB_PORT doit être un port valide.") from None

    # URL.create protège les caractères spéciaux des identifiants de connexion.
    url = URL.create(
        "postgresql+pg8000",
        username=utilisateur, password=mot_de_passe,
        host=hote, port=port, database=nom_base,
    )
    # create_engine ne se connecte pas ; la connexion intervient dans connect/begin.
    return create_engine(
        url, pool_pre_ping=True, pool_recycle=1800,
        hide_parameters=True, connect_args={"timeout": 5},
    )

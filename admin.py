"""Création manuelle d’un Admin réel : exécuter python admin.py."""

from getpass import getpass

from pydantic import ValidationError
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from database import DatabaseConfigurationError, get_engine
from schemas import LoginRequest
from security import hash_password


def main():
    nom = input("Nom de l’Admin : ").strip()
    email = input("Email de l’Admin : ").strip().lower()
    password = getpass("Mot de passe : ")
    confirmation = getpass("Confirmer le mot de passe : ")
    if not nom or len(password) < 12 or password != confirmation:
        print("Nom requis ; mot de passe d’au moins 12 caractères et confirmation identique.")
        return 1
    try:
        credentials = LoginRequest(email=email, password=password)
    except ValidationError:
        print("Adresse e-mail ou longueur du mot de passe invalide.")
        return 1

    try:
        with get_engine().begin() as connection:
            existing = connection.execute(
                text("SELECT id FROM admins WHERE lower(email) = lower(:email)"),
                {"email": str(credentials.email)},
            ).first()
            if existing:
                print("Un Admin utilise déjà cette adresse e-mail.")
                return 1
            connection.execute(
                text("INSERT INTO admins (nom, email, password) VALUES (:nom, :email, :password)"),
                {"nom": nom, "email": str(credentials.email), "password": hash_password(password)},
            )
    except (DatabaseConfigurationError, SQLAlchemyError):
        # Ne pas afficher la requête SQL, les paramètres ou les identifiants de connexion.
        print("Création impossible. Vérifiez la configuration, la base et les contraintes de la table admins.")
        return 1
    print("Admin créé avec succès !")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

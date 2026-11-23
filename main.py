"""API UMBB : lectures publiques et gestion des annonces réservée aux Admins."""

import os
from typing import Annotated
from urllib.parse import urlsplit
import logging

from fastapi import Depends, FastAPI, HTTPException, Path, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from auth import (
    AuthConfigurationError, create_access_token, get_auth_settings,
    get_current_admin, unauthorized,
)
from database import DatabaseConfigurationError, get_engine
from schemas import AnnonceRequest, LoginRequest, TokenResponse
from security import hash_password, verify_password

app = FastAPI()
logger = logging.getLogger(__name__)

def cors_origins():
    # Une origine contient seulement le protocole, l’hôte et le port éventuel.
    configuration = os.getenv("CORS_ORIGINS", "http://127.0.0.1:5500,http://localhost:5500")
    origines = []
    for origine in configuration.split(","):
        origine = origine.strip()
        if not origine:
            continue
        adresse = urlsplit(origine)
        origine_valide = (
            adresse.scheme in ("http", "https") and adresse.hostname and
            not adresse.username and not adresse.password and not adresse.path and
            not adresse.query and not adresse.fragment and "*" not in origine
        )
        if not origine_valide:
            raise ValueError("CORS_ORIGINS doit contenir des origines HTTP(S) exactes, sans chemin.")
        origines.append(origine)
    return origines


# Middleware externe : les erreurs HTTP reçoivent elles aussi les en-têtes CORS.
# Pas de cookies : fetch transmettra Authorization: Bearer <token>.
@app.exception_handler(DatabaseConfigurationError)
@app.exception_handler(SQLAlchemyError)
async def database_unavailable(request: Request, exception: Exception):
    logger.exception("Erreur PostgreSQL")
    return JSONResponse(
        status_code=503,
        content={"detail": "Le service de données est momentanément indisponible."}
    )

@app.exception_handler(AuthConfigurationError)
async def auth_unavailable(request: Request, exception: Exception):
    return JSONResponse(status_code=503, content={"detail": "Le service d’authentification n’est pas configuré."})


@app.exception_handler(RequestValidationError)
async def invalid_request(request: Request, exception: RequestValidationError):
    # La validation ne renvoie ni le corps brut ni un éventuel mot de passe.
    erreurs = []
    for erreur in exception.errors():
        erreurs.append({
            "loc": erreur["loc"],
            "msg": erreur["msg"],
            "type": erreur["type"],
        })
    return JSONResponse(status_code=422, content={"detail": erreurs})


@app.get("/")
def home():
    return {"message": "Bienvenue sur le site de la Faculté des Sciences"}


@app.get("/faculte")
def get_faculte():
    with get_engine().connect() as connection:
        faculte = connection.execute(text("SELECT * FROM facultes")).mappings().first()
    if faculte is None:
        return {"message": "Aucune faculté trouvée"}
    return {"id": faculte["id"], "nom": faculte["nom"],
            "campus": faculte["campus"], "description": faculte["description"]}


@app.get("/departements")
def get_departements():
    with get_engine().connect() as connection:
        result = connection.execute(text("SELECT * FROM departements ORDER BY id"))
        return [dict(dep) for dep in result.mappings().all()]


@app.get("/annonces")
def get_annonces():
    with get_engine().connect() as connection:
        result = connection.execute(text("SELECT * FROM annonces ORDER BY date_annonce DESC"))
        return [dict(annonce) for annonce in result.mappings().all()]


@app.post("/auth/login", response_model=TokenResponse)
def login(credentials: LoginRequest, response: Response):
    get_auth_settings()  # Pas de token si le secret n’a pas été configuré.
    with get_engine().connect() as connection:
        admins = connection.execute(
            text("SELECT id, nom, email, password FROM admins WHERE lower(email) = lower(:email)"),
            {"email": str(credentials.email)},
        ).mappings().all()
    password = credentials.password.get_secret_value()
    # Une adresse ambiguë (doublons historiques) n’authentifie personne.
    if len(admins) != 1:
        hash_password(password)  # Coût comparable à une vérification, sans stockage.
        raise unauthorized()
    if not verify_password(password, admins[0]["password"]):
        raise unauthorized()
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"
    return create_access_token(admins[0]["id"])


@app.get("/auth/me")
def current_admin(admin: Annotated[dict, Depends(get_current_admin)]):
    return admin


@app.post("/annonces", status_code=201)
def create_annonce(data: AnnonceRequest, admin: Annotated[dict, Depends(get_current_admin)]):
    # Seule l’identité vérifiée par l’authentification est utilisée pour admin_id.
    parameters = data.model_dump()
    parameters["admin_id"] = admin["id"]
    with get_engine().begin() as connection:
        connection.execute(
            text("""
                INSERT INTO annonces (admin_id, titre, date_annonce, categorie, description)
                VALUES (:admin_id, :titre, :date_annonce, :categorie, :description)
            """), parameters,
        )
    return {"message": "Annonce créée avec succès"}


@app.put("/annonces/{annonce_id}")
def update_annonce(
    data: AnnonceRequest,
    annonce_id: Annotated[int, Path(ge=1, le=9223372036854775807)],
    admin: Annotated[dict, Depends(get_current_admin)],
):
    parameters = data.model_dump()
    parameters["annonce_id"] = annonce_id
    with get_engine().begin() as connection:
        result = connection.execute(
            text("""
                UPDATE annonces SET titre = :titre, date_annonce = :date_annonce,
                    categorie = :categorie, description = :description
                WHERE id = :annonce_id
            """), parameters,
        )
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Annonce introuvable")
    return {"message": "Annonce modifiée avec succès"}


@app.delete("/annonces/{annonce_id}")
def delete_annonce(
    annonce_id: Annotated[int, Path(ge=1, le=9223372036854775807)],
    admin: Annotated[dict, Depends(get_current_admin)],
):
    with get_engine().begin() as connection:
        result = connection.execute(
            text("DELETE FROM annonces WHERE id = :annonce_id"), {"annonce_id": annonce_id},
        )
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Annonce introuvable")
    return {"message": "Annonce supprimée avec succès"}


app = CORSMiddleware(
    app, allow_origins=cors_origins(), allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)

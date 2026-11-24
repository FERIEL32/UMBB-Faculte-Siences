from pwdlib import PasswordHash
from pwdlib.exceptions import UnknownHashError

password_hash = PasswordHash.recommended()

def hash_password(password):
    return password_hash.hash(password)


def verify_password(password, hashed_password):
    """Comparer la saisie au hash admins.password, sans modifier le mot de passe."""
    if not isinstance(password, str) or not isinstance(hashed_password, str):
        return False
    try:
        return password_hash.verify(password, hashed_password)
    except (UnknownHashError, ValueError):
        # Un hash absent, invalide ou non pris en charge n’authentifie jamais un Admin.
        return False

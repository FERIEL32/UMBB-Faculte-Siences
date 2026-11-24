/*
  UMBB - lecture publique, connexion Admin et annonces via FastAPI.
  Le token reste uniquement en mémoire ; le mot de passe n’est jamais conservé.
*/

// À adapter à l’adresse du serveur FastAPI de votre équipe (sans / final)
var URL_FASTAPI = "https://umbb-faculte-siences.onrender.com";
var DELAI_API = 8000;

var champsAnnonce = ["titre", "date", "categorie", "description"];

var identifiantEnCours = null;
/* ---------- Donnees publiques FastAPI ---------- */
var faculteApi = null;
var departementsApi = [];
var annoncesApi = [];
var etatsApi = {faculte: 'chargement', departements: 'chargement', annonces: 'chargement'};
var chargementEnCours = false;
var actualisationAnnonces = false;
var numeroLectureAnnonces = 0;

function texteValide(valeur) {
  return typeof valeur === 'string' && valeur.trim().length > 0;
}
function idValide(valeur) {
  return (Number.isInteger(valeur) && valeur > 0) || (typeof valeur === 'string' && /^\d+$/.test(valeur));
}

// FastAPI sérialise une date SQL en YYYY-MM-DD ; un horodatage ISO est aussi accepté.
// On conserve le jour écrit par le serveur, sans décalage de fuseau horaire.
function normaliserDateApi(valeur) {
  if (typeof valeur !== 'string') return '';
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(valeur)) return '';
  var jour = valeur.slice(0, 10);
  return dateValide(jour) ? jour : '';
}

// Contrat lu dans main.py : objet faculté OU {message: "Aucune faculté trouvée"}.
function faculteDepuisApi(donnee) {
  if (donnee && donnee.message === 'Aucune faculté trouvée') return null;
  if (!donnee || !idValide(donnee.id) || !texteValide(donnee.nom) ||
      (donnee.campus != null && typeof donnee.campus !== 'string') ||
      (donnee.description != null && typeof donnee.description !== 'string')) {
    throw new Error('Réponse /faculte inattendue');
  }
  return {id: donnee.id, nom: donnee.nom, campus: donnee.campus || '', description: donnee.description || ''};
}

// /departements et /annonces renvoient directement des listes de lignes SQL.
function departementsDepuisApi(donnees) {
  if (!Array.isArray(donnees)) throw new Error('Réponse /departements inattendue');
  return donnees.map(function (d) {
    if (!d || !idValide(d.id) || !idValide(d.faculte_id) || !texteValide(d.nom) ||
        (d.description != null && typeof d.description !== 'string')) {
      throw new Error('Département invalide');
    }
    return {id: d.id, faculte_id: d.faculte_id, nom: d.nom, description: d.description || ''};
  });
}
function annonceDepuisApi(donnee) {
  if (!donnee || !idValide(donnee.id) || !texteValide(donnee.titre) ||
      (donnee.categorie != null && typeof donnee.categorie !== 'string') ||
      (donnee.description != null && typeof donnee.description !== 'string')) {
    throw new Error('Annonce invalide');
  }
  // Le nom date_annonce vient du Back-End ; date reste le nom utilisé par le rendu existant.
  return {identifiant: String(donnee.id), admin_id: donnee.admin_id, titre: donnee.titre,
    date: normaliserDateApi(donnee.date_annonce), categorie: donnee.categorie || 'Université',
    description: donnee.description || ''};
}
function annoncesDepuisApi(donnees) {
  if (!Array.isArray(donnees)) throw new Error('Réponse /annonces inattendue');
  return donnees.map(annonceDepuisApi);
}

function erreurApi(message, statut) {
  var erreur = new Error(message);
  erreur.statut = statut || 0;
  return erreur;
}

async function requeteApi(route, methode, donnees, token) {
  var controleur = new AbortController();
  var minuterie = setTimeout(function () { controleur.abort(); }, DELAI_API);
  var options = {
    method: methode || 'GET', headers: {Accept: 'application/json'},
    credentials: 'omit', signal: controleur.signal
  };
  if (donnees) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(donnees);
  }
  if (token) options.headers.Authorization = 'Bearer ' + token;
  try {
    var reponse = await fetch(URL_FASTAPI.replace(/\/+$/, '') + route, options);
    var contenu = null;
    try { contenu = await reponse.json(); }
    catch (erreur) {
      if (erreur.name === 'AbortError') throw erreur;
      // Traiter le statut même si le JSON est illisible.
    }
    if (!reponse.ok) {
      var message = 'Une erreur du serveur empêche cette opération. Réessayez plus tard.';
      if (reponse.status === 401) message = route === '/auth/login' ?
        'Adresse e-mail ou mot de passe incorrect.' : 'Votre session a expiré ou n’est plus valide. Reconnectez-vous.';
      if (reponse.status === 403) message = 'Vous n’avez pas l’autorisation d’effectuer cette opération.';
      if (reponse.status === 404) message = 'Cette annonce est introuvable. Actualisez la liste.';
      if (reponse.status === 422) message = 'Les informations saisies ne sont pas valides. Vérifiez les champs du formulaire.';
      if (reponse.status === 503) message = 'Le service est momentanément indisponible. Réessayez plus tard.';
      var echec = erreurApi(message, reponse.status);
      if (reponse.status === 422 && contenu && Array.isArray(contenu.detail)) {
        echec.champs = {};
        contenu.detail.forEach(function (detail) {
          if (!Array.isArray(detail.loc)) return;
          var champ = detail.loc[detail.loc.length - 1];
          if (champ === 'date_annonce') champ = 'date';
          if (champsAnnonce.includes(champ)) echec.champs[champ] = 'Vérifiez ce champ et ses limites de saisie.';
        });
      }
      throw echec;
    }
    if (!contenu || typeof contenu !== 'object') {
      throw erreurApi('La réponse du serveur est invalide. L’opération n’a pas pu être confirmée.', reponse.status);
    }
    return contenu;
  } catch (erreur) {
    if (erreur.statut) throw erreur;
    if (erreur.name === 'AbortError') {
      throw erreurApi('Le serveur met trop de temps à répondre. L’opération n’a pas pu être confirmée. Actualisez la liste avant de réessayer.');
    }
    throw erreurApi('Impossible de joindre le service. Vérifiez votre connexion. L’opération n’a pas pu être confirmée.');
  } finally {
    clearTimeout(minuterie);
  }
}

async function lireApi(route) {
  return await requeteApi(route, 'GET');
}

async function requeteAdmin(route, methode, donnees) {
  if (!sessionValide()) {
    expirerSession();
    throw erreurApi('Votre session a expiré. Reconnectez-vous.', 401);
  }
  var session = numeroSession;
  try {
    var reponse = await requeteApi(route, methode, donnees, tokenAdmin);
    if (session !== numeroSession) {
      var annulation = erreurApi('La session a changé.');
      annulation.annulee = true;
      throw annulation;
    }
    return reponse;
  } catch (erreur) {
    if (session !== numeroSession) erreur.annulee = true;
    else if (erreur.statut === 401) expirerSession();
    throw erreur;
  }
}

async function rechargerAnnonces() {
  if (actualisationAnnonces) return false;
  actualisationAnnonces = true;
  etatsApi.annonces = 'chargement';
  rafraichirAnnonces();
  try {
    return await chargerRessource('annonces');
  } finally {
    actualisationAnnonces = false;
    rafraichirAnnonces();
  }
}


async function chargerRessource(nom) {
  var lecture = nom === 'annonces' ? ++numeroLectureAnnonces : 0;
  var reussi = false;
  try {
    var donnees = await lireApi('/' + nom);
    // Une ancienne lecture ne doit pas remplacer la liste rechargée après une écriture.
    if (nom === 'annonces' && lecture !== numeroLectureAnnonces) return false;
    if (nom === 'faculte') faculteApi = faculteDepuisApi(donnees);
    if (nom === 'departements') departementsApi = departementsDepuisApi(donnees);
    if (nom === 'annonces') annoncesApi = annoncesDepuisApi(donnees);
    etatsApi[nom] = 'pret';
    reussi = true;
  } catch (erreur) {
    if (nom === 'annonces' && lecture !== numeroLectureAnnonces) return false;
    etatsApi[nom] = 'erreur';
    console.warn('Chargement FastAPI /' + nom + ' impossible :', erreur.message);
  }
  rafraichirPublic();
  afficherAdministration();
  return reussi;
}

async function chargerDonneesPubliques() {
  if (chargementEnCours) return;
  chargementEnCours = true;
  faculteApi = null;
  departementsApi = [];
  annoncesApi = [];
  etatsApi = {faculte: 'chargement', departements: 'chargement', annonces: 'chargement'};
  rafraichirPublic();
  try {
    // Les trois lectures sont indépendantes : une erreur n’efface pas les autres résultats.
    await Promise.all(['faculte', 'departements', 'annonces'].map(chargerRessource));
  } finally {
    chargementEnCours = false;
    rafraichirPublic();
  }
}

function afficherEtat(conteneur, message, peutReessayer) {
  var zone = creerElement('div', 'etat-vide');
  zone.setAttribute('role', 'status');
  zone.appendChild(creerElement('p', '', message));
  if (peutReessayer && !chargementEnCours) {
    var bouton = creerElement('button', 'bouton-texte', 'Réessayer');
    bouton.type = 'button';
    bouton.addEventListener('click', chargerDonneesPubliques);
    zone.appendChild(bouton);
  }
  conteneur.appendChild(zone);
}

function afficherFaculte() {
  var faculte = faculteApi;
  var titre = document.getElementById('titre-accueil');
  // Le <em> et les retours à la ligne de la composition existante sont conservés.
  titre.firstChild.textContent = faculte ? faculte.nom : 'Faculté des Sciences';
  var paragraphes = document.querySelectorAll('#faculte .texte-editorial > p');
  var introduction = document.querySelector('#accueil .introduction');
  var surtitre = document.querySelector('#departements .surtitre');
  var chapo = document.querySelector('#departements .chapo');
  chapo.textContent = 'Explorez les disciplines de la Faculté et construisez votre parcours.';
  if (faculte) {
    introduction.textContent = faculte.description || 'Bienvenue à la ' + faculte.nom + '.';
    paragraphes[0].textContent = faculte.description || 'Découvrez les départements de la Faculté.';
    paragraphes[1].textContent = faculte.campus;
    surtitre.textContent = faculte.nom + (faculte.campus ? ' · ' + faculte.campus : '');
  } else {
    introduction.textContent = 'Bienvenue sur le site de la Faculté des Sciences de l’Université M’hamed Bougara de Boumerdès.';
    paragraphes[0].textContent = etatsApi.faculte === 'chargement' ? 'Chargement des informations de la faculté…' :
      etatsApi.faculte === 'erreur' ? 'Les informations de la faculté sont momentanément indisponibles.' :
      'Les informations de la faculté ne sont pas encore publiées.';
    paragraphes[1].textContent = '';
    surtitre.textContent = 'Faculté des Sciences';
  }
  var ancienBouton = document.getElementById('reessayer-faculte');
  if (ancienBouton) ancienBouton.remove();
  if (etatsApi.faculte === 'erreur' && !chargementEnCours) {
    var bouton = creerElement('button', 'bouton-texte', 'Réessayer');
    bouton.id = 'reessayer-faculte';
    bouton.type = 'button';
    bouton.addEventListener('click', chargerDonneesPubliques);
    paragraphes[1].appendChild(bouton);
  }
}

function rafraichirPublic() {
  afficherFaculte();
  afficherDepartements();
  afficherActualites();
}

/* ---------- Outils ---------- */

function creerElement(nom, classe, texte) {
  var element = document.createElement(nom);
  if (classe) {
    element.className = classe;
  }
  if (texte) {
    element.textContent = texte;
  }
  return element;
}

function formaterDate(dateIso) {
  dateIso = normaliserDateApi(dateIso);
  if (!dateIso) return "Date non précisée";
  var parties = dateIso.split("-");
  var date = new Date(Number(parties[0]), Number(parties[1]) - 1, Number(parties[2]));
  return date.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric"
  });
}

function trierAnnonces(liste) {
  return liste.slice().sort(function (a, b) {
    return (normaliserDateApi(b.date) || "").localeCompare(normaliserDateApi(a.date) || "");
  });
}

/* ---------- Affichage des départements ---------- */

function afficherDepartements() {
  var conteneur = document.getElementById("liste-departements");
  conteneur.innerHTML = "";
  if (etatsApi.departements !== 'pret') {
    afficherEtat(conteneur, etatsApi.departements === 'chargement' ?
      'Chargement des départements…' : 'Les départements sont momentanément indisponibles.',
      etatsApi.departements === 'erreur');
    return;
  }
  var faculte = faculteApi;
  var departements = departementsApi;
  if (!faculte) {
    afficherEtat(conteneur, etatsApi.faculte === 'chargement' ? 'Chargement de la faculté…' :
      'Les départements seront présentés avec les informations de la faculté.', etatsApi.faculte === 'erreur');
    return;
  }
  var liste = departements.filter(function (departement) {
    return String(departement.faculte_id) === String(faculte.id);
  });
  if (!liste.length) {
    afficherEtat(conteneur, 'Aucun département à afficher pour le moment.', false);
    return;
  }
  liste.forEach(function (departement) {
    var article = creerElement("article", "departement");
    article.appendChild(creerElement("p", "type-departement", faculte.nom));
    article.appendChild(creerElement("h3", "", departement.nom));
    article.appendChild(creerElement("p", "", departement.description || ''));
    conteneur.appendChild(article);
  });
}

/* ---------- Affichage des actualités ---------- */

function ajouterMeta(parent, annonce) {
  var meta = creerElement("p", "meta-actualite");

  meta.appendChild(creerElement("span", "categorie", annonce.categorie));

  var dateIso = normaliserDateApi(annonce.date);
  var date = creerElement("time", "", formaterDate(annonce.date));
  if (dateIso) date.setAttribute("datetime", dateIso);
  meta.appendChild(date);

  parent.appendChild(meta);
}

function creerArticleActualite(annonce, estUne) {
  var classe = estUne ? "actualite actualite-une" : "actualite";
  var article = creerElement("article", classe);

  ajouterMeta(article, annonce);
  article.appendChild(creerElement("h3", "", annonce.titre));
  article.appendChild(creerElement("p", "", annonce.description));
  return article;
}

function afficherActualites() {
  var conteneur = document.getElementById("liste-actualites");
  var annonces = trierAnnonces(annoncesApi);

  conteneur.innerHTML = "";
  if (etatsApi.annonces !== 'pret') {
    conteneur.classList.add('journal-simple');
    afficherEtat(conteneur, etatsApi.annonces === 'chargement' ?
      'Chargement des annonces…' : 'Les annonces sont momentanément indisponibles.',
      etatsApi.annonces === 'erreur');
    return;
  }

  if (annonces.length === 0) {
    conteneur.classList.add("journal-simple");
    var vide = creerElement('div', 'actualites-vides');
    vide.appendChild(creerElement('span', 'symbole-journal', '—'));
    var texte = creerElement('div');
    texte.appendChild(creerElement('h3', '', 'L’information, au bon moment.'));
    texte.appendChild(creerElement('p', '', 'Aucune annonce publiée pour le moment. Les prochaines informations seront réunies ici.'));
    vide.appendChild(texte);
    var lien = creerElement('a', 'lien-fleche', 'Consulter le portail institutionnel ↗');
    lien.href = 'https://umbb.univ-boumerdes.dz/';
    vide.appendChild(lien);
    conteneur.appendChild(vide);
    return;
  }

  conteneur.classList.toggle("journal-simple", annonces.length === 1);
  conteneur.appendChild(creerArticleActualite(annonces[0], true));

  if (annonces.length > 1) {
    var suite = creerElement("div", "suite-actualites");
    for (var i = 1; i < annonces.length; i++) {
      suite.appendChild(creerArticleActualite(annonces[i], false));
    }
    conteneur.appendChild(suite);
  }
}

/* ---------- Administration ---------- */

function texteCompteur(nombre) {
  if (nombre === 0) {
    return "Aucune annonce enregistrée.";
  }
  if (nombre === 1) {
    return "1 annonce enregistrée.";
  }
  return nombre + " annonces enregistrées.";
}

function afficherAdministration() {
  var conteneur = document.getElementById("liste-administration");
  var annonces = trierAnnonces(annoncesApi);

  mettreAJourEtatFormulaire();
  if (!sessionValide()) {
    conteneur.innerHTML = '';
    document.getElementById('compteur-annonces').textContent = '';
    return;
  }
  if (etatsApi.annonces !== 'pret') {
    conteneur.innerHTML = '';
    document.getElementById('compteur-annonces').textContent = '';
    afficherEtat(conteneur, etatsApi.annonces === 'chargement' ? 'Chargement des annonces…' :
      'Les annonces sont momentanément indisponibles. Utilisez « Actualiser les annonces ». ', false);
    return;
  }
  document.getElementById("compteur-annonces").textContent = texteCompteur(annonces.length);
  conteneur.innerHTML = "";

  if (annonces.length === 0) {
    conteneur.appendChild(creerElement("p", "etat-vide", "La liste est vide. Publiez une première annonce avec le formulaire."));
    return;
  }

  annonces.forEach(function (annonce) {
    var bloc = creerElement("article", "element-admin");
    ajouterMeta(bloc, annonce);
    bloc.appendChild(creerElement("h4", "", annonce.titre));
    bloc.appendChild(creerElement("p", "description", annonce.description));

    var actions = creerElement("div", "actions-admin");
    var modifier = creerElement("button", "bouton-texte bouton-modifier", "Modifier");
    var supprimer = creerElement("button", "bouton-texte bouton-supprimer", "Supprimer");

    modifier.type = "button";
    supprimer.type = "button";
    modifier.setAttribute("data-id", annonce.identifiant);
    supprimer.setAttribute("data-id", annonce.identifiant);

    actions.appendChild(modifier);
    actions.appendChild(supprimer);
    bloc.appendChild(actions);
    conteneur.appendChild(bloc);
  });
  mettreAJourEtatFormulaire();
}

function rafraichirAnnonces() {
  afficherActualites();
  afficherAdministration();
}

function afficherMessage(texte, type) {
  var zone = document.getElementById("message-formulaire");
  zone.textContent = texte;
  zone.className = "message-formulaire" + (type ? " " + type : "");
}

function effacerErreurs() {
  champsAnnonce.forEach(function (champ) {
    document.getElementById("erreur-" + champ).textContent = "";
    document.getElementById(champ).classList.remove("invalide");
    document.getElementById(champ).removeAttribute("aria-invalid");
  });
}

function afficherErreurs(erreurs) {
  champsAnnonce.forEach(function (champ) {
    var zone = document.getElementById("erreur-" + champ);
    var saisie = document.getElementById(champ);
    zone.textContent = erreurs[champ] || "";
    saisie.classList.toggle("invalide", Boolean(erreurs[champ]));
    saisie.setAttribute("aria-invalid", Boolean(erreurs[champ]));
  });
}

function lireFormulaire() {
  return {
    titre: document.getElementById("titre").value.trim(),
    date: document.getElementById("date").value,
    categorie: document.getElementById("categorie").value,
    description: document.getElementById("description").value.trim()
  };
}

function dateValide(valeur) {
  if (typeof valeur !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valeur)) return false;
  var date = new Date(valeur + 'T12:00:00Z');
  return !isNaN(date.getTime()) && date.toISOString().slice(0, 10) === valeur;
}
function validerFormulaire(donnees) {
  var erreurs = {};

  if (typeof donnees.titre !== "string" || donnees.titre.length < 4 || donnees.titre.length > 140) {
    erreurs.titre = "Le titre doit contenir entre 4 et 140 caractères.";
  }

  if (!dateValide(donnees.date)) {
    erreurs.date = "Choisissez une date.";
  }

  if (!["Université", "Scolarité", "Recherche", "Vie étudiante"].includes(donnees.categorie)) {
    erreurs.categorie = "Choisissez une catégorie.";
  }

  if (typeof donnees.description !== "string" || donnees.description.length < 15 || donnees.description.length > 600) {
    erreurs.description = "La description doit contenir entre 15 et 600 caractères.";
  }

  return erreurs;
}

function reinitialiserFormulaire() {
  document.getElementById("formulaire-annonce").reset();
  identifiantEnCours = null;
  document.getElementById("titre-formulaire").textContent = "Ajouter une annonce";
  document.getElementById("bouton-enregistrer").textContent = "Publier l'annonce";
  document.getElementById("bouton-annuler").hidden = true;
  effacerErreurs();
}

function preparerModification(identifiant) {
  if (operationEnCours || actualisationAnnonces) return;
  if (!sessionValide()) { expirerSession(); return; }
  var annonce = null;

  var liste = annoncesApi;
  liste.forEach(function (element) {
    if (element.identifiant === identifiant) {
      annonce = element;
    }
  });

  if (!annonce) {
    return;
  }

  identifiantEnCours = annonce.identifiant;
  document.getElementById("titre").value = annonce.titre;
  document.getElementById("date").value = annonce.date;
  document.getElementById("categorie").value = annonce.categorie;
  document.getElementById("description").value = annonce.description;
  document.getElementById("titre-formulaire").textContent = "Modifier l'annonce";
  document.getElementById("bouton-enregistrer").textContent = "Enregistrer la modification";
  document.getElementById("bouton-annuler").hidden = false;
  effacerErreurs();
  document.getElementById("titre").focus();
  afficherMessage("Modifiez les champs, puis enregistrez vos changements.", "");
  document.getElementById("formulaire-annonce").scrollIntoView({ behavior: "smooth", block: "center" });
}

async function executerOperationAnnonce(methode, identifiant, donnees) {
  if (operationEnCours || actualisationAnnonces) return;
  if (!sessionValide()) { expirerSession(); return; }
  if (identifiant !== null && !idValide(identifiant)) {
    afficherMessage('Cette annonce ne possède pas d’identifiant valide.', 'erreur');
    return;
  }
  var session = numeroSession;
  var route = '/annonces' + (identifiant === null ? '' : '/' + encodeURIComponent(identifiant));
  var corps = donnees ? {
    titre: donnees.titre, date_annonce: donnees.date,
    categorie: donnees.categorie, description: donnees.description
  } : null;
  operationEnCours = true;
  mettreAJourEtatFormulaire();
  afficherMessage('Traitement en cours…', '');
  try {
    var reponse = await requeteAdmin(route, methode, corps);
    if (!texteValide(reponse.message)) {
      throw new Error('La réponse du serveur est invalide. Actualisez la liste pour vérifier l’opération.');
    }
    if (methode !== 'DELETE' || identifiantEnCours === identifiant) reinitialiserFormulaire();
    var actualise = await rechargerAnnonces();
    if (session !== numeroSession) return;
    var message = methode === 'POST' ? 'Annonce enregistrée.' :
      methode === 'PUT' ? 'Annonce mise à jour.' : 'Annonce supprimée.';
    afficherMessage(message + (actualise ? '' : ' La liste n’a pas pu être actualisée. Utilisez « Actualiser les annonces ».'), actualise ? 'ok' : 'erreur');
  } catch (erreur) {
    if (session !== numeroSession || erreur.annulee) return;
    if (erreur.champs) afficherErreurs(erreur.champs);
    afficherMessage(erreur.message, 'erreur');
  } finally {
    if (session === numeroSession) {
      operationEnCours = false;
      mettreAJourEtatFormulaire();
    }
  }
}

async function supprimerAnnonce(identifiant) {
  if (operationEnCours || actualisationAnnonces) return;
  if (!sessionValide()) { expirerSession(); return; }
  if (!window.confirm('Supprimer définitivement cette annonce ?')) return;
  await executerOperationAnnonce('DELETE', identifiant, null);
}

async function soumettreFormulaire(evenement) {
  evenement.preventDefault();
  if (operationEnCours || actualisationAnnonces) return;
  if (!sessionValide()) { expirerSession(); return; }
  var donnees = lireFormulaire();
  var erreurs = validerFormulaire(donnees);
  afficherErreurs(erreurs);
  if (Object.keys(erreurs).length) {
    afficherMessage('Veuillez corriger les champs indiqués.', 'erreur');
    document.getElementById(Object.keys(erreurs)[0]).focus();
    return;
  }
  await executerOperationAnnonce(identifiantEnCours === null ? 'POST' : 'PUT', identifiantEnCours, donnees);
}


function preparerFormulaire() {
  var formulaire = document.getElementById("formulaire-annonce");
  var liste = document.getElementById("liste-administration");

  formulaire.addEventListener("submit", soumettreFormulaire);

  document.getElementById("bouton-annuler").addEventListener("click", function () {
    if (operationEnCours) return;
    reinitialiserFormulaire();
    afficherMessage("Modification annulée.", "");
  });

  champsAnnonce.forEach(function (champ) {
    document.getElementById(champ).addEventListener("input", function () {
      document.getElementById("erreur-" + champ).textContent = "";
      this.classList.remove("invalide");
      this.removeAttribute("aria-invalid");
      afficherMessage("", "");
    });
  });

  /* Un seul écouteur pour Modifier et Supprimer, même après un nouvel affichage. */
  liste.addEventListener("click", function (evenement) {
    var bouton = evenement.target.closest("button");
    if (!bouton) {
      return;
    }

    var identifiant = bouton.getAttribute("data-id");
    if (bouton.classList.contains("bouton-modifier")) {
      preparerModification(identifiant);
    }
    if (bouton.classList.contains("bouton-supprimer")) {
      supprimerAnnonce(identifiant);
    }
  });
}

/* ---------- Navigation ---------- */

function fermerMenu() {
  var menu = document.getElementById("navigation");
  var bouton = document.getElementById("bouton-menu");
  menu.classList.remove("est-ouverte");
  bouton.classList.remove("est-ouvert");
  bouton.setAttribute("aria-expanded", "false");
  bouton.setAttribute("aria-label", "Ouvrir le menu");
}

function preparerNavigation() {
  var bouton = document.getElementById("bouton-menu");
  var menu = document.getElementById("navigation");
  var liens = menu.querySelectorAll("a");

  bouton.addEventListener("click", function () {
    var ouvert = menu.classList.toggle("est-ouverte");
    bouton.classList.toggle("est-ouvert", ouvert);
    bouton.setAttribute("aria-expanded", ouvert ? "true" : "false");
    bouton.setAttribute("aria-label", ouvert ? "Fermer le menu" : "Ouvrir le menu");
  });

  liens.forEach(function (lien) {
    lien.addEventListener("click", fermerMenu);
  });

  document.addEventListener("keydown", function (evenement) {
    if (evenement.key === "Escape") {
      var etaitOuvert = bouton.getAttribute("aria-expanded") === "true";
      fermerMenu();
      if (etaitOuvert) bouton.focus();
    }
  });

  document.addEventListener("click", function (evenement) {
    if (!menu.classList.contains("est-ouverte")) {
      return;
    }
    if (menu.contains(evenement.target) || bouton.contains(evenement.target)) {
      return;
    }
    fermerMenu();
  });

  /* Souligne le lien de la section visible à l'écran. */
  var sections = document.querySelectorAll("main section");
  var observateur = new IntersectionObserver(function (entrees) {
    entrees.forEach(function (entree) {
      if (!entree.isIntersecting) {
        return;
      }
      liens.forEach(function (lien) {
        var actif = lien.getAttribute("href") === "#" + entree.target.id;
        lien.classList.toggle("est-actif", actif);
        if (actif) {
          lien.setAttribute("aria-current", "true");
        } else {
          lien.removeAttribute("aria-current");
        }
      });
    });
  }, { rootMargin: "-40% 0px -45% 0px" });

  sections.forEach(function (section) {
    observateur.observe(section);
  });
}

/* Si une photo illustrative ne se charge pas, on garde un cadre élégant. */
function preparerImages() {
  var images = document.querySelectorAll(".photo-hero img");

  images.forEach(function (image) {
    function signalerAbsence() {
      image.parentElement.classList.add("sans-image");
    }

    if (image.complete && image.naturalWidth === 0) {
      signalerAbsence();
      return;
    }

    image.addEventListener("error", signalerAbsence);
  });
}

function demarrer() {
  rafraichirPublic();
  afficherAdministration();
  preparerNavigation();
  preparerFormulaire();
  preparerConnexion();
  preparerImages();
  champsAnnonce.forEach(function (id) {
    var champ = document.getElementById(id);
    champ.required = true;
    champ.setAttribute('aria-describedby', 'erreur-' + id);
  });
  window.addEventListener('hashchange', afficherPage);
  afficherPage();
  chargerDonneesPubliques();
}

/* ---------- Session Admin : token et identité uniquement en mémoire ---------- */
var tokenAdmin = '';
var adminConnecte = null;
var expirationSession = 0;
var minuterieSession = null;
var numeroSession = 0;
var connexionEnCours = false;
var operationEnCours = false;

function sessionValide() {
  return Boolean(tokenAdmin && adminConnecte && Date.now() < expirationSession);
}

function afficherMessageConnexion(texte, erreur) {
  var zone = document.getElementById('message-connexion');
  zone.textContent = texte;
  zone.className = 'message-formulaire' + (erreur ? ' erreur' : '');
}

function viderSession() {
  // Le numéro permet d’ignorer une réponse reçue après déconnexion ou changement de mode.
  numeroSession++;
  tokenAdmin = '';
  adminConnecte = null;
  expirationSession = 0;
  clearTimeout(minuterieSession);
  minuterieSession = null;
  connexionEnCours = false;
  operationEnCours = false;
  document.getElementById('bouton-connexion').disabled = false;
}

function effacerErreursConnexion() {
  ['email', 'mot-de-passe'].forEach(function (id) {
    document.getElementById('erreur-' + id).textContent = '';
    document.getElementById(id).removeAttribute('aria-invalid');
  });
}

function quitterAdministration() {
  viderSession();
  document.getElementById('formulaire-connexion').reset();
  effacerErreursConnexion();
  reinitialiserFormulaire();
  afficherMessage('', '');
  afficherMessageConnexion('', false);
  rafraichirPublic();
  afficherAdministration();
  location.hash = '#connexion';
}

function expirerSession() {
  quitterAdministration();
  afficherMessageConnexion('Votre session a expiré ou n’est plus valide. Reconnectez-vous.', true);
}

function mettreAJourEtatFormulaire() {
  var autorise = sessionValide();
  var bloque = operationEnCours || actualisationAnnonces || !autorise;
  champsAnnonce.forEach(function (id) { document.getElementById(id).disabled = bloque; });
  document.getElementById('bouton-enregistrer').disabled = bloque;
  document.getElementById('bouton-annuler').disabled = bloque;
  document.querySelectorAll('#liste-administration button').forEach(function (bouton) {
    bouton.disabled = bloque;
  });
  var actualiser = document.getElementById('bouton-actualiser-annonces');
  actualiser.hidden = !sessionValide();
  actualiser.disabled = operationEnCours || actualisationAnnonces;
  document.getElementById('formulaire-annonce').setAttribute('aria-busy', operationEnCours ? 'true' : 'false');
  document.getElementById('note-administration').textContent =
    autorise ? 'Mode réel — ' + adminConnecte.nom + '. Les annonces sont enregistrées par le service de la Faculté.' :
    'Connectez-vous avec votre compte administrateur pour gérer les annonces.';
}

function validerConnexion(email, motDePasse) {
  var erreurs = {};
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    erreurs.email = 'Indiquez une adresse e-mail valide.';
  }
  if (!motDePasse || motDePasse.length > 1024) {
    erreurs['mot-de-passe'] = 'Indiquez un mot de passe de 1 à 1 024 caractères.';
  }
  return erreurs;
}

async function soumettreConnexion(evenement) {
  evenement.preventDefault();
  if (connexionEnCours) return;
  var email = document.getElementById('email');
  var motDePasse = document.getElementById('mot-de-passe');
  var erreurs = validerConnexion(email.value.trim(), motDePasse.value);
  ['email', 'mot-de-passe'].forEach(function (id) {
    document.getElementById('erreur-' + id).textContent = erreurs[id] || '';
    document.getElementById(id).setAttribute('aria-invalid', Boolean(erreurs[id]));
  });
  if (Object.keys(erreurs).length) {
    afficherMessageConnexion('Veuillez corriger les champs indiqués.', true);
    document.getElementById(Object.keys(erreurs)[0]).focus();
    return;
  }
  viderSession();
  reinitialiserFormulaire();
  rafraichirPublic();
  afficherAdministration();
  var session = numeroSession;
  connexionEnCours = true;
  document.getElementById('bouton-connexion').disabled = true;
  afficherMessageConnexion('Connexion en cours…', false);
  var donnees = {email: email.value.trim(), password: motDePasse.value};
  motDePasse.value = '';
  try {
    var reponse = await requeteApi('/auth/login', 'POST', donnees);
    donnees.password = '';
    if (session !== numeroSession) return;
    if (!texteValide(reponse.access_token) || reponse.token_type !== 'bearer' ||
        !Number.isInteger(reponse.expires_in) || reponse.expires_in < 1 || reponse.expires_in > 7200) {
      throw new Error('La réponse de connexion est invalide. Réessayez.');
    }
    tokenAdmin = reponse.access_token;
    expirationSession = Date.now() + reponse.expires_in * 1000;
    var admin = await requeteApi('/auth/me', 'GET', null, tokenAdmin);
    if (session !== numeroSession) return;
    if (!admin || !idValide(admin.id) || !texteValide(admin.nom) || !texteValide(admin.email)) {
      throw new Error('L’identité administrateur n’a pas pu être vérifiée.');
    }
    if (Date.now() >= expirationSession) throw new Error('La session a expiré. Reconnectez-vous.');
    adminConnecte = {id: admin.id, nom: admin.nom, email: admin.email};
    minuterieSession = setTimeout(function () {
      if (session === numeroSession) expirerSession();
    }, expirationSession - Date.now());
    afficherMessage('', '');
    rafraichirPublic();
    afficherAdministration();
    location.hash = '#administration';
    await rechargerAnnonces();
  } catch (erreur) {
    if (session !== numeroSession) return;
    viderSession();
    rafraichirPublic();
    afficherAdministration();
    afficherMessageConnexion(erreur.message, true);
    location.hash = '#connexion';
  } finally {
    donnees.password = '';
    if (session === numeroSession) {
      connexionEnCours = false;
      document.getElementById('bouton-connexion').disabled = false;
    }
  }
}

function preparerConnexion() {
  document.getElementById('formulaire-connexion').addEventListener('submit', soumettreConnexion);
  ['email', 'mot-de-passe'].forEach(function (id) {
    document.getElementById(id).addEventListener('input', function () {
      this.removeAttribute('aria-invalid');
      document.getElementById('erreur-' + id).textContent = '';
      afficherMessageConnexion('', false);
    });
  });
  document.getElementById('bouton-deconnexion').addEventListener('click', quitterAdministration);
  document.getElementById('bouton-actualiser-annonces').addEventListener('click', function () {
    if (!operationEnCours && sessionValide()) rechargerAnnonces();
  });
  // Les navigateurs peuvent retarder les minuteries dans un onglet masqué.
  window.addEventListener('focus', verifierExpiration);
  document.addEventListener('visibilitychange', verifierExpiration);
}

function verifierExpiration() {
  if (tokenAdmin && Date.now() >= expirationSession) {
    expirerSession();
    return true;
  }
  return false;
}


// Affichage des vues seulement : aucune sécurité ne repose sur cette navigation.
function afficherPage() {
  var page = location.hash.slice(1) || 'accueil';
  if (verifierExpiration()) return;
  if (page === 'administration' && !sessionValide()) {
    location.replace('#connexion');
    return;
  }
  var administration = page === 'administration';
  var connexion = page === 'connexion';
  document.getElementById('pages-publiques').hidden = administration || connexion;
  document.getElementById('administration').hidden = !administration;
  document.getElementById('connexion').hidden = !connexion;
  if (!connexion) {
    document.getElementById('mot-de-passe').value = '';
    document.getElementById('message-connexion').textContent = '';
  }
  document.title = (administration ? 'Administration — ' : connexion ? 'Connexion — ' : '') + 'Faculté des Sciences — UMBB';
  fermerMenu();
  if (administration) afficherAdministration();
  var cible = document.getElementById(page);
  if (cible) requestAnimationFrame(function () {
    cible.scrollIntoView({block: 'start'});
    var titre = cible.querySelector('h1, h2');
    if (titre) {
      titre.tabIndex = -1;
      titre.focus({preventScroll: true});
    }
  });
}
document.addEventListener("DOMContentLoaded", demarrer);

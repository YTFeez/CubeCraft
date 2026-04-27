# Cubecraft

Mini-clone de Minecraft **multijoueur** dans le navigateur. 4 mondes thématiques que tu peux rejoindre avec des amis, un serveur Node.js qui synchronise tout en temps réel, et toute la 3D faite en [Three.js](https://threejs.org/).

## Les 4 mondes

| Monde       | Ambiance                                  | Particularités                                   |
|-------------|-------------------------------------------|--------------------------------------------------|
| **Forêt**     | Vert et bleu, soleil chaud                | Lacs d'eau, arbres feuillus, plages              |
| **Désert**    | Or et orange, ciel pâle                   | Dunes infinies, cactus, pas d'eau                |
| **Toundra**   | Blanc et bleu glacial                     | Sol enneigé, lacs gelés (glace), sapins          |
| **Volcanique**| Rouge et noir, ciel sombre                | Pierre noire, lacs de lave, arbres morts         |

Chaque monde est partagé : tous les joueurs connectés voient les mêmes constructions et le même cycle jour/nuit.

## Fonctionnalités

- **Comptes joueurs** (inscription + connexion, mots de passe hashés en PBKDF2, un compte par pseudo)
- **Sauvegarde par compte** : ta dernière position, ton angle de vue et ton slot de hotbar sont restaurés à chaque reconnexion, monde par monde
- **Multijoueur temps réel** via WebSocket (positions, casse/pose de blocs, cycle jour/nuit, chat)
- **4 mondes thématiques** persistants côté serveur (sauvegarde sur disque toutes les 30 s)
- **Génération procédurale déterministe** : tous les clients génèrent le même terrain à partir du seed
- **14 types de blocs** : herbe, terre, pierre, sable, bois, planches, feuilles, verre, socle, eau, neige, glace, cactus, lave
- **Hotbar adapté au thème** (les blocs disponibles correspondent à l'ambiance)
- **Avatars des autres joueurs** avec pseudo flottant et couleur unique
- **Chat in-game** (touche `T`)
- **Ambient occlusion**, ciel procédural, étoiles, nuages, head-bob, FOV dynamique, particules quand on casse un bloc
- **Eau et lave** translucides avec ondulations animées (shader custom)

## Commandes

| Action                    | Touche                    |
|---------------------------|---------------------------|
| Avancer / Reculer         | `Z` / `S` (ou `W`/`S`)    |
| Gauche / Droite           | `Q` / `D` (ou `A`/`D`)    |
| Sauter / nager vers le haut| `Espace`                 |
| Courir                    | `Shift`                   |
| Regarder                  | Souris                    |
| Casser un bloc            | Clic gauche               |
| Poser un bloc             | Clic droit                |
| Choisir un bloc           | `1` à `7` ou molette      |
| Chat                      | `T`                       |
| Forcer jour/nuit (leader) | `L`                       |
| Menu / Libérer la souris  | `Échap`                   |

## Lancer en local

```bash
npm install
npm start
```

Puis ouvre [http://localhost:8080](http://localhost:8080).

Pour jouer à plusieurs sur le même Wi-Fi : tes amis ouvrent `http://<ton-ip-locale>:8080` (par ex. `http://192.168.1.42:8080`). Tu peux trouver ton IP avec `ipconfig` (Windows) ou `ifconfig` (mac/linux).

## Déployer en ligne (gratuit) — pas-à-pas

### Option A : Render.com (recommandé)

1. **Crée un compte GitHub** si tu n'en as pas, et installe `git` sur ta machine.
2. **Pousse le dossier sur GitHub** :
   ```bash
   cd C:\Users\Arron\Documents\minecraft
   git init
   git add .
   git commit -m "Cubecraft initial"
   git branch -M main
   # crée un repo vide sur github.com (ex: cubecraft) puis :
   git remote add origin https://github.com/<ton-pseudo>/cubecraft.git
   git push -u origin main
   ```
3. **Crée un compte sur [render.com](https://render.com)** (gratuit, sans CB).
4. Dans le dashboard Render → **New +** → **Blueprint** → choisis ton repo GitHub.
   - Render détecte automatiquement le fichier `render.yaml` et configure le service.
   - Sinon : **New +** → **Web Service** → repo → laisse `npm install` / `node server.js` par défaut.
5. **(Important pour la persistance des comptes)** Sur la page du service → **Disks** → **Add Disk** :
   - Nom : `data`
   - Mount path : `/opt/render/project/src/data`
   - Taille : 1 GB suffit largement.
   - Ajoute un **second disque** identique avec mount path `/opt/render/project/src/world-saves` pour garder aussi les blocs cassés/posés.
   - **Sans disque** : sur le plan gratuit le système de fichiers est éphémère, donc les comptes et constructions disparaîtront à chaque redémarrage.
6. Render te donne une URL en `https://cubecraft-xxx.onrender.com` — partage-la avec tes potes !

> Note : sur le plan gratuit, le serveur s'endort après ~15 min d'inactivité. Le premier joueur qui se connecte le réveille (10–30 s).
> Les disques persistants sont **payants** (~ 0,25 $/Go/mois). Sans disque tout fonctionne mais les données sont remises à zéro à chaque déploiement.

### Option B : Railway

1. [railway.app](https://railway.app) → connecte GitHub → "Deploy from repo".
2. Railway détecte Node automatiquement. Variable `PORT` injectée automatiquement.
3. Pour persister les données : Project → Volumes → monte un volume sur `/app/data` et un autre sur `/app/world-saves`.

### Option C : Fly.io

1. Installe `fly` et lance `fly launch` dans le dossier.
2. Réponds "Yes" à la question des volumes et monte-en deux : `data` et `world-saves`.

### Option D : Partage rapide via ngrok (zero hébergement)

Pratique pour faire tester à des amis sans déployer :

```bash
npm install -g ngrok
ngrok http 8080
```

ngrok te donne une URL publique temporaire (`https://xxxx.ngrok-free.app`) qui pointe sur ton PC. Tant que ton PC tourne avec `npm start`, n'importe qui peut se connecter.

## Comptes & sauvegarde

- À la première connexion, choisis l'onglet **Inscription**, entre un pseudo (3-16 caractères, lettres/chiffres/_/-) et un mot de passe (≥ 4 caractères).
- Les comptes sont stockés dans `data/users.json` avec mots de passe **hashés (PBKDF2 SHA-256, 120 000 itérations + sel aléatoire 16 octets)** — jamais en clair.
- Un pseudo = un compte. Pas de duplicata possible (case-insensitive).
- Le token de session est stocké côté navigateur (`localStorage`) et reste valide tant que tu ne te déconnectes pas. Si tu reviens sur la page, tu es reconnecté automatiquement.
- Pour chaque (compte, monde), on sauvegarde : position (x/y/z), angle de vue (yaw/pitch), slot de hotbar actif. Restauration automatique à la reconnexion.
- Les modifications de blocs restent **partagées** entre tous les joueurs d'un même monde (le serveur en garde la trace dans `world-saves/<monde>.json`).

## Structure du projet

```
minecraft/
├── server.js            # Serveur Node.js (Express + ws), 4 rooms, auth API, persistence disque
├── server/
│   └── accounts.js      # Stockage des comptes (PBKDF2 + tokens + données par monde)
├── package.json
├── render.yaml          # Config de déploiement Render
├── world-saves/         # Sauvegardes JSON par monde (créé au runtime)
├── data/
│   └── users.json       # Comptes + données par compte (créé au runtime)
├── index.html           # UI : auth + sélection des mondes + HUD + chat
├── styles.css
└── src/
    ├── main.js          # Orchestration (scène, sessions, boucle, atmosphère)
    ├── themes.js        # Définition des 4 mondes (gen, ciel, lumière, hotbar)
    ├── blocks.js        # 14 blocs + atlas de textures généré sur canvas
    ├── world.js         # Chunks, génération paramétrique, mesher AO
    ├── player.js        # Physique FPS (gravité, collisions, nage)
    ├── interaction.js   # Raycast, casse/pose, hotbar dynamique
    ├── audio.js         # Sons synthétisés (Web Audio)
    ├── particles.js     # Particules quand on casse un bloc
    ├── sky.js           # Étoiles + nuages procéduraux
    ├── network.js       # Client WebSocket (move/edit/chat)
    └── remoteplayers.js # Avatars des autres joueurs (cube + label)
```

## Notes techniques

- **Synchronisation** : le serveur ne stocke que les *edits* (modifications de blocs). Le terrain procédural est régénéré identiquement par chaque client à partir du `seed` du thème, ce qui garde le trafic réseau extrêmement léger (~quelques Ko/s).
- **Cycle jour/nuit** : le premier joueur connecté est "leader" et possède l'horloge. Les autres se synchronisent via `timeSync` toutes les 5 s.
- **Tailles** : chunks 16×16×64, rayon de vue 5 chunks (~80 blocs).
- **Persistence serveur** : sauvegarde JSON sur disque toutes les 30 s + à la fermeture (`SIGINT`/`SIGTERM`).

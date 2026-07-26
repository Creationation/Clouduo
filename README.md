# NuageDuo

Cloud privé pour 2 personnes (Diego et Vesna). PWA installable sur GSM et PC.
Photos et vidéos en qualité **originale, octet pour octet** (aucune compression,
aucun transcodage). Espace personnel + espace commun, transferts, backup, corbeille.

Stack: React + TypeScript + Vite + Tailwind v4 + PWA · Supabase (Auth/Postgres/Edge
Functions) · Cloudflare R2 (stockage) · Vercel (déploiement).

---

## 1. Prérequis

- Node 20+
- Un projet [Supabase](https://supabase.com)
- Un bucket [Cloudflare R2](https://developers.cloudflare.com/r2/)
- La [CLI Supabase](https://supabase.com/docs/guides/cli) (`npx supabase`)

## 2. Installation locale

```bash
npm install
cp .env.example .env.local   # puis remplir VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY
npm run dev
```

## 3. Base de données (Supabase)

Applique les migrations (`supabase/migrations/`) — elles créent le schéma, la RLS,
les triggers et les fonctions RPC :

```bash
npx supabase link --project-ref <ref-du-projet>
npx supabase db push
```

### Créer les 2 comptes

Dans **Authentication > Users > Add user** (Supabase), crée les 2 utilisateurs
(email + mot de passe, "Auto confirm"). Le profil est créé automatiquement par
trigger. Pour définir le nom affiché et le rôle owner, ajoute des
**User Metadata** à la création :

```json
{ "display_name": "Diego", "role": "owner", "lang": "fr" }
```
```json
{ "display_name": "Vesna", "role": "member", "lang": "de" }
```

`lang` vaut `fr` ou `de` et devient la langue de l'interface du compte
(modifiable ensuite dans *Réglages*). Par défaut `fr`.

(Si tu oublies, le profil prend l'email comme nom et le rôle `member`; tu peux
corriger ensuite dans la table `profiles`.)

## 4. Stockage R2 (Cloudflare)

1. Crée un bucket (ex. `nuageduo`).
2. Crée un token API R2 (Access Key ID + Secret).
3. **CORS** — indispensable pour l'upload direct navigateur. Applique
   `supabase/r2-cors.json` (remplace l'origine Vercel par la tienne) dans
   *R2 > ton bucket > Settings > CORS Policy*. Note: `ExposeHeaders: ["ETag"]`
   est **obligatoire** pour finaliser les uploads multipart des grosses vidéos.

## 5. Edge Functions

Renseigne les secrets (jamais exposés au client) puis déploie :

```bash
npx supabase secrets set \
  R2_ACCOUNT_ID=xxx \
  R2_ACCESS_KEY_ID=xxx \
  R2_SECRET_ACCESS_KEY=xxx \
  R2_BUCKET=nuageduo \
  CRON_SECRET=$(openssl rand -hex 16)

npx supabase functions deploy sign-upload
npx supabase functions deploy sign-download
npx supabase functions deploy cleanup
npx supabase functions deploy purge-trash
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` et `SUPABASE_SERVICE_ROLE_KEY` sont injectés
automatiquement dans les Edge Functions.

### Purge automatique de la corbeille (30 jours)

`purge-trash` supprime les fichiers en corbeille depuis > 30 jours puis nettoie
R2 (uniquement les objets qui ne sont **plus référencés** par aucune ligne).
Planifie-la via `pg_cron` + `pg_net` (SQL Editor Supabase) :

```sql
select cron.schedule(
  'purge-trash-daily', '0 3 * * *',
  $$ select net.http_post(
       url := 'https://<ref>.functions.supabase.co/purge-trash',
       headers := jsonb_build_object('x-cron-secret', '<CRON_SECRET>')
     ); $$
);
```

## 6. Déploiement Vercel

- Importe le repo, framework **Vite** (build `npm run build`, output `dist`).
- Variables d'env : `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
- `vercel.json` gère déjà le rewrite SPA.
- Ajoute l'URL Vercel dans la CORS R2 **et** dans les URLs de redirection Auth
  Supabase.

Icônes PWA : régénérables via `npm run icons` (source `public/favicon.svg`).

---

## Gros volumes sur PC

- **Dépôt de dossiers** : la zone de dépôt accepte des dossiers entiers et
  descend dans les sous-dossiers (API `webkitGetAsEntry`). Seules les photos et
  vidéos sont retenues. Bouton *Choisir un dossier* pour la même chose au clic.
- **Débit** : 3 fichiers en parallèle, et pour chaque gros fichier 4 parts
  envoyées simultanément (`PART_CONCURRENCY` dans `src/lib/uploader.ts`). Le
  facteur limitant devient le débit montant de la ligne, pas l'application.
- **Taille de part adaptative** : R2 plafonne à 10 000 parts. La part démarre à
  16 Mo et double tant que le fichier dépasse ce plafond, donc aucune limite
  pratique de taille de fichier.
- **Robustesse** : chaque part est réessayée 4 fois avec re-signature de l'URL,
  et l'état est persisté après chaque part. Une coupure réseau ou la fermeture
  de l'app reprend là où ça s'était arrêté, sans re-uploader ce qui est déjà
  passé. Les URL présignées durent 6h.
- **Ajout en masse** : la file est écrite en une seule transaction IndexedDB,
  déposer des milliers de fichiers reste instantané.

## Envoyer un fichier sans passer par le Commun

Trois destinations dans *Ajouter* : **Mes fichiers**, **Commun**, et
**Envoyer à <l'autre>**. Le troisième choix garde le fichier dans ton espace
perso et crée un transfert en attente chez l'autre, visible dans *Reçus*, qui
accepte ou refuse. Accepter ne re-uploade rien (nouvelle ligne sur le même
objet R2). Un petit mot facultatif peut accompagner l'envoi. Si le fichier est
déjà chez toi, le transfert part directement sans renvoyer les octets.

Un fichier déjà en ligne peut aussi être envoyé depuis la galerie
(*Envoyer à* dans les actions du fichier).

## Connexion, mots de passe

La connexion se fait par **nom d'utilisateur**, pas par email. L'email reste
attaché au compte (Supabase Auth en a besoin) mais ne sert plus qu'à la
récupération de mot de passe.

La résolution username → email passe par l'Edge Function `auth-username`
(`verify_jwt = false`, c'est le point d'entrée avant connexion). Elle utilise la
clé service_role côté serveur et ne renvoie que la session : **l'email n'est
jamais exposé au navigateur**, et un nom inconnu répond exactement comme un
mauvais mot de passe, pour ne pas révéler quels comptes existent.

- **Mot de passe oublié** : sur l'écran de connexion, saisir le nom
  d'utilisateur. Le lien part sur l'email du compte. Au retour, un écran impose
  un nouveau mot de passe avant de laisser entrer (`PASSWORD_RECOVERY`).
- **Changer son mot de passe** : dans *Réglages*.
- L'œil permet de révéler ce qu'on tape, partout (connexion, réglages,
  réinitialisation).

> Les URL de redirection doivent être autorisées dans Supabase
> (*Authentication > URL Configuration*) : `http://localhost:5173` en local et
> l'URL Vercel en production, sinon le lien de réinitialisation est refusé.

## Apparence

Glassmorphism, **clair par défaut**, avec un mode sombre au choix dans
*Réglages*. Le thème est stocké par appareil (`localStorage`), contrairement à
la langue qui suit le compte : on peut vouloir le sombre le soir sur le
téléphone et le clair sur le PC. Au premier lancement, la préférence système
est respectée.

Classes dans `src/index.css` :

- `.glass` : panneaux et cartes. Reflet spéculaire en diagonale + les deux
  liserés (haut et gauche) + flou d'arrière-plan.
- `.glass-bar` : barre du bas, sans `overflow: hidden` pour laisser sortir le
  menu qui s'ouvre au-dessus.
- `.glass-soft` : éléments répétés, sans flou. Un `backdrop-filter` par
  vignette écroulerait le défilement d'une galerie de plusieurs centaines de
  photos.
- `.glass-accent` / `.glass-danger` : boutons et états actifs. Ce sont du
  **verre teinté**, pas des aplats : un carré de bleu plein au milieu de
  panneaux en verre casse tout l'effet. D'où les variables `--accent-rgb` et
  `--danger-rgb` en composantes RVB, seul moyen de teinter en gardant la
  transparence.

Le fond est un maillage de dégradés radiaux colorés : sans lui le flou n'a rien
à diffuser et le verre retombe en gris plat.

**Trois bulles de verre** dérivent en fond, rebondissant sur les bords **et
entre elles**. Le markup est dans `index.html`, hors de `#root` : visible dès
l'écran de connexion, et pas redessiné au rythme de React. Elles passent
**sous** l'interface, donc les panneaux les floutent à leur passage, ce qui
donne sa profondeur au verre.

La physique est dans `src/lib/orbs.ts` : des keyframes CSS savent rebondir sur
un bord (`linear` + `alternate`) mais pas gérer un choc entre deux bulles, qui
demande de connaître les positions à chaque image. La boucle ne modifie que
`transform`, donc tout reste sur le compositeur. Chocs élastiques avec masse
proportionnelle à la surface (la grosse pousse la petite), `dt` plafonné pour
qu'un retour d'onglet ne projette pas les bulles hors écran, et boucle
suspendue quand l'onglet est caché. Sous `prefers-reduced-motion`, elles sont
simplement placées sans animation.

L'irisation change avec le thème : très pâle avec un grand bloom blanc en
clair, franchement saturée cyan/violet/rose avec halo lumineux en sombre.

## Langue

Choisie sur l'écran de connexion (français ou allemand), puis **attachée au
compte** : la colonne `profiles.lang` fait foi dès la connexion, donc chacun
retrouve sa langue sur n'importe quel appareil. Modifiable dans *Réglages*.
Avant connexion, le choix reste en `localStorage`. À la création d'un compte,
`lang` peut être passé en User Metadata (voir plus haut).

## Sections et navigation

Le burger de la barre du bas remplace l'entrée *Galerie* et ne contient que
**l'espace personnel** : Galerie, Documents, Backup, Corbeille. Il s'ouvre en
petit panneau juste au-dessus de la barre, en fondu, et défile si la liste
dépasse 45% de la hauteur d'écran.

Le **Commun** garde son entrée dans la barre et gère ses deux onglets
lui-même (*Photos & vidéos* / *Documents*).

Chaque changement d'écran est animé (fondu + léger glissement, 260 ms), et le
réglage système « moins d'animations » est respecté.

- **Galerie** : photos et vidéos uniquement (`kind` photo/video), en grille,
  groupées par mois.
- **Documents** : tout le reste (`kind = 'other'` : PDF, Office, texte,
  archives, audio), en liste, chaque ligne portant **sa propre date** et sa
  taille. Cliquer une ligne télécharge l'original (la visionneuse ne sert
  qu'aux médias).

Les deux sections ont un bouton de **tri chronologique** (récents ou anciens
d'abord) qui s'applique sur `taken_at`, la date éditable.

Les documents sont désormais acceptés à l'upload : la zone de dépôt prend
n'importe quel type de fichier, seuls les fichiers cachés et les rebuts système
(`Thumbs.db`, `.DS_Store`, `desktop.ini`) sont écartés. L'écran *Backup* reste
volontairement limité aux photos et vidéos.

## Sélection multiple

Chaque vignette et chaque ligne de document porte une pastille de sélection.
Dès qu'un fichier est coché, une barre d'actions apparaît en bas :

- **Envoyer à <l'autre>** : crée un transfert par fichier, sans passer par le
  Commun.
- **Déplacer** : ouvre le sélecteur de dossier (arborescence du scope courant,
  plus la racine, plus la création d'un dossier). Le déplacement ne modifie que
  `folder_id` en base, aucun objet R2 n'est recopié.

## Nom et date d'un fichier

Dans les actions d'un fichier, *Renommer / changer la date* ouvre une fiche avec
le nom et la **date du souvenir** (`taken_at`). Cette date est celle qui commande
le tri de la galerie et le regroupement par mois : la corriger repositionne le
fichier dans la timeline. Utile quand l'EXIF est absent ou faux (scans, vidéos,
photos reçues par messagerie, appareil mal réglé).

Seule la ligne en base change. L'objet stocké dans R2, lui, n'est jamais
réécrit : l'original reste identique octet pour octet.

## Garanties qualité (règle absolue)

- **Original intact** : upload direct navigateur → R2 via URL présignée. Le
  fichier ne transite par aucun serveur. Aucune conversion.
- **Miniatures séparées** : générées côté client (~400px WebP q80), fichier R2
  distinct (`thumbs/…`). L'original (`originals/…`) n'est jamais touché.
- **Dédup** : sha-256 côté client (streaming, cache local) ; un fichier déjà
  présent n'est pas re-uploadé.
- **Références partagées** : "Récupérer", "Mettre dans le Commun" et accepter un
  transfert créent une nouvelle ligne pointant vers le **même** objet R2 (aucun
  re-upload, aucune perte). Un objet R2 n'est supprimé que lorsqu'aucune ligne
  ne le référence plus (comptage de références dans `cleanup`/`purge-trash`).

### Tests de non-régression

- Photo 12 Mo : re-téléchargement → taille + hash identiques.
- Vidéo 4K ~800 Mo : upload multipart avec reprise → hash identique.
- Transfert / récupération depuis le Commun : hash identique à l'original.

---

## Notes techniques

- **HEIC / HEVC** : la plupart des navigateurs desktop ne savent pas les décoder.
  Dans ce cas la miniature n'est pas générée (placeholder affiché) mais
  l'original reste stocké intact et téléchargeable. L'upload n'est jamais bloqué.
- **Backup PWA** : une PWA ne peut pas scanner la galerie en arrière-plan.
  L'utilisateur sélectionne ses fichiers ; la dédup par hash (avec cache local)
  rend les ré-exécutions rapides. La file d'attente est persistée (IndexedDB) et
  reprend après fermeture de l'app ou coupure réseau.
- **react-router-dom 7.18.1** : `npm audit` signale une advisory *RSC Mode CSRF*
  (7.12–8.2). Elle ne concerne **que** le mode RSC avec server actions, non
  utilisé ici (SPA `BrowserRouter` classique). La faille réellement atteignable
  en SPA (XSS open-redirect) est corrigée depuis 7.18.1.
```

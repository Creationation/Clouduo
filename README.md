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
{ "display_name": "Diego", "role": "owner" }
```
```json
{ "display_name": "Vesna", "role": "member" }
```

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

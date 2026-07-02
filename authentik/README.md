# Authentik (sign-in + roles) for FMD

FMD uses **Authentik** as its identity provider: users sign in through Authentik,
and their **groups** become FMD **`[Role]`** names. Authentik runs as its own set
of containers (its own Postgres + Redis), separate from the FMD database.

```
web (5173) ──login──> Authentik (9000)  ──OIDC token (groups claim)──> api (4000)
```

## What's provisioned

The blueprint `blueprints/fmd.yaml` is applied automatically on boot and creates:

| Thing | Value |
|---|---|
| Application slug | `fmd` |
| Issuer (browser) | `http://localhost:9000/application/o/fmd/` |
| OIDC client_id | `fmd-web` (public client — **Authorization Code + PKCE, no secret**) |
| Redirect URI | `http://localhost:5173/auth/callback` (and `http://localhost:5173/*`) |
| Groups → roles | **Admin**, **Staff**, **Viewer** |

Roles flow via the **`groups` claim** in the token (Authentik's default `profile`
scope mapping includes it). An FMD `[Role] Admin` matches an Authentik group named
`Admin` (case-insensitive on the app side).

## Bring it up

Secrets live in **`.env`** (git-ignored): `AUTHENTIK_SECRET_KEY`,
`AUTHENTIK_PG_PASS`, `AUTHENTIK_BOOTSTRAP_PASSWORD`, `AUTHENTIK_BOOTSTRAP_EMAIL`.
They're already generated; keep that file private.

```bash
# Authentik services only (won't disturb the running db/api/web):
docker-compose up -d authentik-postgres authentik-redis authentik-server authentik-worker

# …or the whole stack:
docker-compose up -d
```

First boot runs DB migrations (~1–3 min) before `http://localhost:9000` answers.
Check readiness:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:9000/-/health/ready/   # 200 = ready
curl -s http://localhost:9000/application/o/fmd/.well-known/openid-configuration  # OIDC discovery
```

> **compose-v1 quirk on this machine.** `docker-compose` v1.29.2 can *create* new
> containers but not cleanly *recreate* existing ones (Docker 29 dropped the
> `ContainerConfig` field it reads). The Authentik containers are new, so the
> commands above work. To pick up changes to an existing service later:
> `docker-compose rm -sf <svc> && docker-compose up -d <svc>`. Editing
> `blueprints/fmd.yaml` does **not** need a rebuild — the worker re-applies
> blueprints on a watch; or restart the worker: `docker-compose restart authentik-worker`.

## Admin login + creating users

1. Open **http://localhost:9000/** and sign in as **`akadmin`**.
   The password is `AUTHENTIK_BOOTSTRAP_PASSWORD` in `.env`.
2. Create a test user: **Admin interface → Directory → Users → Create**
   (set a username and, under the user, **Set password**).
3. Assign a role: **Directory → Groups → Admin/Staff/Viewer → Users → add** your
   test user. (A user with no group gets no role.)
4. Sign in to FMD at **http://localhost:5173** — you'll be redirected to Authentik
   and back; your group(s) become your FMD role(s).

## Role ↔ group mapping

| FMD document | Authentik |
|---|---|
| `[Role] Admin` / `[Roles] Admin, Staff` | Groups named exactly `Admin`, `Staff`, … |
| `[Permission]` → `(Admin) Read, Create, Update, Delete` | Grants for users in the `Admin` group |

To add a new role, create a matching **group** in Authentik and use its name in
the FMD document.

## Internal vs public URL (note for the API)

The api service is given `OIDC_ISSUER=http://localhost:9000/application/o/fmd/`
(the **public** issuer, matching what the browser/token sees). From *inside* the
docker network the api reaches Authentik at **`http://authentik-server:9000`**
instead of `localhost`. If the api validates tokens by fetching JWKS and can't
reach `localhost:9000` from its container, point its JWKS fetch at the internal
host (the api's auth layer handles this; see `server/auth.js`). When the api runs
on the **host** (e.g. plain `node`), `localhost:9000` works directly.

## Reset

```bash
docker-compose rm -sf authentik-server authentik-worker authentik-postgres authentik-redis
docker volume rm fmd_authentik-pgdata fmd_authentik-redis fmd_authentik-media fmd_authentik-templates
```
Then bring the services back up to re-bootstrap from scratch.

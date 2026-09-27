# AI Hub: structure, testing, and deployment

## What this project currently does

AI Hub is a single Node.js application for organizing AI media production. It tracks shots (called plans in the code), prompts, uploaded resources, generation versions, estimated costs, workflow status, and the selected final. Generations are manually recorded; the application does not call AI providers or generate media itself. No provider API keys are needed.

The UI is server-rendered EJS with vanilla browser JavaScript and Tailwind CSS. Express serves both pages and JSON APIs. SQLite holds the workspace, accounts, sessions, catalogs, and file metadata; uploaded bytes live in a separate directory. There is no separate frontend build, database server, queue, or worker service.

Fresh databases automatically get the `admin` account, model/platform/resource catalogs, and a sample project named **The Last Signal** with six shots and sample generation records. The bundled cinematic thumbnail is copied into media storage. These previews are sample artwork, not generated outputs. Existing database contents are kept on startup. The UI currently exposes one project; there is no project switcher or project management screen.

## Project map

| File or directory | Responsibility |
| --- | --- |
| `server.js` | Express startup, page routes, authentication endpoints, plan/generation/account/catalog APIs, uploads, private file streaming, and `/health`. Listens on port 4310 by default. |
| `src/db.js` | SQLite schema initialization and migrations, initial sample data, queries, validation, and persistence. Historical generation model/platform/resource names and prices are stored as snapshots. |
| `src/shot-numbers.js` | Positive integer number validation, combined filters, legacy number migration, and database triggers that lock shot/generation identities. |
| `src/auth.js` | Password hashing, sessions, cookie handling, and permissions for Admin, Supervisor, Creator, Reviewer, and Viewer. Sessions last 12 hours. |
| `src/storage.js` | Filesystem storage, Multer uploads, file classification, SHA-256 checksums, protected thumbnail initialization, and safe download names. |
| `views/index.ejs` | Flat shot grid sorted by generation date, numbered plan creation, and Admin account/catalog dialogs. |
| `views/plan.ejs` | Full shot workspace: generations, file library, brief/prompt, notes, workflow, and generation editor. |
| `views/login.ejs` | Username lookup, first-login password setup, and sign-in. |
| `views/partials/shot-navigation.ejs`, `public/js/shot-navigation.js` | Shared #Seq/#Shot fields, live matching, shareable filter URLs, and navigation between the grid and shot sections. |
| `public/js/` | Browser interactions for the grid (`app.js`), shot pages (`plan-detail.js`), and login (`auth.js`). |
| `public/css/input.css`, `tailwind.config.js` | Styles and Tailwind configuration. `public/css/app.css` is generated and ignored by Git. |
| `assets/` | Bundled seed artwork included in Docker images. |
| `data/`, `storage/` | Default host database and media locations. Both are ignored by Git and excluded from Docker images. |
| `scripts/dev.js` | Server watcher and Tailwind watcher, on Windows or Linux. Refresh the browser to see changes. |
| `scripts/container-dev.js` | Development container launcher; refreshes mounted dependencies when the lockfile changes. |
| `tests/app.test.js` | HTTP integration test covering authentication, roles, plans, generations, catalogs, uploads, streaming, and deletion. Uses isolated temporary data by default. |
| `tests/shot-numbers.test.js` | Legacy number migration, repeat-start safety, numeric validation, preserved media links, and database identity enforcement. |
| `Dockerfile` | Development, verification, builder, and production stages. Uses Node 22; production runs as the unprivileged `node` user with prebuilt CSS. |
| `compose.yaml` | Live development (`app`), disposable checks/tests (`check`, `test`), and production (`production`). |
| `.github/workflows/docker-ci.yml` | Builds verification image, runs checks/tests, and builds production image. |
| `docs/DOCKER.md`, `docs/STORAGE.md` | Additional container and storage details. |

Request flow: browser → Express route → auth/permission check → SQLite and/or media storage → EJS page or JSON response. All shot media endpoints require a signed-in user; Nginx must proxy them through Express.

The unfinished Scenes, global Media library, Continuity kit, card menus, and obsolete drawer/review controls have been removed. Prompt Library, Activity, and Notifications are retained for the planned overhaul; clicking them displays a planned-feature notice. Their actual workflows are not implemented yet. The per-shot library and generation editor remain available.

## Shot numbering and navigation

The home page shows all plans/shots in one grid. Cards are ordered by their latest generation's creation time, newest first; shots without generations use their own creation time. A status change, brief edit, or file upload does not change that ordering. Generation versions stay inside each shot's dedicated workspace.

The large **#Seq** and **#Shot** fields are shared by the grid and every tab of the shot workspace. Empty fields mean all numbers. Either field filters independently; filling both combines the filters. Grid filtering happens immediately and combines with text search and status. Shot pages show matching shot links immediately and offer **View grid**. Number filters are kept in the URL, including links back to the grid and between shots.

New plans require both numbers as whole numbers from 1 to 1,000,000. The shot code is generated from them, such as `SQ02-SH018`. A plan's numbers are permanent. Each new generation and upload must submit both numbers matching its parent shot; generations store immutable numeric snapshots. The editor pre-fills these numbers from the shot, and saved generations show them as read-only. Library uploads display the locked shot numbers. Saving with missing, invalid, or mismatched numbers returns an error; rejected uploads are removed from disk.

Existing databases migrate automatically on startup. Sequence numbers come from the existing sequence name first, then recognizable legacy codes; shot numbers come from `SH` digits in the existing code. Unrecognized shot codes receive the first unused positive number in their sequence. Existing numeric identities, IDs, legacy codes, generation history, and media links are preserved. Review migrated numbers against your production naming conventions after the update. Legacy duplicate number pairs remain accessible; filters can show multiple cards for the same pair.

For API clients, `POST /api/plans`, `POST /api/plans/:id/generations`, and multipart `POST /api/plans/:id/resources` require `sequence_number` and `shot_number`. `GET /api/plans?sequence_number=2&shot_number=18` lists matching shots in generation-date order; either query parameter can be omitted. Changing a saved plan's or generation's numbers, or moving a generation to another plan, is rejected.

## Database and media storage decision

Keep **SQLite in WAL mode and filesystem media storage** for the current deployment: one Node process, one Ubuntu server, and a collaborative production workspace. The database stores relatively small metadata records; large media files are streamed to disk and do not inflate SQLite. This assessment is based on the code and deployment topology, not a measured production concurrency target.

SQLite already provides transactions, foreign keys, and indexes. WAL allows readers alongside a writer, but only one write transaction runs at a time. The app's writes are short metadata changes, so there is no demonstrated requirement for a separate database service. Keep the database on local disk, not NFS/SMB. See SQLite's guidance on [appropriate uses](https://sqlite.org/whentouse.html) and [WAL constraints](https://sqlite.org/wal.html).

Reassess **PostgreSQL** if you introduce multiple application servers or generation workers writing concurrently, require database replication/high availability, or observe sustained write contention under a representative workload. More projects, Prompt Library, Activity, and Notifications alone do not require a database migration. At larger record counts, the current unpaginated grid and generation queries also need pagination; replacing the database would not remove that UI/query cost.

Filesystem storage fits a single server: the existing implementation streams uploads/downloads, supports byte ranges, checksums files, and keeps uploads outside the image in persistent storage. Capacity depends on the provisioned disk and media usage, rather than the choice of metadata database. Back up the media and database together, keep an off-server copy, and monitor free disk space.

Reassess **S3-compatible object storage** when multiple servers/workers must share media, independent storage scaling or managed durability is required, or global media delivery becomes important. That migration must preserve resource IDs, checksums, authorization, downloads, and byte-range playback. No storage migration is made at the current scale.

## Windows: run and test with Docker (preferred)

Install Docker Desktop with its WSL 2 backend and **Linux containers**, then start Docker Desktop and wait for its engine to be ready. Use PowerShell in the repository:

```powershell
Set-Location 'D:\Development\AI Hub'
docker version
docker compose version
docker info
Copy-Item .env.example .env  # Only on first setup; do not overwrite an existing .env.
docker compose up --build app
```

Open [http://localhost:4310](http://localhost:4310). On first login, enter `admin`, then create its password (at least 10 characters). There is no default password. Other users must first be created by an Admin under **Accounts**, then set their own password at first login.

The foreground command shows logs. Press Ctrl+C to stop it. The server and CSS watchers run inside the container; refresh the browser after editing. You do not need Node installed on Windows for this workflow.

In a second PowerShell window, run:

```powershell
Set-Location 'D:\Development\AI Hub'
docker compose --profile tools run --build --rm check
docker compose --profile tools run --build --rm test
```

Tests use temporary database/media storage and do not mount your live volumes. Development and production both use the same persistent workspace volumes. To test the production image locally, stop development first because both use port 4310:

```powershell
docker compose stop app
docker compose --profile production up --build -d production
docker compose --profile production ps production
Invoke-RestMethod http://localhost:4310/health
docker compose --profile production logs --tail 100 production
```

Production publishes port 4310 on `127.0.0.1` only. It is still accessible through localhost on Windows. `docker compose --profile production down` stops/removes containers while keeping persistent volumes. **Do not add `--volumes` or `-v` unless you intend to delete the stored workspace.**

## Windows: direct Node fallback

Install Node.js 22 (matching the Docker image), then:

```powershell
Set-Location 'D:\Development\AI Hub'
npm ci
npm run verify
npm run start:host
```

Open [http://localhost:4310](http://localhost:4310). `start:host` builds CSS before starting Express. `npm start` alone does not build CSS. For development with server and CSS watching, use `npm run dev` instead. Stop with Ctrl+C.

Host execution stores the database in `data/ai-hub.db` and media in `storage/`. These are separate from Docker's named volumes. If Docker already runs on 4310, stop it or choose a different host port:

```powershell
$env:PORT = '4311'
npm run dev
```

Optional isolation for a disposable test run, before starting the app:

```powershell
$env:DB_PATH = Join-Path $env:TEMP 'ai-hub-sandbox/ai-hub.db'
$env:MEDIA_ROOT = Join-Path $env:TEMP 'ai-hub-sandbox/media'
npm run start:host
```

Run `npm run verify` in a fresh terminal without live `DB_PATH`/`MEDIA_ROOT` overrides: the integration test honors those variables if present. **Never point the tests at a real workspace.** `better-sqlite3` includes native code; if installation cannot download a matching prebuilt binary, use the Docker workflow or install the Windows native build prerequisites reported by npm.

## Configuration

| Variable | Where used | Default / meaning |
| --- | --- | --- |
| `AI_HUB_MEDIA_STORAGE` | Compose `.env` | `ai-hub-media` named volume, or an absolute Ubuntu host directory. |
| `AI_HUB_MAX_UPLOAD_BYTES` | Compose `.env` | `21474836480` (20 GiB per file). Compose maps this to `MAX_UPLOAD_BYTES`. |
| `PORT` | Direct Node runtime | `4310`; Compose fixes the container port to 4310. |
| `DB_PATH` | Direct Node runtime | `data/ai-hub.db`; Compose sets `/app/data/ai-hub.db`. |
| `MEDIA_ROOT` | Direct Node runtime | `storage/`; Compose sets `/app/storage`. |
| `MAX_UPLOAD_BYTES` | Direct Node runtime | Per-file upload limit in bytes, default 20 GiB. |
| `NODE_ENV` | Runtime | Compose sets development/test/production per service. |

Compose reads `.env` for substitution. Direct `node server.js` does **not** load `.env`; set variables in PowerShell or your service environment. There is no configurable initial Admin password or session secret: the first password is set in the app, and sessions are random tokens whose hashes are saved in SQLite.

## Ubuntu: deploy Docker behind the installed host Nginx

These steps assume Docker Engine, the Compose v2 plugin (`docker compose`), and Nginx are installed, and you can use Docker and sudo. Run a single production instance on a local disk. Replace `ai.example.com` with your domain and point its DNS to this server. Allow inbound TCP 80/443 in the server/cloud firewall; leave 4310 private.

### 1. Copy the application and prepare storage

Clone your repository or copy its source into `/opt/ai-hub`. Include `package-lock.json`, `assets`, `src`, `views`, `public`, the scripts, Dockerfile, and Compose file. Do not copy Windows `node_modules`, `.env`, runtime data, or media as part of the image. If migrating a workspace, restore its database and media separately.

```bash
cd /opt/ai-hub
docker version
docker compose version
sudo nginx -v
cp .env.example .env  # First setup only.
sudo install -d -o 1000 -g 1000 -m 0750 /srv/ai-hub/storage
```

Edit `/opt/ai-hub/.env`:

```env
AI_HUB_MEDIA_STORAGE=/srv/ai-hub/storage
AI_HUB_MAX_UPLOAD_BYTES=21474836480
```

The production image's `node` user has UID/GID 1000. The media bind mount must be writable by that user; Docker creates and initializes the database named volume. Storage should be a local filesystem with enough capacity for your media. The Compose project is named `ai-hub`; its default database volume is `ai-hub_ai-hub-data`. Keep the project name stable when updating.

### 2. Verify and start production

```bash
cd /opt/ai-hub
docker compose --profile tools run --build --rm check
docker compose --profile tools run --build --rm test
docker compose --profile production up --build -d production
docker compose --profile production ps production
docker compose --profile production logs --tail 100 production
curl --fail http://127.0.0.1:4310/health
```

Expected health response: `{"status":"ok","product":"AI Hub"}`. The app should become `healthy`. Production runs without a source bind mount and restarts automatically unless explicitly stopped. No host Node installation is required.

### 3. Bootstrap Admin before public access

The initial `admin` username has no password, so its first visitor can claim it. Before enabling the public Nginx site, open an SSH tunnel from Windows:

```powershell
ssh -L 4311:127.0.0.1:4310 your-user@your-server
```

Keep that terminal open, visit [http://localhost:4311](http://localhost:4311), enter `admin`, and set the password. If 4311 is busy, choose another local port. Close the tunnel after setup. Newly created accounts also use first-login activation; have each intended user activate their account promptly.

### 4. Configure Nginx

Create `/etc/nginx/sites-available/ai-hub` with the following HTTP configuration. This is also the starting point for certificate issuance:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name ai.example.com;

    # Request limit includes multipart overhead above the app's 20 GiB file limit.
    client_max_body_size 21g;
    client_body_timeout 3600s;

    location / {
        proxy_pass http://127.0.0.1:4310;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection "";

        # Stream large uploads/downloads; avoid buffering whole files on Nginx disk.
        proxy_request_buffering off;
        proxy_buffering off;
        proxy_connect_timeout 10s;
        proxy_send_timeout 3600s;
        proxy_read_timeout 3600s;
        send_timeout 3600s;
    }
}
```

Enable it and validate before reloading:

```bash
sudo ln -s /etc/nginx/sites-available/ai-hub /etc/nginx/sites-enabled/ai-hub
sudo nginx -t
sudo systemctl reload nginx
curl --fail http://ai.example.com/health
```

If the symlink already exists, edit the existing file and skip `ln -s`. Do not overwrite unrelated Nginx sites. Do not add a public static alias for media storage: Express enforces authentication and handles byte-range playback. Forwarding the request unchanged preserves `Range` headers.

The upload limit is per file; browser multi-file uploads send separate requests. If you change the app's upload limit, update `client_max_body_size` to leave room for multipart metadata. Timeouts are inactivity limits, not a guaranteed maximum upload duration.

### 5. Enable HTTPS

Use your existing certificate tooling if available. On a standard Ubuntu installation, one option is the Nginx Certbot plugin:

```bash
sudo apt update
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d ai.example.com --redirect
sudo nginx -t
sudo systemctl reload nginx
sudo certbot renew --dry-run
curl --fail https://ai.example.com/health
```

Certificate issuance requires the domain to resolve to this server and port 80 to be reachable. Review the resulting Nginx configuration and keep the upload/proxy settings in the HTTPS application server block. Use the HTTPS URL for normal sign-in and uploads. Nginx sends `X-Forwarded-Proto: https`, allowing the application to mark session cookies `Secure`; clipboard buttons also need HTTPS (or localhost).

The current Express code does not enable `trust proxy`, so login rate limits see Nginx's upstream IP and are shared across users of the same username. Sending `X-Forwarded-For` does not itself change that behavior.

## Verify the deployed UI

After login:

1. Confirm the flat grid is newest-generation first. Filter by #Seq alone, #Shot alone, and both together; combine with text search or status.
2. Create a uniquely named plan with both required numbers and open its dedicated shot page. Confirm the shared number navigation works in all tabs.
3. Upload a small image to Shot library; open and download it.
4. Add a generation with numbers matching the shot, link that image as Output, record its prompt/model/platform/token count, then save and reopen its details. Confirm its numbers are locked.
5. Set that generation as the current final. As Admin or Supervisor, approve it and confirm its updated status on the grid.
6. Verify Accounts and Generation settings as Admin; verify a Viewer has read-only access.
7. Sign out and confirm protected pages/files require sign-in.

## Updates, backups, and restore

Before updates, back up **both** the SQLite database and media. Rebuilding an image never migrates files from another machine. Existing schema adjustments run automatically on app startup, so a rollback may also require restoring the pre-update database.

For a consistent backup of the deployment above, stop production during the copy:

```bash
cd /opt/ai-hub
backup_dir="/srv/ai-hub/backups/$(date -u +%Y%m%dT%H%M%SZ)"
sudo mkdir -p "$backup_dir"
docker compose --profile production stop production
docker compose --profile production run --rm --no-deps --user root \
  -v "$backup_dir:/backup" --entrypoint sh production \
  -c 'tar -czf /backup/database.tar.gz -C /app/data .'
sudo tar -czf "$backup_dir/media.tar.gz" -C /srv/ai-hub/storage .
docker compose --profile production up -d production
```

Verify both archives exist and are readable, then store an access-restricted copy off-server. Protect database archives as credentials/session data. Keep `.env` and deployment source/version information with your backup records. If a backup command fails, restart production and resolve the failure before proceeding.

To restore, use a clean destination workspace with production stopped. Copy the archives into a host directory such as `/srv/ai-hub/restore`, configure `.env` as above, and build the production image. Then:

```bash
cd /opt/ai-hub
docker compose --profile production build production
docker compose --profile production run --rm --no-deps --user root \
  -v /srv/ai-hub/restore:/backup:ro --entrypoint sh production \
  -c 'tar -xzf /backup/database.tar.gz -C /app/data && chown -R node:node /app/data'
sudo tar -xzf /srv/ai-hub/restore/media.tar.gz -C /srv/ai-hub/storage
sudo chown -R 1000:1000 /srv/ai-hub/storage
docker compose --profile production up -d production
curl --fail http://127.0.0.1:4310/health
```

Restore both archives from the same backup. Do not overlay them onto a running or unrelated populated workspace. Check login and file downloads afterward.

For an update, replace/pull the source, run the container checks/tests, then:

```bash
cd /opt/ai-hub
docker compose --profile production up --build -d production
docker compose --profile production ps production
curl --fail http://127.0.0.1:4310/health
```

Keep `.env`, the database volume, and `/srv/ai-hub/storage` in place. For stopping/removing containers, `docker compose --profile production down` preserves named volumes. `down -v` deletes the database named volume and any named media volume.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Windows Docker named-pipe/engine error | Start Docker Desktop, select Linux containers, and wait until `docker info` succeeds. |
| Docker API returns HTTP 500 while Desktop is open | Check `docker desktop status` and startup logs. If the Engine is stopped with `HCS_E_HYPERV_NOT_INSTALLED`, ensure Windows Virtual Machine Platform and hardware virtualization (nested virtualization for a VM) are available, then restart as required. An open Desktop window does not confirm Engine readiness. |
| Port 4310 already allocated | Stop the other development/production instance; use `PORT=4311` for a separate host run. |
| Nginx 502 | Check `docker compose --profile production ps production`, production logs, and `curl http://127.0.0.1:4310/health`. |
| Nginx 413 | Increase `client_max_body_size` and reload Nginx; also check the application's upload-byte limit. |
| Permission denied / uploads cannot be saved | Check UID/GID 1000 can write the bind-mounted media directory and the disk has free space. |
| Unstyled host page | Run `npm run css:build` or start with `npm run start:host`. |
| Clipboard controls fail on a server IP over HTTP | Use HTTPS with a valid certificate, or localhost through the SSH tunnel. |
| Test runner tries to change real data | Clear `DB_PATH` and `MEDIA_ROOT` overrides; use disposable Docker test service. |
| Browser session expires | Sign in again; sessions expire after 12 hours. |

## References and validation scope

Proxy/upload settings follow the [Nginx proxy module](https://nginx.org/en/docs/http/ngx_http_proxy_module.html) and [HTTP core module](https://nginx.org/en/docs/http/ngx_http_core_module.html). Production's loopback binding follows [Docker port publishing](https://docs.docker.com/engine/network/port-publishing/).

Validation for the numbering overhaul: Windows JavaScript checks and all three tests passed; Docker's Node 22 verification image passed the same HTTP integration, migration, and numeric-validation tests. The production Docker image was built and run with an isolated database/media directory. Browser verification covered independent and combined number filters, filter URL reloads, required plan numbers, mismatched generation rejection, output upload, generation saving, read-only saved numbers, and navigation back to the filtered grid. No browser console errors were reported. These checks used disposable test data; no Ubuntu server or Nginx deployment was changed.

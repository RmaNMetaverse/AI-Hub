# AI Hub

AI Hub is a local-first cinematic production workspace for planning AI media, tracking prompt versions and generations, reviewing results, and approving finals.

## Start AI Hub

Docker is the standard runtime for AI Hub. Install Docker Desktop, then run:

```sh
docker compose up --build app
```

Open `http://localhost:4310`. The development container watches server modules and Tailwind styles for changes. Refresh the browser after editing browser JavaScript or templates.

The SQLite database is created automatically in the persistent `ai-hub-data` Docker volume. Uploaded media is stored separately in the persistent `ai-hub-media` volume. Fresh installations remain independent; AI Hub seeds a sample project, shots, generations, catalogs, and its bundled cinematic UI thumbnail.

On a new workspace, sign in with the username `admin`. Because it is the account's first sign-in, AI Hub will ask you to create the Admin password. There is no default password.

## Docker workflows

All normal development and verification happens inside containers:

```sh
# Live development
docker compose up --build app

# JavaScript syntax checks
docker compose --profile tools run --build --rm check

# Isolated integration tests
docker compose --profile tools run --build --rm test

# Production-mode image and service
docker compose --profile production up --build -d production
```

The test container uses a temporary SQLite database in memory-backed container storage. It never mounts the development database volume.

GitHub Actions also builds the Docker verification target, runs all checks and tests in that image, and confirms that the production image can be built.

See [`docs/DOCKER.md`](docs/DOCKER.md) for the container architecture and [`docs/STORAGE.md`](docs/STORAGE.md) for media storage, Linux disk configuration, and backup notes.

See [`deploy.md`](deploy.md) for straightforward first-run and later-run instructions on Windows, macOS, and Ubuntu, including Nginx setup and backups.

## Optional host fallback

Direct host execution is available only as a fallback. Install Node.js 22, run `npm ci`, then `npm run start:host`.

The Docker workflow remains the source of truth for checks, tests, and production behavior.

## Current features

- One flat grid of all shots, newest generation first (creation date for ungenerated shots)
- Prominent #Seq and #Shot filters across the grid and shot workspace; #Seq accepts numbers or text labels, while #Shot stays numeric
- Dedicated full-page workspace and URL for every shot
- Previous and next shot navigation
- Search and status filtering combined with the number filters
- Persistent AI Plan creation with a required #Seq identifier and positive numeric #Shot
- Immutable shot numbers on plans and generations; uploads must match their shot
- Full-page shot workspace with brief, prompt, quality, generations, issues, and next action
- Selected-generation final preview with image, video, audio, or file output
- Numeric generation versions (`v1`, `v2`, …) with exact prompts, model snapshots, notes, seed, platform, token usage, and frozen cost estimates
- Reusable generation inputs such as first/last frames, depth maps, references, masks, poses, and audio
- Shared shot library: upload once and link the same file to multiple generation versions
- Per-shot resource workspace for images, video, audio, documents, archives, generations, and finals
- Admin-managed AI models, generation platforms and token prices, and generation resource types
- Historical snapshots: later catalog renames, removals, or price changes never rewrite an existing generation
- Drag-and-drop multi-file uploads with progress and configurable 20 GiB per-file limit
- Private streamed downloads and byte-range video/audio playback
- SHA-256 integrity checks and persistent Docker media storage
- Storage-backed, authenticated thumbnails for the grid and shot pages
- Status and final-approval updates
- Audited approvals tied to the selected generation; only Admin and Supervisor accounts can approve
- Shot, generation, resource, prompt, prompt-example, and library-asset deletion with stored-file cleanup
- Prompt Library with reusable prompts, tags, negative prompts, and image/video/audio/document examples
- Searchable and filterable Asset Library for character sheets, images, tutorials, PDFs, references, audio, archives, and other production files
- Local SQLite persistence
- Protected sign-in and 12-hour local sessions
- First-login password setup for Admin-created usernames
- Admin, Supervisor, Generator, Creator, Reviewer, and Viewer roles
- Admin-defined custom roles with granular account, shot, workflow, deletion, review, and library permissions
- Admin-only account creation, role management, access management, and generation catalog settings

## Stack

- Node.js and Express
- EJS server-rendered HTML
- Vanilla browser JavaScript
- Tailwind CSS
- SQLite via better-sqlite3
- Docker Compose for development, verification, and production
- Multer streaming uploads with filesystem-backed media storage

## Roles

- **Admin:** Full workspace and account control.
- **Supervisor:** Manages production and approves final media.
- **Generator:** Creates shots, uploads assets, and manages generations.
- **Creator:** Creates plans and manages creative work.
- **Reviewer:** Reviews work and requests revisions.
- **Viewer:** Read-only workspace access.

Admins can add custom roles and choose their permissions. Approval remains exclusive to the built-in Admin and Supervisor roles.

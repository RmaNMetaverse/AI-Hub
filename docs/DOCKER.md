# AI Hub Docker workflow

Docker is AI Hub's primary development and delivery environment. Host-installed Node.js is not required for normal work.

## Container targets

| Target | Purpose | Persistent storage |
| --- | --- | --- |
| `development` | Live-reloading app and Tailwind watcher | `ai-hub-data` and `ai-hub-media` volumes |
| `verification` | Syntax checks and integration tests | Isolated temporary SQLite and media directories |
| `production` | Minimal runtime image with prebuilt CSS | `ai-hub-data` and `ai-hub-media` volumes |

The production image runs as the unprivileged `node` user and includes a health check. Development dependencies and Tailwind are not copied into its final runtime layer.

Production publishes port 4310 only on `127.0.0.1`. Use host Nginx for public access; see [`deploy.md`](../deploy.md) for Ubuntu and HTTPS setup.

## Everyday commands

Start development and follow its logs:

```sh
docker compose up --build app
```

Run checks or integration tests in disposable containers:

```sh
docker compose --profile tools run --build --rm check
docker compose --profile tools run --build --rm test
```

Build and start the production service:

```sh
docker compose down
docker compose --profile production up --build -d production
docker compose --profile production logs -f production
```

Return to development:

```sh
docker compose --profile production down
docker compose up --build app
```

## Data safety

Development and production share the persistent `ai-hub-data` database volume and `ai-hub-media` resource volume, so switching modes keeps the complete workspace. Verification services mount neither volume and therefore cannot modify real project data or media.

`docker compose down` removes containers and networks but preserves the database and uploaded resources. Adding the `--volumes` option deletes both volumes, including every uploaded file, so only use it when you intentionally want a completely new workspace.

## What CI verifies

On each push and pull request, GitHub Actions:

1. Builds the `verification` Docker target.
2. Runs syntax checks and end-to-end HTTP integration tests inside that image.
3. Builds the final `production` target to catch packaging or permission problems.

The integration suite covers health checks, anonymous access, first-login password creation, Admin-only account and generation-catalog management, immutable platform-price snapshots, Creator permissions, Supervisor approval, plan creation, dedicated shot pages, streamed uploads, checksums, byte-range playback, reusable generation resources, and file deletion.

## Troubleshooting

Inspect service state and health:

```sh
docker compose ps
docker compose logs app
```

Rebuild after dependency changes:

```sh
docker compose build --no-cache app
docker compose up app
```

Stop the current mode without deleting data:

```sh
docker compose down
```

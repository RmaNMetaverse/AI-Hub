# AI Hub

AI Hub is a local-first cinematic production workspace for planning AI media, tracking prompt versions and generations, reviewing results, and approving finals.

## Run locally

1. Install Node.js 22 or later.
2. Run `npm install`.
3. Run `npm run dev`.
4. Open `http://localhost:4310`.

The SQLite database is created automatically in `data/ai-hub.db` and seeded with a fictional short-film project the first time the app starts.

On a new workspace, sign in with the username `admin`. Because it is the account's first sign-in, AI Hub will ask you to create the Admin password. There is no default password.

## Run with Docker

Run `docker compose up --build`, then open `http://localhost:4310`.

The Docker volume `ai-hub-data` keeps the SQLite database between container restarts.

## Current features

- Cinematic board, gallery, and list views
- Dedicated full-page workspace and URL for every shot
- Previous and next shot navigation
- Search and status filtering
- Persistent AI Plan creation
- Drag plans between workflow stages
- Detailed plan drawer with brief, prompt, quality, generations, issues, and next action
- Status and final-approval updates
- Local SQLite persistence
- Protected sign-in and 12-hour local sessions
- First-login password setup for Admin-created usernames
- Admin, Supervisor, Creator, Reviewer, and Viewer roles
- Admin-only account creation and access management

## Stack

- Node.js and Express
- EJS server-rendered HTML
- Vanilla browser JavaScript
- Tailwind CSS
- SQLite via better-sqlite3

## Roles

- **Admin:** Full workspace and account control.
- **Supervisor:** Manages production and approves final media.
- **Creator:** Creates plans and manages creative work.
- **Reviewer:** Reviews work and requests revisions.
- **Viewer:** Read-only workspace access.

# AI Hub media storage

AI Hub stores file metadata in SQLite and file bytes in a separate Docker-backed media directory. Database rows contain the shot relationship, original filename, category, media type, size, uploader, notes, checksum, and internal storage key.

## Default all-in-one setup

Running the normal Compose command automatically creates the logical `ai-hub-media` named volume:

```sh
docker compose up --build app
```

This volume belongs to the current server. Installing the same Compose project on another server creates a new independent volume; uploaded media never transfers automatically. AI Hub seeds its bundled cinematic card thumbnail into every new volume on first start.

## Recommended Linux storage location

For a production Linux server, an explicit directory makes disk capacity, RAID placement, monitoring, and backups easier. Create a `.env` file beside `compose.yaml`:

```env
AI_HUB_MEDIA_STORAGE=/srv/ai-hub/storage
AI_HUB_MAX_UPLOAD_BYTES=21474836480
```

The first value maps the container's `/app/storage` directory to a predictable host location. The second sets the per-file upload limit in bytes; the default is 20 GiB.

Use a locally attached disk or RAID filesystem for primary media. The directory must have enough free space for the upload plus normal operating headroom.

## Supported resources

The resource workspace accepts images, video, audio, documents, archives, project files, and other binary resources. Each file is classified by media kind and assigned a production category:

- Reference
- Generation
- Final
- Audio
- Document
- Other

Video and audio responses support HTTP byte ranges, so browsers can seek without downloading the complete file. Unsafe or unknown formats are delivered as downloads instead of being executed in the AI Hub page.

## Access and integrity

Every file route requires an authenticated AI Hub session. Admins, Supervisors, and Creators can upload and remove resources; Reviewers and Viewers receive read-only access. Files are stored under generated names rather than trusting client-provided paths.

Board cards, generation previews, and shot heroes load their cinematic thumbnail from the protected media volume. The application image carries a seed copy so fresh installations can initialize this system asset without an external file service.

AI Hub calculates a SHA-256 checksum after upload and records the uploader and creation time. The original filename is preserved for display and download.

Files belong to the shot library rather than a single generation. Generation records link to those files with an explicit resource type such as Output, First Frame, Last Frame, Depth Map, Reference Video, Mask, or Audio Reference. Reusing a file in another generation creates only a new metadata link; the stored bytes are not copied. Admins can add, rename, remove, or restore resource types; existing generation links keep the type name that was selected when they were saved.

Generation platforms and token prices are also managed by an Admin. When a generation is submitted, AI Hub stores the platform name and token price as a snapshot and calculates the estimate from that snapshot. Changing a platform name or price only affects future generations.

## Backups and migration

Docker volumes survive container rebuilds and `docker compose down`, but they do not protect against server or disk failure. A complete backup must include both:

- The `ai-hub-data` SQLite volume or database directory
- The `ai-hub-media` volume or configured Linux media directory

Stop AI Hub or use a storage-aware snapshot before taking a consistent database backup. Keep at least one encrypted copy on a different physical device or server.

Restoring those two datasets onto a fresh installation deliberately migrates the workspace. Without a restore, every new installation remains independent and empty.

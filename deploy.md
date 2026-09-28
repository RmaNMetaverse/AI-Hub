# AI Hub deployment

AI Hub is a Node.js web app. The easiest way to run it on Windows, macOS, or Ubuntu is Docker. It uses SQLite for its database and filesystem storage for uploaded media. You do not need a separate database server or AI provider keys.

The first account is `admin`. On the first visit, sign in as `admin` and choose its password. The app listens on port `4310`.

## Windows and macOS

Install Docker Desktop, start it, and make sure it is using Linux containers. Then open PowerShell on Windows or Terminal on macOS.

### First run

```sh
git clone https://github.com/RmaNMetaverse/AI-Hub.git
cd AI-Hub
cp .env.example .env
docker compose up --build -d app
```

On Windows PowerShell, use this instead of `cp`:

```powershell
Copy-Item .env.example .env
```

Open [http://localhost:4310](http://localhost:4310), enter `admin`, and set the Admin password.

The database and uploaded media are kept in Docker volumes, so they remain when the container is restarted or rebuilt.

### Every later run

```sh
cd AI-Hub
docker compose up -d app
```

To download the newest code and apply it:

```sh
git pull
docker compose up --build -d app
```

To stop the app:

```sh
docker compose stop app
```

Do not use `docker compose down -v`; the `-v` option deletes the stored database and media volumes.

## Ubuntu Linux with Docker and Nginx

These instructions assume Docker Engine, the Docker Compose plugin, Git, and Nginx are already installed. Replace `ai.example.com` with your domain.

### First run

Clone the app into `/opt/ai-hub`:

```bash
sudo git clone https://github.com/RmaNMetaverse/AI-Hub.git /opt/ai-hub
sudo chown -R "$USER":"$USER" /opt/ai-hub
cd /opt/ai-hub
cp .env.example .env
```

Create a local media directory. The container writes files as UID/GID `1000`:

```bash
sudo install -d -o 1000 -g 1000 -m 0750 /srv/ai-hub/storage
```

Edit `.env`:

```env
AI_HUB_MEDIA_STORAGE=/srv/ai-hub/storage
AI_HUB_MAX_UPLOAD_BYTES=21474836480
```

Start AI Hub:

```bash
cd /opt/ai-hub
docker compose --profile production up --build -d production
curl http://127.0.0.1:4310/health
```

### Start automatically at Ubuntu boot

Create a systemd service that starts the production Compose service after Docker:

```bash
sudo tee /etc/systemd/system/ai-hub.service >/dev/null <<'EOF'
[Unit]
Description=AI Hub Docker application
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
WorkingDirectory=/opt/ai-hub
ExecStart=/usr/bin/docker compose --profile production up -d production
ExecStop=/usr/bin/docker compose --profile production stop production
RemainAfterExit=yes
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now ai-hub.service
sudo systemctl status ai-hub.service
```

The production container uses Docker's `restart: unless-stopped` policy, so it also comes back if the Docker daemon restarts. Useful service commands:

```bash
sudo systemctl restart ai-hub.service
sudo systemctl stop ai-hub.service
sudo systemctl start ai-hub.service
docker compose --profile production ps
docker compose --profile production logs --tail 100 production
```

If Docker is installed somewhere other than `/usr/bin/docker`, find its path with `command -v docker` and replace `/usr/bin/docker` in the unit file.

Before making the site public, create the first Admin password through an SSH tunnel from your computer:

```bash
ssh -L 4311:127.0.0.1:4310 your-user@your-server
```

While that SSH session is open, visit [http://localhost:4311](http://localhost:4311), sign in as `admin`, and set the password.

### Configure Nginx for a dedicated domain

Create `/etc/nginx/sites-available/ai-hub`:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name ai.example.com;

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
        proxy_request_buffering off;
        proxy_buffering off;
        proxy_send_timeout 3600s;
        proxy_read_timeout 3600s;
    }
}
```

Enable the site and reload Nginx:

```bash
sudo ln -s /etc/nginx/sites-available/ai-hub /etc/nginx/sites-enabled/ai-hub
sudo nginx -t
sudo systemctl reload nginx
```

Point your DNS record for `ai.example.com` to the server. For HTTPS, install Certbot and let it update this Nginx site:

```bash
sudo apt update
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d ai.example.com --redirect
```

Use the HTTPS address for normal sign-in and uploads.

### Configure Nginx for a subpath (e.g. `<serverIp>/AIHub`)

If your server already hosts other web applications on port 80 (e.g. ComfyFleet at `/`, KareMa at `/KareMa/`, VideoCompareMa at `/VideoCompareMa/`) and you want to access AI Hub under `<serverIp>/AIHub`:

1. **Set `BASE_PATH` in `.env`**:
   In `/opt/ai-hub/.env`, add:
   
   ```env
   BASE_PATH=/AIHub
   ```
   
   Restart the container so the app mounts its routes and assets under `/AIHub`:
   
   ```bash
   docker compose --profile production up --build -d production
   ```

2. **Create the Nginx snippet `/etc/nginx/snippets/aihub.conf`**:
   
   ```bash
   sudo tee /etc/nginx/snippets/aihub.conf <<'EOF'
   # /etc/nginx/snippets/aihub.conf
   # Mounts AI Hub under /AIHub/ alongside existing sites.
   
   location = /AIHub {
       return 301 /AIHub/;
   }
   
   location ^~ /AIHub/ {
       # No trailing slash on proxy_pass:
       # the URI is passed untouched because AI Hub is configured with BASE_PATH=/AIHub
       proxy_pass http://127.0.0.1:4310;
   
       proxy_http_version 1.1;
       proxy_set_header Host              $host;
       proxy_set_header X-Real-IP         $remote_addr;
       proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
       proxy_set_header X-Forwarded-Proto $scheme;
       proxy_set_header Connection        "";
   
       # Allow large media file streaming and uploads
       client_max_body_size 21g;
       client_body_timeout 3600s;
       proxy_request_buffering off;
       proxy_buffering off;
       proxy_read_timeout 3600s;
       proxy_send_timeout 3600s;
   }
   EOF
   ```

3. **Include the snippet in your existing server configuration**:
   Edit your active server block (e.g. `/etc/nginx/sites-enabled/comfyfleet`) and add the include inside the `server { ... }` block:
   
   ```nginx
   server {
       listen 80 default_server;
       listen [::]:80 default_server;
       server_name _;
   
       include /etc/nginx/snippets/karema.conf;
       include /etc/nginx/snippets/videocomparema.conf;
       include /etc/nginx/snippets/aihub.conf;
       ...
   ```

4. **Test and reload Nginx**:
   
   ```bash
   sudo nginx -t
   sudo systemctl reload nginx
   ```

You can now open `http://<serverIp>/AIHub` in your browser.

### Every later run & Update

```bash
cd /opt/ai-hub
sudo git pull
docker compose --profile production up --build -d production
sudo nginx -t
sudo systemctl reload nginx
```

Check the app if needed:

```bash
docker compose --profile production ps
docker compose --profile production logs --tail 100 production
curl http://127.0.0.1:4310/health
```

## Direct Node.js run without Docker

Docker is recommended, but a local Node.js installation also works on Windows, macOS, and Ubuntu. Install Node.js 22, then:

### First run

```sh
git clone https://github.com/RmaNMetaverse/AI-Hub.git
cd AI-Hub
npm ci
npm run start:host
```

Open [http://localhost:4310](http://localhost:4310) and set the `admin` password. The database is saved in `data/ai-hub.db`; media is saved in `storage/`.

### Every later run

```sh
cd AI-Hub
npm run start:host
```

After pulling changes, run `npm ci` again if `package-lock.json` changed.

## Backing up the database and media

Back up the SQLite database and media directory together. Stop the app first so both copies represent the same workspace.

For a direct Node.js run:

```sh
cp data/ai-hub.db backups/ai-hub.db
cp -a storage backups/storage
```

For Docker with a host media directory:

```bash
docker compose stop app
mkdir -p backups
docker run --rm -v ai-hub_ai-hub-data:/data -v "$PWD/backups:/backup" alpine \
  tar -czf /backup/ai-hub-data.tar.gz -C /data .
tar -czf backups/ai-hub-media.tar.gz -C /srv/ai-hub/storage .
docker compose start app
```

Keep backups on another disk or server. Never commit `data/`, `storage/`, `.env`, or backup archives to Git.

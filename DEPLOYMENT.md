# Deploying Foxden

Foxden is one image with an SQLite database. It serves the web app and every server Firefox Sync needs on port 3000,
over plain HTTP, and keeps its database, backups and logs in `/data`.

You need a machine with Docker, a hostname for Foxden such as `sync.example.com`, and a reverse proxy that serves that
hostname over HTTPS. Foxden doesn't work without HTTPS.

## Install

1. Create a `compose.yml`, replacing `https://sync.example.com` with your own address:

   ```yaml
   services:
     foxden:
       image: ghcr.io/lcollins-dev/foxden:latest
       restart: always
       ports:
         - 127.0.0.1:3000:3000
       environment:
         WEB_APP_BASE_URL: https://sync.example.com
       volumes:
         - data:/data

   volumes:
     data:
   ```

   The `127.0.0.1` port mapping lets only a proxy on the same host reach Foxden.

2. Start Foxden. `latest` runs the newest release. To pin a [release](https://github.com/lcollins-dev/foxden/releases),
   replace `latest` with its version without the `v`, such as `0.1.0`.

   ```sh
   docker compose up -d
   ```

3. Sign in as `admin@example.com` with password `changeme`. Foxden asks for a new email and password before anything
   else, so do this before anyone else can reach it. Use `http://localhost:3000` on the host or an SSH tunnel:

   ```sh
   ssh -L 3000:127.0.0.1:3000 your-server
   ```

4. Point your reverse proxy at port 3000. See [Reverse proxy](#reverse-proxy) for what it must do.

5. Invite people. Open **Invites**, create an invite for each person and send them the link. Set up [email](#email) to
   have Foxden send it for you.

Each person then signs in and follows **Getting started** to connect Firefox.

## Reverse proxy

Your reverse proxy must:

- Serve Foxden over HTTPS at the root of its own hostname, matching `WEB_APP_BASE_URL`
- Accept request bodies of at least 3 MB, since sync uploads can exceed 2.5 MB
- Set `X-Forwarded-For` to the client's address, replacing any value the client sent, which rate limiting relies on
- Keep the `Authorization` header out of its logs, since it carries sign-in and sync credentials

Foxden trusts `X-Forwarded-For` from private addresses by default. If the proxy runs on another host or shares a Docker
network with other containers, set `TRUST_PROXY` to the proxy's address.

An example nginx config:

```nginx
server {
  listen 443 ssl;
  server_name sync.example.com;
  ssl_certificate /path/to/fullchain.pem;
  ssl_certificate_key /path/to/privkey.pem;

  client_max_body_size 5m;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto https;
  }
}
```

## Backups

Foxden backs up its database every night to `/data/backups` and keeps the latest seven. To back up straight away, open
**Background jobs**, select **Back up database** and choose **Run Now**.

- Backups sit on the same volume as the database. Copy them elsewhere so they survive a disk failure.
- Backups can't decrypt synced data, but they hold password hashes and keys that can change live server data. Protect
  them as carefully as the server.
- A failed backup is logged as an error and turns the backup job off. Fix the problem, then turn the job back on in
  **Background jobs**.

## Restoring a backup

Run these steps from the directory that holds `compose.yml`.

1. List the backups:

   ```sh
   docker compose exec foxden ls -l /data/backups
   ```

2. Stop Foxden:

   ```sh
   docker compose stop foxden
   ```

3. Put the backup in place, replacing `BACKUP_FILE` with its filename. This keeps the current database as
   `foxden.sqlite.replaced`, in case you need it back.

   ```sh
   docker compose run --rm --no-deps --entrypoint sh foxden -c '
     cd /data &&
     mv foxden.sqlite foxden.sqlite.replaced &&
     if [ -e foxden.sqlite-wal ]; then mv foxden.sqlite-wal foxden.sqlite.replaced-wal; fi &&
     if [ -e foxden.sqlite-shm ]; then mv foxden.sqlite-shm foxden.sqlite.replaced-shm; fi &&
     cp backups/BACKUP_FILE foxden.sqlite'
   ```

4. Start Foxden. A backup from an older version is upgraded as it starts.

   ```sh
   docker compose start foxden
   ```

5. Check Foxden works, then delete `/data/foxden.sqlite.replaced` and its `-wal` and `-shm` files.

Restoring undoes everything since the backup: password changes revert, newer devices are signed out and newer sync data
is gone from the server. Browsers keep their own local copy.

## Upgrading

Foxden migrates its database on startup and migrations can't be undone, so [back up](#backups) first. Then pull and
restart from the directory that holds `compose.yml`:

```sh
docker compose pull
docker compose up -d
```

## Blocking password guessing

Foxden limits each client to 50 requests per 5 seconds on each route, grouping IPv6 clients by /64. It has no separate
limit on password guesses. If Foxden is open to the internet, block repeat offenders with
[fail2ban](https://github.com/fail2ban/fail2ban), a VPN or your proxy's own limits.

This fail2ban setup bans clients that repeatedly fail to sign in or change a password or email address.

1. Have Foxden write its log to the data volume, by adding these settings under `environment:`:

   ```yaml
   LOG_FILE_PATH: /data/logs
   LOG_FILE_PRETTY: 'false'
   ```

2. Create `/etc/fail2ban/filter.d/foxden.conf`:

   ```ini
   [Definition]
   failregex = "client":"<ADDR>","request":\{"method":"POST","path":"(?i:/(?:auth/v1/account/login|auth/v1/password/change/start|api/v1/user/email))/?"\},"response":\{"statusCode":(?:400|429),
   datepattern = "time":{LEPOCH}
   ```

3. Find where the data volume lives on the host. For a Compose project named `foxden`:

   ```sh
   docker volume inspect --format '{{ .Mountpoint }}' foxden_data
   ```

4. Create `/etc/fail2ban/jail.d/foxden.conf`, with `logpath` set to `logs/all.log` inside that directory:

   ```ini
   [foxden]
   enabled = true
   filter = foxden
   backend = auto
   logpath = /path/to/foxden-data/logs/all.log
   port = http,https
   maxretry = 10
   findtime = 10m
   bantime = 1h
   ```

   Firefox may retry a wrong password with different email casing, so `maxretry` allows two attempts per mistake. If
   your reverse proxy runs in Docker, also add `banaction = iptables-multiport` and `chain = DOCKER-USER`, so bans
   apply to traffic Docker forwards.

5. Reload fail2ban and check the jail:

   ```sh
   sudo fail2ban-client reload
   sudo fail2ban-client status foxden
   ```

## Settings

Set these under `environment:` in `compose.yml`, then run `docker compose up -d` to apply them. Quote `true` and
`false` in YAML, such as `'false'`. Foxden validates every setting at startup.

| Setting                          | Default                            | Description                                                                                |
| -------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------ |
| `WEB_APP_BASE_URL`               |                                    | Required. Your public URL, e.g. `https://sync.example.com`, no trailing slash.             |
| `TRUST_PROXY`                    | `loopback, linklocal, uniquelocal` | The proxy addresses Foxden trusts, a hop count, or `true`/`false`.                         |
| `SESSION_WITHOUT_DEVICE_EXPIRY`  | `1d`                               | How long a web app sign-in lasts. `0` never expires. Firefox's sign-in to Sync never does. |
| `INVITE_EXPIRY`                  | `7d`                               | How long an invite link works.                                                             |
| `PASSWORD_RESET_EXPIRY`          | `1d`                               | How long a password reset link works.                                                      |
| `BACKUP_RETENTION`               | `7`                                | How many backups to keep.                                                                  |
| `BATCH_JOB_BACKUP_DATABASE_CRON` | `23 3 * * *`                       | When to back up, in cron syntax. Times are UTC unless `TZ` is set.                         |
| `LOG_STDOUT_LEVEL`               | `info`                             | Log level for container output.                                                            |
| `LOG_FILE_PATH`                  |                                    | Directory for a log file. Blank turns file logging off.                                    |
| `LOG_FILE_PRETTY`                | `true`                             | Write the log file as readable text. `false` writes one JSON object per line.              |

### Email

Email is optional, and only sends invite links. Without it, copy each link from **Invites** and send it yourself. A
failed send is logged and the invite is still created.

| Setting               | Default | Description                                                          |
| --------------------- | ------- | -------------------------------------------------------------------- |
| `EMAIL_SMTP_HOST`     |         | SMTP server. Leave empty to turn email off.                          |
| `EMAIL_FROM_ADDRESS`  |         | The address emails are sent from.                                    |
| `EMAIL_SMTP_USERNAME` |         | SMTP username. Leave empty if your server doesn't need one.          |
| `EMAIL_SMTP_PASSWORD` |         | SMTP password.                                                       |
| `EMAIL_SMTP_PORT`     | `587`   | SMTP port. 587 uses STARTTLS. For 465, also set `EMAIL_SMTP_SECURE`. |
| `EMAIL_SMTP_SECURE`   | `false` | Use implicit TLS (port 465).                                         |

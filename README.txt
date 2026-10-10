# AVITECH Assessment Platform

## Security / production changes in this build

- Server-side result validation: `isCorrect`, `rightAnswer`, score and question count are no longer trusted from the browser.
- Each attempt must submit exactly the server-defined number of questions (15 by default), with unique valid question IDs.
- Authoritative answers are loaded from the server question bank when an attempt is finished.
- Completed attempts cannot be overwritten/replayed.
- Flask session secret is loaded from `AVITECH_SECRET_KEY`; a temporary random key is generated only when the variable is absent.
- CSRF protection is enabled for all state-changing form/API requests.
- The first registered account is no longer automatically an administrator.
- Set `AVITECH_ADMIN_EMAIL` to designate an administrator during registration.
- MySQL password must be supplied through `AVITECH_DB_PASSWORD`.
- MySQL connections use a connection pool.
- Proctoring snapshots are stored outside `static/` and are served only through an authenticated endpoint.
- `completed_at` is nullable until an attempt actually finishes.
- Invalid assessment banks are rejected instead of silently becoming IT.
- `/accept` is POST-only.
- Result pages hydrate the authoritative score/details from the server instead of relying only on localStorage.
- Proctoring now warns when the face is missing for 3 seconds and terminates after 10 seconds.
- Window blur is logged as a warning and requires repeated focus loss before termination.
- The inactive coding timer code was removed because the previous build explicitly disabled it.
- Invalid CSS placed after `</html>` was moved into the document head.
- Legacy quiz code remains isolated for compatibility with the existing landing page; the active assessment flow uses `/quiz`, `/theory`, `/coding` and `/api/attempt/*`.

## Environment

PowerShell example:

```powershell
$env:AVITECH_SECRET_KEY="generate-a-long-random-secret"
$env:AVITECH_DB_HOST="localhost"
$env:AVITECH_DB_PORT="3306"
$env:AVITECH_DB_USER="root"
$env:AVITECH_DB_PASSWORD="your-real-password"
$env:AVITECH_DB_NAME="avitec"
$env:AVITECH_ADMIN_EMAIL="admin@example.com"
```

Install:

```powershell
pip install -r requirements.txt
```

Run locally:

```powershell
python app.py
```

The Flask development server is intentionally started with `debug=False`.

## Important coding-evaluation note

Coding submissions are now evaluated on the server against the authoritative reference solution, so the browser can no longer forge `isCorrect` or `correctCode`.

The current safe implementation uses normalized reference-code comparison. It does **not** execute arbitrary candidate code on the Flask host. For true execution-based grading, connect a dedicated sandbox/container execution service with CPU, memory, filesystem and network restrictions. Do not execute untrusted submissions directly inside Flask.

## Proctoring storage

New snapshots are stored under:

```text
private/proctoring/<attempt-id>/
```

They are not publicly accessible as `/static/...` files. Access is checked against the logged-in user or an administrator.

## API notes

- `POST /api/attempt/start`
- `POST /api/attempt/finish`
- `GET /api/attempt/<attempt_id>/result`
- `GET /api/attempt/<attempt_id>/proctoring`
- `GET /api/proctor/snapshot/<attempt_id>/<filename>`
- `POST /api/proctor/event`
- `GET /api/my-history`
- `GET /api/my-profile`

The old `/api/score` endpoint is intentionally not part of the active assessment API.

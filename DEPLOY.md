# Deploy AVITECH for free (GitHub + PythonAnywhere)

GitHub stores the code. PythonAnywhere (free) runs the Flask app and the MySQL database.
Your live URL will be: `https://YOURUSERNAME.pythonanywhere.com`

## Part 1 - Push to GitHub

1. Create a free account at github.com, then click **New repository**.
   Name it `avitech`, leave it empty (no README/.gitignore), click **Create**.
2. In a terminal inside this project folder:

```bash
git remote add origin https://github.com/YOUR_GITHUB_USERNAME/avitech.git
git branch -M main
git push -u origin main
```

(If asked for a password, GitHub needs a Personal Access Token: GitHub > Settings >
Developer settings > Personal access tokens. Or use GitHub Desktop instead.)

## Part 2 - PythonAnywhere account + database

1. Sign up (free "Beginner" plan) at pythonanywhere.com. Remember your username.
2. **Databases** tab > set a MySQL password > click **Initialize MySQL**.
3. Create a database named `avitech`. Its full name will be `YOURUSERNAME$avitech`.

## Part 3 - Get the code onto PythonAnywhere

Open a **Bash console** (Consoles tab) and run:

```bash
git clone https://github.com/YOUR_GITHUB_USERNAME/avitech.git
cd avitech
mkvirtualenv avitech --python=python3.10
pip install -r requirements.txt
```

## Part 4 - Create the web app

1. **Web** tab > **Add a new web app** > **Manual configuration** > Python 3.10.
2. **Virtualenv** field: `/home/YOURUSERNAME/.virtualenvs/avitech`
3. **Source code** field: `/home/YOURUSERNAME/avitech`
4. **Static files** table: URL `/static/`  ->  Directory `/home/YOURUSERNAME/avitech/static`
5. Click the **WSGI configuration file** link, delete everything, and paste:

```python
import os, sys

path = "/home/YOURUSERNAME/avitech"
if path not in sys.path:
    sys.path.insert(0, path)

os.environ["AVITECH_SECRET_KEY"] = "PASTE-A-LONG-RANDOM-STRING"
os.environ["AVITECH_DB_HOST"] = "YOURUSERNAME.mysql.pythonanywhere-services.com"
os.environ["AVITECH_DB_PORT"] = "3306"
os.environ["AVITECH_DB_USER"] = "YOURUSERNAME"
os.environ["AVITECH_DB_PASSWORD"] = "YOUR-MYSQL-PASSWORD"
os.environ["AVITECH_DB_NAME"] = "YOURUSERNAME$avitech"
os.environ["AVITECH_ADMIN_EMAIL"] = "your-admin-email@example.com"
os.environ["AVITECH_DB_POOL_SIZE"] = "3"

from app import app as application
```

   Generate a secret key with: `python -c "import secrets; print(secrets.token_hex(32))"`

6. Click the green **Reload** button. Visit your URL. Tables are created automatically
   on first load.
7. Register using the email you set as `AVITECH_ADMIN_EMAIL` to get the admin account.

## Updating the live site later

```bash
# on your computer
git add . && git commit -m "update" && git push
# on PythonAnywhere (Bash console)
cd ~/avitech && git pull
# then press Reload on the Web tab
```

## Free-tier things to know

- The WSGI file is NOT in GitHub, so your passwords never get published.
- Free accounts must click **"Run until 3 months from today"** on the Web tab
  every few months, or the site is disabled.
- HTTPS is automatic, which the webcam proctoring needs.
- Free MySQL is small (512 MB total disk), plenty for this project.
- Proctoring snapshots are saved in `~/avitech/private/proctoring`; they count
  against the 512 MB disk quota.

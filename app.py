from flask import Flask, render_template, jsonify, request, redirect, session, abort, send_file
from pathlib import Path
from werkzeug.security import generate_password_hash, check_password_hash
import mysql.connector
from mysql.connector import IntegrityError
from datetime import datetime, timezone
import json
import re
import os
import secrets
import shutil
from mysql.connector import pooling
from coding_evaluator import evaluate_code

# Create the Flask application before registering routes or configuring it.
app = Flask(__name__)

@app.route("/health")
def health():
    return {"status": "ok"}, 200
# Never commit a production session secret. Set AVITECH_SECRET_KEY in the environment.
app.secret_key = os.environ.get("AVITECH_SECRET_KEY")
if not app.secret_key:
    app.secret_key = secrets.token_hex(32)
    app.logger.warning("AVITECH_SECRET_KEY is not set; a temporary session secret is being used.")

BASE = Path(__file__).resolve().parent / "static" / "data"
DB_PATH = Path(__file__).resolve().parent / "avitec.db"  # optional one-time local migration
PRIVATE_PROCTOR_DIR = Path(__file__).resolve().parent / "private" / "proctoring"
DB_POOL = None

from mysql_config import (
    MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE
)


def csrf_token():
    token = session.get("_csrf_token")
    if not token:
        token = secrets.token_urlsafe(32)
        session["_csrf_token"] = token
    return token


@app.context_processor
def inject_security_helpers():
    return {"csrf_token": csrf_token}


@app.before_request
def enforce_csrf():
    if request.method not in {"POST", "PUT", "PATCH", "DELETE"}:
        return None
    token = request.headers.get("X-CSRF-Token") or request.form.get("_csrf_token")
    expected = session.get("_csrf_token")
    if not expected or not token or not secrets.compare_digest(str(token), str(expected)):
        if request.path.startswith("/api/"):
            return jsonify({"ok": False, "error": "csrf_failed"}), 403
        return "CSRF validation failed.", 403
    return None


def init_pool():
    global DB_POOL
    DB_POOL = pooling.MySQLConnectionPool(
        pool_name="avitec_pool",
        pool_size=int(os.environ.get("AVITECH_DB_POOL_SIZE", "8")),
        pool_reset_session=True,
        **mysql_config()
    )


def now():
    return datetime.now(timezone.utc).isoformat()


def mysql_config(include_database=True):
    config = {
        "host": MYSQL_HOST,
        "port": MYSQL_PORT,
        "user": MYSQL_USER,
        "password": MYSQL_PASSWORD,
    }
    if include_database:
        config["database"] = MYSQL_DATABASE
    return config


class MySQLCompat:
    """Small SQLite-like wrapper so the existing Flask routes need minimal changes."""
    def __init__(self, connection):
        self.connection = connection

    def execute(self, sql, params=()):
        sql = sql.replace("?", "%s")
        cursor = self.connection.cursor(dictionary=True)
        cursor.execute(sql, params)
        return cursor

    def executescript(self, script):
        cursor = self.connection.cursor()
        for statement in script.split(";"):
            statement = statement.strip()
            if statement:
                statement = statement.replace("INTEGER PRIMARY KEY AUTOINCREMENT", "INT NOT NULL AUTO_INCREMENT PRIMARY KEY")
                statement = statement.replace("INTEGER PRIMARY KEY", "INT PRIMARY KEY")
                statement = statement.replace("REAL NOT NULL", "DECIMAL(7,2) NOT NULL")
                statement = statement.replace("TEXT", "TEXT")
                cursor.execute(statement)
        cursor.close()

    def commit(self):
        self.connection.commit()

    def close(self):
        self.connection.close()


def ensure_database():
    if not MYSQL_PASSWORD:
        raise RuntimeError(
            "MySQL password is missing. Set AVITECH_DB_PASSWORD in the environment "
            "(AVITECH_DB_PASSWORD is required)."
        )
    try:
        conn = mysql.connector.connect(**mysql_config(include_database=False))
        cur = conn.cursor()
        cur.execute(
            f"CREATE DATABASE IF NOT EXISTS `{MYSQL_DATABASE}` "
            "CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
        )
        cur.close()
        conn.close()
    except mysql.connector.Error as exc:
        # Shared hosts (e.g. PythonAnywhere) create the database from a dashboard
        # and may not allow CREATE DATABASE. If it already exists, carry on.
        app.logger.warning("Skipping CREATE DATABASE (%s); assuming it already exists.", exc)


def get_db():
    if DB_POOL is None:
        init_pool()
    return MySQLCompat(DB_POOL.get_connection())


def init_db():
    ensure_database()
    conn = get_db()
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS users (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(320) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        created_at VARCHAR(64) NOT NULL,
        last_login VARCHAR(64),
        is_admin TINYINT(1) NOT NULL DEFAULT 0
    ) ENGINE=InnoDB;

    CREATE TABLE IF NOT EXISTS test_attempts (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        bank VARCHAR(50) NOT NULL,
        subject VARCHAR(255),
        started_at VARCHAR(64) NOT NULL,
        completed_at VARCHAR(64) NULL,
        score INT NOT NULL DEFAULT 0,
        total_questions INT NOT NULL DEFAULT 15,
        correct INT NOT NULL DEFAULT 0,
        wrong INT NOT NULL DEFAULT 0,
        skipped INT NOT NULL DEFAULT 0,
        percentage DECIMAL(7,2) NOT NULL DEFAULT 0,
        ended_by VARCHAR(50),
        CONSTRAINT fk_attempt_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;

    CREATE TABLE IF NOT EXISTS question_answers (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        attempt_id INT NOT NULL,
        question_no INT NOT NULL,
        question_id VARCHAR(255),
        question_text TEXT NOT NULL,
        selected_answer TEXT,
        correct_answer TEXT,
        is_correct TINYINT(1) NOT NULL DEFAULT 0,
        is_skipped TINYINT(1) NOT NULL DEFAULT 0,
        difficulty VARCHAR(100),
        topic VARCHAR(255),
        subtopic VARCHAR(255),
        time_taken INT DEFAULT 0,
        evaluation_json LONGTEXT NULL,
        CONSTRAINT fk_answer_attempt FOREIGN KEY(attempt_id) REFERENCES test_attempts(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;

    CREATE TABLE IF NOT EXISTS lifeline_usage (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        attempt_id INT NOT NULL,
        question_no INT NOT NULL,
        question_id VARCHAR(255),
        lifeline VARCHAR(100) NOT NULL,
        used_at VARCHAR(64) NOT NULL,
        CONSTRAINT fk_lifeline_attempt FOREIGN KEY(attempt_id) REFERENCES test_attempts(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;
    CREATE TABLE IF NOT EXISTS proctor_events (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        attempt_id INT NOT NULL,
        user_id INT NOT NULL,
        event_type VARCHAR(100) NOT NULL,
        occurred_at VARCHAR(64) NOT NULL,
        details TEXT,
        snapshot_path VARCHAR(500),
        duration_ms BIGINT DEFAULT 0,
        CONSTRAINT fk_proctor_attempt FOREIGN KEY(attempt_id) REFERENCES test_attempts(id) ON DELETE CASCADE,
        CONSTRAINT fk_proctor_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;
    """)
    try:
        cur = conn.connection.cursor()
        cur.execute("ALTER TABLE test_attempts MODIFY completed_at VARCHAR(64) NULL")
        cur.close()
        conn.commit()
    except Exception:
        conn.connection.rollback()
    try:
        cur = conn.connection.cursor()
        cur.execute("ALTER TABLE question_answers ADD COLUMN evaluation_json LONGTEXT NULL")
        cur.close()
        conn.commit()
    except Exception:
        conn.connection.rollback()
    conn.close()
    migrate_sqlite_if_needed()


def migrate_sqlite_if_needed():
    """Copy an existing avitec.db into MySQL once, if it exists."""
    if not DB_PATH.exists():
        return
    import sqlite3
    source = sqlite3.connect(DB_PATH)
    source.row_factory = sqlite3.Row
    target = get_db()
    try:
        existing = target.execute("SELECT COUNT(*) AS n FROM users").fetchone()["n"]
        if existing:
            return
        tables = ["users", "test_attempts", "question_answers", "lifeline_usage", "proctor_events"]
        for table in tables:
            rows = source.execute(f"SELECT * FROM {table}").fetchall()
            if not rows:
                continue
            columns = rows[0].keys()
            placeholders = ",".join(["%s"] * len(columns))
            sql = f"INSERT INTO {table} ({','.join(columns)}) VALUES ({placeholders})"
            cur = target.connection.cursor()
            for row in rows:
                cur.execute(sql, tuple(row))
            cur.close()
        target.commit()
    finally:
        target.close()
        source.close()


def load_bank(category):
    filename = "aviation_mcq_questions.json" if category == "aviation" else "It_mcq_questions.json"
    with open(BASE / filename, "r", encoding="utf-8") as f:
        return json.load(f)["questions"]


def login_required():
    return session.get("user_id") is not None


def is_terminated_reason(reason):
    text = str(reason or "").strip().casefold()
    if not text or text in {"completed", "complete", "finished", "submitted"}:
        return False
    # finishTest() is called with the specific proctoring reason (for example,
    # "Repeated window focus loss"), not always the literal word "terminated".
    # Treat every explicit non-completion end reason as a terminated attempt.
    return True


@app.route("/")
def index():
    return render_template("index.html", user=session.get("user_name"))


@app.route("/login", methods=["GET", "POST"])
def login():
    error = ""
    if request.method == "POST":
        email = request.form.get("email", "").strip().lower()
        password = request.form.get("password", "")
        conn = get_db()
        user = conn.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
        if user and check_password_hash(user["password_hash"], password):
            session["user_id"] = user["id"]
            session["user_name"] = user["name"]
            session["is_admin"] = bool(user["is_admin"])
            conn.execute("UPDATE users SET last_login=? WHERE id=?", (now(), user["id"]))
            conn.commit()
            conn.close()
            return redirect("/instructions")

        conn.close()
        if not user:
            error = "Account not found. Please create your account first."
        else:
            error = "Incorrect password. Please try again."
    return render_template("auth.html", mode="login", error=error)


@app.route("/register", methods=["GET", "POST"])
def register():
    error = ""
    if request.method == "POST":
        name = request.form.get("name", "").strip()
        email = request.form.get("email", "").strip().lower()
        password = request.form.get("password", "")
        if not name or not email or len(password) < 6:
            error = "Enter your name, a valid email and a password of at least 6 characters."
        else:
            conn = get_db()
            try:
                admin_email = os.environ.get("AVITECH_ADMIN_EMAIL", "").strip().lower()
                is_admin = bool(admin_email and email == admin_email)
                cur = conn.execute(
                    "INSERT INTO users(name,email,password_hash,created_at,is_admin) VALUES(?,?,?,?,?)",
                    (name, email, generate_password_hash(password), now(), 1 if is_admin else 0)
                )
                conn.commit()
                session["user_id"] = cur.lastrowid
                session["user_name"] = name
                session["is_admin"] = is_admin
                conn.close()
                return redirect("/instructions")
            except IntegrityError:
                conn.close()
                error = "An account with this email already exists."
    return render_template("auth.html", mode="register", error=error)


@app.route("/logout")
def logout():
    session.clear()
    return redirect("/")


@app.route("/it-topic")
def it_topic():
    return render_template("it.html")


@app.route("/aviation-topic")
def aviation_topic():
    return render_template("aviation.html")


@app.route("/instructions")
def instructions():
    if not login_required():
        return redirect("/login")
    return render_template("instructions.html", user=session.get("user_name"))


@app.route("/accept", methods=["GET", "POST"])
def accept_instructions():
    if not login_required():
        return redirect("/login")
    return redirect("/learning")


@app.route("/learning")
def learning():
    if not login_required():
        return redirect("/login")
    return render_template("learning.html", user=session.get("user_name"))


@app.route("/start/<category>")
def start_test(category):
    if not login_required():
        return redirect("/login")
    if category not in {"aviation", "it"}:
        abort(404)
    return redirect(f"/quiz?bank={category}")


@app.route("/quiz")
def quiz():
    if not login_required():
        return redirect("/login")
    return render_template("quiz.html", user=session.get("user_name"))


@app.route("/coding")
def coding():
    if not login_required():
        return redirect("/login")
    return render_template("coding.html", user=session.get("user_name"))


@app.route("/theory")
def theory_test():
    if not login_required():
        return redirect("/login")
    return render_template("theory.html", user=session.get("user_name"))


@app.route("/result")
def result_page():
    if not login_required():
        return redirect("/login")
    return render_template("result.html", user=session.get("user_name"))



@app.route("/progress")
def progress_page():
    if not login_required():
        return redirect("/login")
    conn = get_db()
    user = conn.execute(
        "SELECT id,name,email,created_at,last_login,is_admin FROM users WHERE id=?",
        (session["user_id"],)
    ).fetchone()
    attempts = conn.execute("""
        SELECT a.id,a.bank,a.subject,a.started_at,a.completed_at,a.score,a.total_questions,
               a.correct,a.wrong,a.skipped,a.percentage,a.ended_by,
               CASE WHEN EXISTS(
                   SELECT 1 FROM proctor_events pe
                   WHERE pe.attempt_id=a.id
                     AND pe.user_id=a.user_id
                     AND pe.event_type='TEST_TERMINATED'
               ) THEN 1 ELSE 0 END AS termination_event
        FROM test_attempts a
        WHERE a.user_id=?
        ORDER BY a.id DESC
    """, (session["user_id"],)).fetchall()
    attempt_dicts = [dict(r) for r in attempts]
    for item in attempt_dicts:
        # Treat either the canonical DB flag OR a recorded TEST_TERMINATED
        # proctoring event as authoritative. This prevents old attempts with
        # a legacy termination reason from appearing as Completed.
        if item.get("termination_event") or is_terminated_reason(item.get("ended_by")):
            item["ended_by"] = "terminated"

    completed_attempts = [
        item for item in attempt_dicts
        if item["completed_at"] and item["ended_by"] != "terminated"
    ]
    totals = {
        "tests": len(completed_attempts),
        "correct": sum(r["correct"] for r in completed_attempts),
        "wrong": sum(r["wrong"] for r in completed_attempts),
        "skipped": sum(r["skipped"] for r in completed_attempts),
        "best": max((r["percentage"] for r in completed_attempts), default=0),
        "avg": round(sum(r["percentage"] for r in completed_attempts)/len(completed_attempts), 1)
            if completed_attempts else 0
    }
    conn.close()
    return render_template(
        "progress.html",
        user=dict(user),
        attempts=attempt_dicts,
        totals=totals,
        is_admin=bool(user["is_admin"])
    )


@app.route("/admin/users/<int:user_id>/delete", methods=["POST"])
def admin_delete_user(user_id):
    """Delete a non-admin user and all related quiz data via FK cascades."""
    if not session.get("user_id") or not session.get("is_admin"):
        return redirect("/login")

    conn = get_db()
    try:
        target = conn.execute("SELECT id, name, email, is_admin FROM users WHERE id=?", (user_id,)).fetchone()
        if not target:
            return redirect("/admin")

        # Admin accounts are protected from deletion.
        if target["is_admin"]:
            return redirect("/admin")

        conn.execute("DELETE FROM users WHERE id=?", (user_id,))
        conn.commit()
    finally:
        conn.close()
    return redirect("/admin")


@app.route("/admin")
def admin_page():
    if not login_required():
        return redirect("/login")
    conn = get_db()
    me = conn.execute("SELECT is_admin FROM users WHERE id=?", (session["user_id"],)).fetchone()
    if not me or not me["is_admin"]:
        conn.close()
        return "Access denied. Admin account required.", 403

    users = conn.execute("""
        SELECT u.id,u.name,u.email,u.created_at,u.last_login,u.is_admin,
               COUNT(a.id) AS tests,
               COALESCE(ROUND(AVG(a.percentage),1),0) AS avg_score,
               COALESCE(MAX(a.percentage),0) AS best_score
        FROM users u
        LEFT JOIN test_attempts a ON a.user_id=u.id
        GROUP BY u.id
        ORDER BY u.id DESC
    """).fetchall()

    attempts = conn.execute("""
        SELECT a.*, u.name, u.email
        FROM test_attempts a
        JOIN users u ON u.id=a.user_id
        ORDER BY a.id DESC
    """).fetchall()

    stats = {
        "users": conn.execute("SELECT COUNT(*) AS n FROM users").fetchone()["n"],
        "tests": conn.execute("SELECT COUNT(*) AS n FROM test_attempts").fetchone()["n"],
        "questions": conn.execute("SELECT COUNT(*) AS n FROM question_answers").fetchone()["n"],
        "avg": conn.execute("SELECT COALESCE(ROUND(AVG(percentage),1),0) AS n FROM test_attempts").fetchone()["n"]
    }
    conn.close()
    return render_template(
        "admin.html",
        user_name=session.get("user_name"),
        users=[dict(r) for r in users],
        attempts=[dict(r) for r in attempts],
        stats=stats
    )

@app.get("/api/questions/<category>")
def api_questions(category):
    if category not in {"aviation", "it"}:
        return jsonify({"ok": False, "error": "invalid_bank"}), 404
    questions = load_bank(category)
    subject = (request.args.get("subject") or "").strip()
    if subject:
        questions = [q for q in questions if q.get("topic") == subject]
    return jsonify(questions[:15])


@app.post("/api/proctor/permissions")
def proctor_permissions():
    """Record that the browser successfully granted both camera and microphone access."""
    if not login_required():
        return jsonify({"ok": False, "error": "login_required"}), 401
    data = request.get_json(silent=True) or {}
    if data.get("camera") is not True or data.get("microphone") is not True:
        session.pop("proctor_permissions", None)
        return jsonify({"ok": False, "error": "camera_and_microphone_required"}), 400
    session["proctor_permissions"] = True
    return jsonify({"ok": True})


@app.post("/api/attempt/start")
def attempt_start():
    if not login_required():
        return jsonify({"ok": False, "error": "login_required"}), 401
    if not session.get("proctor_permissions"):
        return jsonify({"ok": False, "error": "camera_microphone_permission_required"}), 403
    data = request.get_json(silent=True) or {}
    bank = str(data.get("bank") or "it").strip().lower()
    subject = (str(data.get("subject")).strip() if data.get("subject") is not None else None)
    if bank not in {"it", "aviation"}:
        return jsonify({"ok": False, "error": "invalid_bank"}), 400

    started = now()
    conn = get_db()
    try:
        cur = conn.execute(
            "INSERT INTO test_attempts(user_id,bank,subject,started_at,completed_at,total_questions) VALUES(?,?,?,?,?,?)",
            (session["user_id"], bank, subject, started, None, 15)
        )
        conn.commit()
        attempt_id = cur.lastrowid
    finally:
        conn.close()

    session["attempt_id"] = attempt_id
    return jsonify({"ok": True, "attempt_id": attempt_id, "started_at": started, "total_questions": 15})


def delete_proctoring_snapshots(attempt_id):
    """Delete all webcam snapshots for an attempt after its result is finalized."""
    folder = (PRIVATE_PROCTOR_DIR / str(int(attempt_id))).resolve()
    base = PRIVATE_PROCTOR_DIR.resolve()
    try:
        if base == folder.parent and folder != base and folder.is_dir():
            shutil.rmtree(folder, ignore_errors=True)
    except Exception as exc:
        app.logger.warning("Could not delete proctoring snapshots for attempt %s: %s", attempt_id, exc)


@app.post("/api/proctor/event")
def proctor_event():
    if not login_required():
        return jsonify({"ok": False, "error": "login_required"}), 401

    data = request.get_json(silent=True) or {}
    attempt_id = data.get("attempt_id") or session.get("attempt_id")
    if not attempt_id:
        return jsonify({"ok": False, "error": "attempt_missing"}), 400

    conn = get_db()
    attempt = conn.execute(
        "SELECT id FROM test_attempts WHERE id=? AND user_id=?",
        (attempt_id, session["user_id"])
    ).fetchone()
    if not attempt:
        conn.close()
        return jsonify({"ok": False, "error": "attempt_not_found"}), 404

    event_type = str(data.get("event_type") or "UNKNOWN")[:100]
    occurred_at = str(data.get("occurred_at") or now())[:64]
    details = data.get("details") or {}
    try:
        details_text = json.dumps(details, ensure_ascii=False)
    except Exception:
        details_text = str(details)

    # Privacy policy: webcam frames are NOT persisted.
    # Proctoring stores event metadata only; no image is written to disk and
    # no snapshot path is generated.
    snapshot_path = None

    cur = conn.execute("""
        INSERT INTO proctor_events(
            attempt_id,user_id,event_type,occurred_at,details,snapshot_path,duration_ms
        ) VALUES(?,?,?,?,?,?,?)
    """, (
        int(attempt_id), session["user_id"], event_type, occurred_at,
        details_text, snapshot_path, int(data.get("duration_ms") or 0)
    ))
    conn.commit()
    event_id = cur.lastrowid
    conn.close()
    return jsonify({"ok": True, "event_id": event_id, "snapshot_path": snapshot_path})


@app.get("/api/proctor/snapshot/<int:attempt_id>/<path:filename>")
def proctor_snapshot(attempt_id, filename):
    if not login_required():
        return jsonify({"ok": False, "error": "login_required"}), 401
    conn = get_db()
    try:
        attempt = conn.execute(
            "SELECT id,user_id FROM test_attempts WHERE id=?",
            (attempt_id,)
        ).fetchone()
        if not attempt:
            return jsonify({"ok": False, "error": "not_found"}), 404
        is_owner = int(attempt["user_id"]) == int(session["user_id"])
        is_admin = bool(session.get("is_admin"))
        if not (is_owner or is_admin):
            return jsonify({"ok": False, "error": "forbidden"}), 403
    finally:
        conn.close()

    base = (PRIVATE_PROCTOR_DIR / str(attempt_id)).resolve()
    target = (base / filename).resolve()
    if base != target and base not in target.parents:
        return jsonify({"ok": False, "error": "invalid_path"}), 400
    if not target.is_file():
        return jsonify({"ok": False, "error": "not_found"}), 404
    return send_file(target)


@app.get("/api/attempt/<int:attempt_id>/proctoring")
def attempt_proctoring(attempt_id):
    if not login_required():
        return jsonify({"ok": False, "error": "login_required"}), 401
    conn = get_db()
    attempt = conn.execute(
        "SELECT id,ended_by,completed_at FROM test_attempts WHERE id=? AND user_id=?",
        (attempt_id, session["user_id"])
    ).fetchone()
    if not attempt:
        conn.close()
        return jsonify({"ok": False, "error": "attempt_not_found"}), 404
    rows = conn.execute("""
        SELECT id,event_type,occurred_at,details,snapshot_path,duration_ms
        FROM proctor_events
        WHERE attempt_id=? AND user_id=?
        ORDER BY id ASC
    """, (attempt_id, session["user_id"])).fetchall()
    conn.close()
    out=[]
    for r in rows:
        item=dict(r)
        try: item["details"]=json.loads(item["details"] or "{}")
        except Exception: item["details"]={}
        out.append(item)
    return jsonify({"ok": True, "attempt": dict(attempt), "events": out})


@app.post("/api/coding/evaluate")
def coding_evaluate():
    if not login_required():
        return jsonify({"ok": False, "error": "login_required"}), 401
    data=request.get_json(silent=True) or {}
    question_id=str(data.get("question_id") or "").strip()
    language=str(data.get("language") or "").strip()
    code=str(data.get("code") or "")
    if not question_id:
        return jsonify({"ok":False,"error":"question_missing"}),400
    from coding_evaluator import load_question
    q=load_question(question_id, language)
    if not q:
        return jsonify({"ok":False,"error":"question_not_found"}),404
    evaluation=evaluate_code(code,q)
    return jsonify({"ok":True,"evaluation":evaluation})


@app.post("/api/attempt/finish")
def attempt_finish():
    if not login_required():
        return jsonify({"ok": False, "error": "login_required"}), 401

    data = request.get_json(silent=True) or {}
    attempt_id = data.get("attempt_id") or session.get("attempt_id")
    if not attempt_id:
        return jsonify({"ok": False, "error": "attempt_missing"}), 400

    conn = get_db()
    try:
        attempt = conn.execute(
            "SELECT * FROM test_attempts WHERE id=? AND user_id=?",
            (attempt_id, session["user_id"])
        ).fetchone()
        if not attempt:
            return jsonify({"ok": False, "error": "attempt_not_found"}), 404
        if attempt["completed_at"]:
            return jsonify({"ok": False, "error": "attempt_already_finished"}), 409

        questions = data.get("questions")
        if not isinstance(questions, list):
            questions = []

        # A proctoring termination is a completed attempt record, but it is
        # intentionally NOT a scored/answerable result.  We keep the attempt
        # and its proctoring events for the report, while withholding all
        # question-wise answer rows from the result dashboard.
        ended_reason = str(data.get("endedBy") or "completed").strip()
        reason_lower = ended_reason.casefold()
        terminated = is_terminated_reason(ended_reason)

        expected_questions = int(attempt["total_questions"] or 15)
        if not terminated and len(questions) != expected_questions:
            return jsonify({
                "ok": False,
                "error": "invalid_question_count",
                "expected": expected_questions,
                "received": len(questions)
            }), 400

        test_type = str(data.get("test_type") or "mcq").strip().lower()
        bank = str(attempt["bank"]).lower()
        subject = (attempt["subject"] or "").strip()

        # Terminated attempts do not receive question-wise scoring.
        if terminated:
            authoritative = []
            correct = 0
            skipped = 0
            wrong = 0
            total = expected_questions
            percentage = 0
        else:
                # Load the authoritative answer key on the server. Never trust isCorrect/rightAnswer
            # values sent by the browser.
            if test_type == "coding":
                filename = "it_coding_questions.json"
                bank_questions = json.loads((BASE / filename).read_text(encoding="utf-8"))["questions"]
                if subject:
                    bank_questions = [q for q in bank_questions if str(q.get("language") or "").strip() == subject]
                answer_field = "correctCode"
            elif test_type == "theory":
                filename = "aviation_theory.json" if bank == "aviation" else "It_theory_questions.json"
                bank_questions = json.loads((BASE / filename).read_text(encoding="utf-8"))["questions"]
                if subject:
                    bank_questions = [
                        q for q in bank_questions
                        if str(q.get("topic") or q.get("language") or "").strip() == subject
                    ]
                answer_field = "correctAnswer"
            else:
                bank_questions = load_bank(bank)
                if subject:
                    bank_questions = [q for q in bank_questions if str(q.get("topic") or "").strip() == subject]
                answer_field = "answer"

            # Some of the bundled question banks do not contain explicit IDs.
            # Build both ID and normalized-question-text indexes so those questions
            # can still be validated and persisted server-side.
            def norm_question(v):
                return re.sub(r"\s+", " ", str(v or "")).strip().casefold()

            by_id = {}
            by_text = {}
            for q in bank_questions:
                qid = str(q.get("id") or q.get("questionId") or "").strip()
                if qid:
                    by_id[qid] = q
                qt = norm_question(q.get("question"))
                if qt:
                    by_text.setdefault(qt, q)

            if len(by_id) < int(attempt["total_questions"] or 15) and len(by_text) < int(attempt["total_questions"] or 15):
                return jsonify({"ok": False, "error": "question_bank_invalid"}), 500

            seen = set()
            authoritative = []
            for i, submitted in enumerate(questions, 1):
                submitted = submitted or {}
                qid = str(submitted.get("id") or "").strip()
                qtext = norm_question(submitted.get("question"))
                q = by_id.get(qid) if qid else None
                if q is None and qtext:
                    q = by_text.get(qtext)
                if q is None:
                    return jsonify({"ok": False, "error": "invalid_question", "question_no": i}), 400
                canonical_id = str(q.get("id") or q.get("questionId") or qtext)
                if canonical_id in seen:
                    return jsonify({"ok": False, "error": "duplicate_question", "question_no": i}), 400
                seen.add(canonical_id)
                skipped = bool((submitted or {}).get("skipped"))
                chosen = (submitted or {}).get("chosenAnswer")
                expected = q.get(answer_field)
                evaluation = None
                if test_type == "coding":
                    # Never compare source text with the reference solution.  The server
                    # evaluates the submitted implementation against behavioural/semantic
                    # checks and keeps the evaluation evidence with the answer row.
                    evaluation = evaluate_code(str(chosen or ""), q) if not skipped else {
                        "status": "SKIPPED", "score": 0, "summary": "Question skipped."
                    }
                    is_correct = (not skipped) and str(evaluation.get("status")) == "PASS"
                    # The result page should never expose the reference implementation.
                    expected = evaluation.get("summary") or "Server-side coding evaluation"
                elif test_type == "theory":
                    normalize = lambda v: re.sub(r"\s+", " ", str(v or "")).strip().casefold()
                    is_correct = (not skipped) and normalize(chosen) == normalize(expected)
                else:
                    is_correct = (not skipped) and str(chosen or "") == str(expected or "")

                authoritative.append({
                    "id": canonical_id,
                    "question": q.get("question", ""),
                    "selected_answer": chosen,
                    "correct_answer": expected,
                    "is_correct": bool(is_correct),
                    "is_skipped": skipped,
                    "difficulty": q.get("difficulty"),
                    "topic": q.get("topic") or q.get("language") or subject,
                    "subtopic": q.get("subtopic") or q.get("topic") or q.get("language") or subject,
                    "time_taken": max(0, int((submitted or {}).get("timeTaken") or 0)),
                    "evaluation": evaluation
                })

            if test_type == "coding":
                # Server-side enforcement of the coding-test pattern:
                # 8 Easy + 3 Medium + 3 Hard + 1 Advanced = 15, with no duplicate
                # question text in the same test. This prevents a modified client
                # from submitting a different composition.
                difficulty_counts = {"Easy": 0, "Medium": 0, "Hard": 0, "Advanced": 0}
                seen_question_texts = set()
                for aq in authoritative:
                    d = str(aq.get("difficulty") or "").strip()
                    if d in difficulty_counts:
                        difficulty_counts[d] += 1
                    qkey = norm_question(aq.get("question"))
                    if qkey in seen_question_texts:
                        return jsonify({"ok": False, "error": "duplicate_question"}), 400
                    seen_question_texts.add(qkey)
                if difficulty_counts != {"Easy": 8, "Medium": 3, "Hard": 3, "Advanced": 1}:
                    return jsonify({
                        "ok": False,
                        "error": "invalid_coding_difficulty_pattern",
                        "expected": {"Easy": 8, "Medium": 3, "Hard": 3, "Advanced": 1},
                        "received": difficulty_counts
                    }), 400

            correct = sum(1 for q in authoritative if q["is_correct"] and not q["is_skipped"])
            skipped = sum(1 for q in authoritative if q["is_skipped"])
            wrong = len(authoritative) - correct - skipped
            total = len(authoritative)
            percentage = round((correct / total) * 100, 2) if total else 0

        conn.execute("DELETE FROM question_answers WHERE attempt_id=?", (attempt_id,))
        conn.execute("DELETE FROM lifeline_usage WHERE attempt_id=?", (attempt_id,))

        for i, q in enumerate(authoritative, 1):
            conn.execute("""
                INSERT INTO question_answers(
                    attempt_id,question_no,question_id,question_text,selected_answer,
                    correct_answer,is_correct,is_skipped,difficulty,topic,subtopic,time_taken,evaluation_json
                ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
            """, (
                attempt_id, i, q["id"], q["question"], q["selected_answer"],
                q["correct_answer"], 1 if q["is_correct"] else 0,
                1 if q["is_skipped"] else 0, q["difficulty"],
                q["topic"], q["subtopic"], q["time_taken"],
                json.dumps(q.get("evaluation"), ensure_ascii=False) if q.get("evaluation") else None
            ))

        for item in data.get("lifelines") or []:
            conn.execute("""
                INSERT INTO lifeline_usage(attempt_id,question_no,question_id,lifeline,used_at)
                VALUES(?,?,?,?,?)
            """, (
                attempt_id, int(item.get("questionNo") or 0),
                str(item.get("questionId") or ""),
                str(item.get("lifeline") or "")[:100], item.get("usedAt") or now()
            ))

        # Persist the subject explicitly submitted by the page that owns this
        # attempt. A legacy/stale subject value must not survive into its result.
        final_subject = str(data.get("subject") or attempt["subject"] or "").strip() or None
        conn.execute("""
            UPDATE test_attempts
            SET subject=?, completed_at=?, score=?, total_questions=?,
                correct=?, wrong=?, skipped=?, percentage=?, ended_by=?
            WHERE id=? AND user_id=? AND completed_at IS NULL
        """, (
            final_subject, now(), correct, total, correct, wrong, skipped,
            percentage, ("terminated" if terminated else "completed"), attempt_id, session["user_id"]
        ))
        conn.commit()
        # Webcam snapshots are never persisted. Only proctoring event metadata
        # remains in the database.

    finally:
        conn.close()

    session.pop("attempt_id", None)
    session.pop("proctor_permissions", None)
    return jsonify({
        "ok": True,
        "attempt_id": attempt_id,
        "correct": correct,
        "wrong": wrong,
        "skipped": skipped,
        "total": total,
        "percentage": percentage,
        "terminated": terminated,
        "questions": authoritative
    })


@app.get("/api/attempt/<int:attempt_id>/result")
def attempt_result(attempt_id):
    if not login_required():
        return jsonify({"ok": False, "error": "login_required"}), 401
    conn = get_db()
    try:
        attempt = conn.execute("""
            SELECT a.id,a.bank,a.subject,a.started_at,a.completed_at,a.score,a.total_questions,
                   a.correct,a.wrong,a.skipped,a.percentage,a.ended_by,
                   CASE WHEN EXISTS(
                       SELECT 1 FROM proctor_events pe
                       WHERE pe.attempt_id=a.id
                         AND pe.user_id=a.user_id
                         AND pe.event_type='TEST_TERMINATED'
                   ) THEN 1 ELSE 0 END AS termination_event
            FROM test_attempts a
            WHERE a.id=? AND a.user_id=?
        """, (attempt_id, session["user_id"])).fetchone()
        if not attempt:
            return jsonify({"ok": False, "error": "attempt_not_found"}), 404
        attempt_data = dict(attempt)
        terminated = bool(attempt_data.get("termination_event")) or is_terminated_reason(attempt_data.get("ended_by"))
        if terminated:
            attempt_data["ended_by"] = "terminated"
        attempt_data.pop("termination_event", None)
        # Terminated attempts must never expose question-wise answers.
        if terminated:
            rows = []
        else:
            rows = conn.execute("""
                SELECT question_no,question_id,question_text,selected_answer,
                       correct_answer,is_correct,is_skipped,difficulty,topic,subtopic,time_taken,evaluation_json
                FROM question_answers
                WHERE attempt_id=?
                ORDER BY question_no ASC
            """, (attempt_id,)).fetchall()
    finally:
        conn.close()
    result_rows=[]
    for r in rows:
        item=dict(r)
        try:
            item["evaluation"] = json.loads(item.pop("evaluation_json") or "null")
        except Exception:
            item["evaluation"] = None
        result_rows.append(item)
    return jsonify({
        "ok": True,
        "attempt": attempt_data,
        "terminated": terminated,
        "questions": result_rows
    })


@app.get("/api/my-history")
def my_history():
    if not login_required():
        return jsonify({"ok": False, "error": "login_required"}), 401
    conn = get_db()
    rows = conn.execute("""
        SELECT id,bank,subject,started_at,completed_at,score,total_questions,
               correct,wrong,skipped,percentage,ended_by
        FROM test_attempts WHERE user_id=? ORDER BY id DESC
    """, (session["user_id"],)).fetchall()
    conn.close()
    return jsonify({"ok": True, "history": [dict(r) for r in rows]})


@app.get("/api/my-profile")
def my_profile():
    if not login_required():
        return jsonify({"ok": False, "error": "login_required"}), 401
    conn = get_db()
    u = conn.execute(
        "SELECT id,name,email,created_at,last_login,is_admin FROM users WHERE id=?",
        (session["user_id"],)
    ).fetchone()
    conn.close()
    return jsonify({"ok": True, "user": dict(u)})


init_db()

if __name__ == "__main__":
    app.run(debug=False, host="127.0.0.1", port=5000)

# Main on 21 — Login + User Progress + Eye Detection

This build merges the login/progress/proctoring system from the previous integrated project into the current Main on 21 project.

## What is integrated

- MySQL-backed user registration/login/logout.
- Password hashing with Werkzeug.
- Session-based authentication.
- Protected Test, Instructions, Learning, Quiz, Coding, Theory, Result and Progress pages.
- Per-user test history stored in MySQL.
- Navbar Progress opens the logged-in user's own history.
- Progress metrics: tests given, average score, best score, correct, wrong and skipped.
- Current Main on 21 MCQ banks are preserved.
- Current Main on 21 quiz UI/lifelines/voice behavior is preserved.
- Eye-detection/proctoring from the previous project is integrated into the current quiz.
- Proctor events and bounded snapshots are stored against the user's test attempt.
- Admin page and user deletion from the previous login system are preserved.

## Database

Set these environment variables before starting:

AVITECH_DB_HOST=localhost
AVITECH_DB_PORT=3306
AVITECH_DB_USER=root
AVITECH_DB_PASSWORD=YOUR_MYSQL_PASSWORD
AVITECH_DB_NAME=avitec

The application creates the database/tables automatically on startup.

## Start

pip install -r requirements.txt

PowerShell:
$env:AVITECH_DB_PASSWORD="YOUR_MYSQL_PASSWORD"
python app.py

Open:
http://127.0.0.1:5000/

Create an account, complete a test, then open Navbar -> Progress. The completed attempt is saved for that logged-in user and appears in Test History.

Camera permission is required for the eye-detection/proctoring panel on the quiz page.


## Result / Proctoring Fixes (22 Sep 2026)
- MCQ now stores the exact server `attemptId` in `lastAttemptId` and `quizResult`.
- MCQ result now carries the proctoring summary/events just like Theory and Coding.
- Proctoring keeps the latest valid camera frame so Tab Switch / Window Blur events do not produce black snapshots.
- TEST_TERMINATED is recorded before the camera stream is stopped.
- Result page therefore reads the correct attempt's activity log and flagged snapshots across IT MCQ, IT Theory, IT Coding, Aviation MCQ and Aviation Theory.

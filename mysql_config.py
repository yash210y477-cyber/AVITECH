"""AVITECH MySQL configuration.

Preferred environment variables:
  AVITECH_DB_HOST       default: localhost
  AVITECH_DB_PORT       default: 3306
  AVITECH_DB_USER       default: root
  AVITECH_DB_PASSWORD   required
  AVITECH_DB_NAME       default: avitech

"""
import os


MYSQL_HOST = os.getenv("AVITECH_DB_HOST", "localhost")
MYSQL_PORT = int(os.getenv("AVITECH_DB_PORT", "3306"))
MYSQL_USER = os.getenv("AVITECH_DB_USER", "root")
MYSQL_PASSWORD = os.getenv("AVITECH_DB_PASSWORD")
MYSQL_DATABASE = os.getenv("AVITECH_DB_NAME", "avitec")

# =============================================================================
# setup_password.py -- First-Time Password Setup
# Adult Website Blocker Project
#
# Run this script ONCE (as any user -- no admin rights needed) to set the
# password that protects the 'remove' command in hosts_blocker.py.
#
# The plain-text password is NEVER stored.  Only its SHA-256 hash is
# written to config.json.
#
# Usage:
#   python setup_password.py
# =============================================================================

import os
import json
import hashlib
import getpass
import sys

# ---------------------------------------------------------------------------
# Path to config.json -- same directory as this script
# ---------------------------------------------------------------------------
SCRIPT_DIR  = os.path.dirname(os.path.abspath(__file__))
CONFIG_FILE = os.path.join(SCRIPT_DIR, "config.json")

MINIMUM_PASSWORD_LENGTH = 6   # enforce a basic minimum for security


def hash_password(plain: str) -> str:
    """Return the SHA-256 hex digest of the given plain-text string."""
    return hashlib.sha256(plain.encode("utf-8")).hexdigest()


def load_config() -> dict:
    """
    Load the existing config.json as a dict.
    Returns an empty dict if the file does not exist or is malformed.
    """
    if not os.path.isfile(CONFIG_FILE):
        return {}
    try:
        with open(CONFIG_FILE, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (json.JSONDecodeError, OSError):
        return {}


def save_config(data: dict):
    """Write the config dict to config.json (pretty-printed, UTF-8)."""
    with open(CONFIG_FILE, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2, ensure_ascii=False)
        fh.write("\n")  # trailing newline for clean diffs


def main():
    print("=" * 52)
    print("  Adult Website Blocker -- Password Setup")
    print("=" * 52)
    print()

    config = load_config()

    # ------------------------------------------------------------------
    # Warn the user if a password is already set and ask for confirmation
    # ------------------------------------------------------------------
    if config.get("password_hash"):
        print("[WARN] A password is already configured.")
        answer = input("Do you want to replace it? (yes/no): ").strip().lower()
        if answer not in ("yes", "y"):
            print("[ABORTED] Password unchanged.")
            sys.exit(0)
        print()

    # ------------------------------------------------------------------
    # Collect and validate the new password
    # ------------------------------------------------------------------
    while True:
        password = getpass.getpass("Enter new password (hidden): ")

        if len(password) < MINIMUM_PASSWORD_LENGTH:
            print(
                f"[ERROR] Password must be at least {MINIMUM_PASSWORD_LENGTH} "
                f"characters long.  Please try again.\n"
            )
            continue

        confirm = getpass.getpass("Confirm new password    (hidden): ")

        if password != confirm:
            print("[ERROR] Passwords do not match.  Please try again.\n")
            continue

        # Both entries match and meet the length requirement -- break out
        break

    # ------------------------------------------------------------------
    # Hash and store
    # ------------------------------------------------------------------
    config["password_hash"] = hash_password(password)
    # Record the setup timestamp for auditing purposes (no password stored)
    import datetime
    config["password_set_at"] = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    save_config(config)

    print()
    print(f"[OK] Password hash saved to: {CONFIG_FILE}")
    print("[OK] You can now use 'python hosts_blocker.py remove' with this password.")
    print()
    print("NOTE: Keep config.json in the same directory as hosts_blocker.py.")


if __name__ == "__main__":
    main()

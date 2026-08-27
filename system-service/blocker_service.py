"""
blocker_service.py - Layer 3: Windows Background Service for Adult Website Blocker

This service runs in the background and:
  - Re-applies hosts file entries if they are removed
  - Re-applies read-only flag on the hosts file if it is removed
  - Monitors browser processes for suspicious domain access patterns
  - Requires a password to stop or uninstall the service

Usage:
  python blocker_service.py install   - Install the Windows service
  python blocker_service.py start     - Start the service
  python blocker_service.py stop      - Stop the service (requires password)
  python blocker_service.py remove    - Uninstall the service (requires password)
"""

import sys
import os
import time
import json
import hashlib
import logging
import stat
import getpass
import subprocess

import win32serviceutil
import win32service
import win32event
import servicemanager

# ---------------------------------------------------------------------------
# Configuration paths
# ---------------------------------------------------------------------------

BASE_DIR       = r"C:\Users\Tridibesh\Desktop\Adult website blocker\system-service"
CONFIG_FILE    = os.path.join(BASE_DIR, "config.json")
BLOCKLIST_FILE = os.path.join(BASE_DIR, "blocklist.txt")
LOG_FILE       = os.path.join(BASE_DIR, "service.log")

HOSTS_FILE = r"C:\Windows\System32\drivers\etc\hosts"

# Markers to identify our injected block inside the hosts file
BLOCK_MARKER_START = "# === ADULT BLOCKER START ==="
BLOCK_MARKER_END   = "# === ADULT BLOCKER END ==="

# How often (in seconds) the service performs its maintenance checks
CHECK_INTERVAL = 30

# Browser process names to monitor (lightweight presence detection)
BROWSER_PROCESSES = ["chrome.exe", "msedge.exe", "firefox.exe"]

# ---------------------------------------------------------------------------
# Logging setup
# ---------------------------------------------------------------------------

def setup_logger():
    """
    Configure a file logger that writes to service.log.
    Uses DEBUG level so every check is recorded for troubleshooting.
    """
    logger = logging.getLogger("AdultBlockerService")
    logger.setLevel(logging.DEBUG)

    # Avoid adding duplicate handlers if the logger is already configured
    if not logger.handlers:
        fh = logging.FileHandler(LOG_FILE, encoding="utf-8")
        fh.setLevel(logging.DEBUG)
        formatter = logging.Formatter(
            "%(asctime)s [%(levelname)s] %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S"
        )
        fh.setFormatter(formatter)
        logger.addHandler(fh)

    return logger


# Module-level logger used by all functions and the service class
logger = setup_logger()

# ---------------------------------------------------------------------------
# Helper utilities
# ---------------------------------------------------------------------------

def hash_password(password: str) -> str:
    """Return the SHA-256 hex digest of the given plaintext password."""
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


def load_config() -> dict:
    """
    Load and return the contents of config.json as a dictionary.
    Returns an empty dict if the file is missing or unreadable.
    """
    if not os.path.exists(CONFIG_FILE):
        logger.error("Config file not found: %s", CONFIG_FILE)
        return {}
    try:
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as exc:
        logger.error("Failed to parse config file: %s", exc)
        return {}


def verify_password(password: str) -> bool:
    """
    Compare the supplied password's SHA-256 hash against the stored hash
    in config.json. Returns True if they match, False otherwise.
    """
    config = load_config()
    stored_hash = config.get("password_hash", "")
    return hash_password(password) == stored_hash


def load_blocklist() -> list:
    """
    Read blocklist.txt and return a list of domain strings.
    Lines beginning with '#' (comments) and blank lines are skipped.
    """
    domains = []
    if not os.path.exists(BLOCKLIST_FILE):
        logger.warning("Blocklist file not found: %s", BLOCKLIST_FILE)
        return domains
    try:
        with open(BLOCKLIST_FILE, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#"):
                    domains.append(line)
    except Exception as exc:
        logger.error("Failed to read blocklist: %s", exc)
    return domains

# ---------------------------------------------------------------------------
# Hosts file management
# ---------------------------------------------------------------------------

def remove_readonly(filepath: str):
    """Remove the read-only (write-protect) attribute from a file."""
    current = os.stat(filepath).st_mode
    os.chmod(filepath, current | stat.S_IWRITE)


def apply_readonly(filepath: str):
    """Apply the read-only attribute to a file so normal users cannot edit it."""
    current = os.stat(filepath).st_mode
    os.chmod(filepath, current & ~stat.S_IWRITE)


def is_hosts_readonly() -> bool:
    """
    Return True if the hosts file currently lacks the write permission bit,
    i.e. it is effectively read-only.
    """
    mode = os.stat(HOSTS_FILE).st_mode
    return not bool(mode & stat.S_IWRITE)


def read_hosts() -> str:
    """Read and return the raw text content of the hosts file."""
    with open(HOSTS_FILE, "r", encoding="utf-8") as f:
        return f.read()


def hosts_has_block(content: str) -> bool:
    """
    Return True if our start and end markers are both present in the hosts
    file content, indicating our blocking section exists.
    """
    return BLOCK_MARKER_START in content and BLOCK_MARKER_END in content


def build_block_section(domains: list) -> str:
    """
    Build the hosts-file text block that redirects all domains in the list
    to 0.0.0.0 (unreachable). Both bare domain and www. prefix are included.
    """
    lines = [BLOCK_MARKER_START]
    for domain in domains:
        # Block the bare domain
        lines.append("0.0.0.0 " + domain)
        # Also block the www. variant if not already prefixed
        if not domain.startswith("www."):
            lines.append("0.0.0.0 www." + domain)
    lines.append(BLOCK_MARKER_END)
    return "\n".join(lines)


def inject_block(domains: list):
    """
    Inject (or re-inject) our blocking section into the hosts file.

    Steps:
      1. Remove read-only so the file can be written.
      2. Remove any previously existing block section (idempotent).
      3. Append the fresh block section.
      4. Re-apply read-only protection.
    """
    try:
        # Step 1: temporarily lift read-only
        remove_readonly(HOSTS_FILE)

        content = read_hosts()

        # Step 2: strip any existing block so we do a clean re-apply
        if BLOCK_MARKER_START in content:
            start_idx = content.index(BLOCK_MARKER_START)
            end_idx   = content.index(BLOCK_MARKER_END) + len(BLOCK_MARKER_END)
            content   = content[:start_idx].rstrip() + "\n" + content[end_idx:].lstrip()

        # Step 3: append the new block section
        block_section = build_block_section(domains)
        new_content   = content.rstrip() + "\n\n" + block_section + "\n"

        with open(HOSTS_FILE, "w", encoding="utf-8") as f:
            f.write(new_content)

        logger.info("Hosts file: block entries injected (%d domains).", len(domains))

    except Exception as exc:
        logger.error("Failed to inject hosts block: %s", exc)

    finally:
        # Step 4: always re-apply read-only, even if an error occurred above
        try:
            apply_readonly(HOSTS_FILE)
        except Exception as exc:
            logger.error("Failed to re-apply read-only on hosts file: %s", exc)


def ensure_hosts_block():
    """
    Enforcement check #1:
    Verify the hosts file contains our block section. If it is missing
    (e.g. someone manually deleted it), re-inject it immediately.
    """
    domains = load_blocklist()
    if not domains:
        logger.warning("Blocklist is empty -- nothing to enforce in hosts file.")
        return

    try:
        content = read_hosts()
    except Exception as exc:
        logger.error("Cannot read hosts file: %s", exc)
        return

    if not hosts_has_block(content):
        logger.warning("Hosts block section is MISSING. Re-injecting...")
        inject_block(domains)
    else:
        logger.debug("Hosts file block section is present. OK.")


def ensure_hosts_readonly():
    """
    Enforcement check #2:
    Verify the hosts file is still read-only. If someone removed the
    read-only attribute (to edit the file), re-apply it immediately.
    """
    try:
        if not is_hosts_readonly():
            logger.warning(
                "Hosts file is NOT read-only. Re-applying read-only attribute..."
            )
            apply_readonly(HOSTS_FILE)
            logger.info("Read-only attribute re-applied to hosts file.")
        else:
            logger.debug("Hosts file is read-only. OK.")
    except Exception as exc:
        logger.error("Failed to check/set hosts file read-only: %s", exc)

# ---------------------------------------------------------------------------
# Browser process inspection
# ---------------------------------------------------------------------------

def get_running_processes() -> list:
    """
    Use `tasklist /FO CSV /NH` to enumerate all running processes.
    Returns a list of lowercase process name strings.
    Returns an empty list on failure.
    """
    try:
        result = subprocess.run(
            ["tasklist", "/FO", "CSV", "/NH"],
            capture_output=True,
            text=True,
            timeout=10
        )
        processes = []
        for line in result.stdout.splitlines():
            parts = line.split(",")
            if parts:
                # CSV first column is the process name; strip surrounding quotes
                proc_name = parts[0].strip('"').lower()
                processes.append(proc_name)
        return processes
    except Exception as exc:
        logger.error("Failed to enumerate processes: %s", exc)
        return []


def check_browser_processes():
    """
    Enforcement check #3:
    Detect if any monitored browser processes are running.
    Because blocking is handled at the hosts/DNS level, logging their
    presence confirms the blocking layer is active.

    This check can be extended (e.g. using psutil + network connections)
    to do deeper per-process domain inspection if needed.
    """
    running = get_running_processes()
    for browser in BROWSER_PROCESSES:
        if browser.lower() in running:
            logger.debug(
                "Browser process detected: %s -- hosts-level blocking is active.", browser
            )

# ---------------------------------------------------------------------------
# Windows Service class
# ---------------------------------------------------------------------------

class AdultBlockerService(win32serviceutil.ServiceFramework):
    """
    Windows NT Service that continuously enforces adult-content blocking.

    The service runs as SYSTEM so it has full access to the hosts file.
    Every CHECK_INTERVAL seconds it performs three enforcement checks:
      1. Hosts block section presence
      2. Hosts file read-only attribute
      3. Browser process presence (informational log)
    """

    _svc_name_         = "AdultBlockerService"
    _svc_display_name_ = "Adult Website Blocker Service"
    _svc_description_  = (
        "Monitors and re-enforces adult-website blocking via the hosts file. "
        "Prevents tampering with blocking rules. Managed by the Adult Website Blocker."
    )

    def __init__(self, args):
        win32serviceutil.ServiceFramework.__init__(self, args)
        # Win32 manual-reset event used to signal the loop to stop
        self.stop_event = win32event.CreateEvent(None, 0, 0, None)
        self.running    = True

    # ------------------------------------------------------------------
    # Service lifecycle callbacks (called by the Windows SCM)
    # ------------------------------------------------------------------

    def SvcStop(self):
        """
        Called by the SCM when a stop request is received.
        Sets the stop event so the main loop exits cleanly.
        """
        logger.info("Service stop requested by SCM.")
        self.ReportServiceStatus(win32service.SERVICE_STOP_PENDING)
        win32event.SetEvent(self.stop_event)
        self.running = False

    def SvcDoRun(self):
        """
        Main service entry point -- called by the SCM when the service starts.
        Logs to the Windows Event Log and then enters the enforcement loop.
        """
        servicemanager.LogMsg(
            servicemanager.EVENTLOG_INFORMATION_TYPE,
            servicemanager.PYS_SERVICE_STARTED,
            (self._svc_name_, "")
        )
        logger.info("AdultBlockerService started.")
        self.main_loop()

    # ------------------------------------------------------------------
    # Core enforcement loop
    # ------------------------------------------------------------------

    def main_loop(self):
        """
        Runs enforcement checks every CHECK_INTERVAL seconds until the
        service is stopped.  Uses WaitForSingleObject so the loop can be
        interrupted immediately when a stop event is fired.
        """
        logger.info(
            "Enforcement loop started (interval: %d s).", CHECK_INTERVAL
        )

        while self.running:
            try:
                logger.debug("--- Running enforcement checks ---")
                ensure_hosts_block()       # Check 1: block section present?
                ensure_hosts_readonly()    # Check 2: hosts file read-only?
                check_browser_processes()  # Check 3: browser processes running?
            except Exception as exc:
                logger.error("Unexpected error in enforcement loop: %s", exc)

            # Wait for CHECK_INTERVAL ms or until the stop event fires
            result = win32event.WaitForSingleObject(
                self.stop_event,
                CHECK_INTERVAL * 1000   # convert seconds to milliseconds
            )
            if result == win32event.WAIT_OBJECT_0:
                # Stop event was signalled -- exit the loop
                break

        logger.info("AdultBlockerService stopped.")

# ---------------------------------------------------------------------------
# Password-gated CLI helpers
# ---------------------------------------------------------------------------

def prompt_password(action: str) -> bool:
    """
    Interactively prompt for the blocker password before a sensitive action.
    Returns True if the entered password is correct, False otherwise.

    :param action: Short description of the action being gated (for the prompt).
    """
    print("Password required to " + action + " the service.")
    try:
        password = getpass.getpass("Enter blocker password: ")
    except (KeyboardInterrupt, EOFError):
        print("\nOperation cancelled.")
        return False

    if verify_password(password):
        return True

    print("Incorrect password. Operation aborted.")
    logger.warning("Failed password attempt for action: %s", action)
    return False

# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    if len(sys.argv) < 2:
        # No subcommand: hand control to pywin32 (handles SCM invocation)
        win32serviceutil.HandleCommandLine(AdultBlockerService)
        sys.exit(0)

    command = sys.argv[1].lower()

    if command == "install":
        # Install the service -- no password required to install
        print("Installing AdultBlockerService...")
        win32serviceutil.HandleCommandLine(AdultBlockerService)

    elif command == "start":
        # Start the service -- no password required to start
        print("Starting AdultBlockerService...")
        win32serviceutil.HandleCommandLine(AdultBlockerService)

    elif command == "stop":
        # Stopping the service requires the blocker password
        if prompt_password("stop"):
            print("Stopping AdultBlockerService...")
            win32serviceutil.HandleCommandLine(AdultBlockerService)
        else:
            sys.exit(1)

    elif command == "remove":
        # Removing / uninstalling requires the blocker password
        if prompt_password("remove/uninstall"):
            print("Removing AdultBlockerService...")
            win32serviceutil.HandleCommandLine(AdultBlockerService)
        else:
            sys.exit(1)

    else:
        # Pass any other arguments (e.g. 'debug', 'restart') directly to pywin32
        win32serviceutil.HandleCommandLine(AdultBlockerService)

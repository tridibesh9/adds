# =============================================================================
# hosts_blocker.py  --  Layer 2: System-Level Hosts File Blocker
# Adult Website Blocker Project
#
# CLI Usage:
#   python hosts_blocker.py apply    -- Add block entries to hosts file
#   python hosts_blocker.py remove   -- Remove block entries (password required)
#   python hosts_blocker.py status   -- Show current blocking status
#
# Requirements:
#   - Must be run as Windows Administrator (auto-elevates via ctypes + UAC)
#   - Reads domains from blocklist.txt in the same directory as this script
#   - Password hash stored in config.json (created by setup_password.py)
# =============================================================================

import sys
import os
import ctypes
import hashlib
import json
import subprocess
import datetime
import getpass

# ---------------------------------------------------------------------------
# PATHS -- all resolved relative to this script's own directory so the
# project works regardless of where it is installed on disk.
# ---------------------------------------------------------------------------
SCRIPT_DIR  = os.path.dirname(os.path.abspath(__file__))
BLOCKLIST   = os.path.join(SCRIPT_DIR, "blocklist.txt")
CONFIG_FILE = os.path.join(SCRIPT_DIR, "config.json")
HOSTS_PATH  = r"C:\Windows\System32\drivers\etc\hosts"

# Sentinel comment lines that delimit the blocker's section in the hosts file
MARKER_START = "# === ADULT BLOCKER START ==="
MARKER_END   = "# === ADULT BLOCKER END ==="


# ===========================================================================
# 1.  ADMINISTRATOR / UAC ELEVATION HELPERS
# ===========================================================================

def is_admin() -> bool:
    """Return True if the current process holds administrator privileges."""
    try:
        return ctypes.windll.shell32.IsUserAnAdmin() != 0
    except Exception:
        return False


def elevate_and_relaunch():
    """
    Re-launch this exact script with administrator rights by triggering the
    Windows UAC elevation dialog via ShellExecuteW / 'runas' verb.
    The original (non-admin) process exits right after the elevated copy
    is spawned, so the user sees only one terminal window.
    """
    script = os.path.abspath(sys.argv[0])
    # Preserve every CLI argument so the elevated copy behaves identically
    params = " ".join(f'"{arg}"' for arg in sys.argv[1:])
    ctypes.windll.shell32.ShellExecuteW(
        None,            # hwnd  -- no parent window
        "runas",         # verb  -- triggers UAC elevation
        sys.executable,  # the Python interpreter
        f'"{script}" {params}',
        None,            # working directory (inherit from parent)
        1                # nShowCmd: SW_SHOWNORMAL
    )
    sys.exit(0)  # non-admin process exits; elevated copy takes over


# ===========================================================================
# 2.  PASSWORD HELPERS
# ===========================================================================

def hash_password(plain: str) -> str:
    """Return the SHA-256 hex digest of the given plain-text password."""
    return hashlib.sha256(plain.encode("utf-8")).hexdigest()


def load_stored_hash():
    """
    Load the stored password hash from config.json.
    Returns the hash string, or None if the file / key is missing.
    """
    if not os.path.isfile(CONFIG_FILE):
        return None
    try:
        with open(CONFIG_FILE, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        return data.get("password_hash")
    except (json.JSONDecodeError, OSError):
        return None


def verify_password(prompt_text: str = "Enter password: ") -> bool:
    """
    Prompt the user for a password (without echoing it) and compare its
    SHA-256 hash to the value stored in config.json.
    Returns True on a match, False otherwise.
    """
    stored = load_stored_hash()
    if stored is None:
        print("[ERROR] No password configured. Run setup_password.py first.")
        return False
    entered = getpass.getpass(prompt_text)
    return hash_password(entered) == stored


# ===========================================================================
# 3.  BLOCKLIST READER
# ===========================================================================

def load_blocklist() -> list:
    """
    Parse blocklist.txt and return a sorted, deduplicated list of domain
    strings.  Lines that are blank or begin with '#' are ignored.
    """
    if not os.path.isfile(BLOCKLIST):
        print(f"[ERROR] Blocklist file not found: {BLOCKLIST}")
        sys.exit(1)

    raw_domains = []
    with open(BLOCKLIST, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line and not line.startswith("#"):
                raw_domains.append(line.lower())

    # Deduplicate while preserving first-seen order, then sort alphabetically
    seen, unique = set(), []
    for d in raw_domains:
        if d not in seen:
            seen.add(d)
            unique.append(d)
    return sorted(unique)


# ===========================================================================
# 4.  HOSTS FILE HELPERS
# ===========================================================================

def make_hosts_writable():
    """Remove the read-only attribute from the hosts file."""
    subprocess.run(["attrib", "-R", HOSTS_PATH], check=True, capture_output=True)


def make_hosts_readonly():
    """Set the read-only attribute on the hosts file to deter casual edits."""
    subprocess.run(["attrib", "+R", HOSTS_PATH], check=True, capture_output=True)


def read_hosts() -> str:
    """Return the full text of the hosts file."""
    with open(HOSTS_PATH, "r", encoding="utf-8", errors="replace") as fh:
        return fh.read()


def write_hosts(content: str):
    """Overwrite the hosts file with the given text (file must be writable)."""
    with open(HOSTS_PATH, "w", encoding="utf-8") as fh:
        fh.write(content)


def build_block_section(domains: list) -> str:
    """
    Construct the text block (delimited by sentinel markers) to be appended
    to the hosts file.  Each domain is redirected to 0.0.0.0 (a non-routable
    meta-address -- preferred over 127.0.0.1 to avoid unintended local hits).
    Both the bare domain and its www. prefix are blocked.
    """
    timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    lines = [
        "",            # blank line before the section for readability
        MARKER_START,
        f"# Generated by hosts_blocker.py on {timestamp}",
        f"# Blocking {len(domains)} unique domain(s)",
    ]
    for domain in domains:
        lines.append(f"0.0.0.0 {domain}")
        # Add the www. variant unless the domain already carries that prefix
        if not domain.startswith("www."):
            lines.append(f"0.0.0.0 www.{domain}")
    lines.append(MARKER_END)
    lines.append("")   # trailing blank line for cleanliness
    return "\n".join(lines)


def strip_blocker_section(content: str) -> str:
    """
    Remove the blocker section (including its sentinel markers) from the
    given hosts-file content string.  Safe to call even if the section
    appears more than once (e.g. after a previous partial write).
    """
    lines  = content.splitlines(keepends=True)
    result = []
    inside = False
    for line in lines:
        s = line.strip()
        if s == MARKER_START:
            inside = True
            continue   # drop the start marker
        if s == MARKER_END:
            inside = False
            continue   # drop the end marker
        if not inside:
            result.append(line)
    return "".join(result)


def blocker_is_applied(content: str) -> bool:
    """Return True when the blocker's start marker is present in content."""
    return MARKER_START in content


# ===========================================================================
# 5.  CLI COMMAND IMPLEMENTATIONS
# ===========================================================================

def cmd_apply():
    """
    Apply the blocklist: read domains, build the block section, and inject
    it into the hosts file.  If a previous section exists it is replaced.
    The hosts file is locked read-only afterwards.
    """
    domains = load_blocklist()
    print(f"[INFO] Loaded {len(domains)} domain(s) from blocklist.")

    hosts_content = read_hosts()
    if blocker_is_applied(hosts_content):
        print("[INFO] Existing block section detected -- refreshing.")
        hosts_content = strip_blocker_section(hosts_content)

    new_content = hosts_content.rstrip("\n") + "\n" + build_block_section(domains)

    make_hosts_writable()
    write_hosts(new_content)
    make_hosts_readonly()

    print(f"[OK] {len(domains)} domain(s) are now blocked.")
    print("[OK] Hosts file locked read-only to prevent tampering.")


def cmd_remove():
    """
    Remove the block section from the hosts file.
    A correct password must be supplied before any changes are made.
    """
    print("[AUTH] Password required to disable blocking.")
    if not verify_password("Enter admin password: "):
        print("[DENIED] Wrong password -- blocking remains active.")
        sys.exit(1)

    hosts_content = read_hosts()
    if not blocker_is_applied(hosts_content):
        print("[INFO] No block section found -- nothing to remove.")
        return

    cleaned = strip_blocker_section(hosts_content)
    make_hosts_writable()
    write_hosts(cleaned)
    # The file is intentionally left writable after removal.
    # Running 'apply' again will re-lock it.
    print("[OK] Block section removed from hosts file.")
    print("[INFO] Hosts file is now writable.")


def cmd_status():
    """Display whether blocking is active, file lock state, and entry counts."""
    hosts_content = read_hosts()
    applied = blocker_is_applied(hosts_content)

    # Inspect the read-only flag via the attrib command
    result = subprocess.run(["attrib", HOSTS_PATH], capture_output=True, text=True)
    # attrib output format: "A  R        C:\Windows\..."
    # Flags appear before the path in the output
    flag_part   = result.stdout.split(HOSTS_PATH)[0] if HOSTS_PATH in result.stdout else ""
    is_readonly = "R" in flag_part

    print("=" * 52)
    print("  Adult Website Blocker -- Layer 2 Status")
    print("=" * 52)
    print(f"  Blocking active  : {'YES' if applied else 'NO'}")
    print(f"  Hosts read-only  : {'YES' if is_readonly else 'NO'}")
    print(f"  Config present   : {'YES' if os.path.isfile(CONFIG_FILE) else 'NO (run setup_password.py)'}")
    print(f"  Blocklist present: {'YES' if os.path.isfile(BLOCKLIST) else 'NO'}")

    if applied:
        domains = load_blocklist()
        print(f"  Domains in list  : {len(domains)}")
        # Count active 0.0.0.0 lines inside the block section
        inside, count = False, 0
        for line in hosts_content.splitlines():
            if line.strip() == MARKER_START:
                inside = True
            elif line.strip() == MARKER_END:
                inside = False
            elif inside and line.startswith("0.0.0.0"):
                count += 1
        print(f"  Active entries   : {count}")

    print("=" * 52)


# ===========================================================================
# 6.  ENTRY POINT
# ===========================================================================

def main():
    # --- Elevation gate --------------------------------------------------
    # Modifying the hosts file requires Administrator privileges.
    # If we do not have them, re-launch via UAC and exit.
    if not is_admin():
        print("[INFO] Requesting Administrator privileges via UAC...")
        elevate_and_relaunch()
        sys.exit(1)  # unreachable under normal circumstances

    # --- Argument parsing ------------------------------------------------
    if len(sys.argv) < 2:
        print("Adult Website Blocker -- Layer 2 (Hosts File)")
        print()
        print("Usage:")
        print("  python hosts_blocker.py apply    -- block adult sites")
        print("  python hosts_blocker.py remove   -- remove blocking (password required)")
        print("  python hosts_blocker.py status   -- show current status")
        sys.exit(0)

    command = sys.argv[1].strip().lower()

    dispatch = {
        "apply":  cmd_apply,
        "remove": cmd_remove,
        "status": cmd_status,
    }

    if command in dispatch:
        dispatch[command]()
    else:
        print(f"[ERROR] Unknown command: '{command}'")
        print("Valid commands: apply | remove | status")
        sys.exit(1)


if __name__ == "__main__":
    main()

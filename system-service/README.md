# Adult Website Blocker — Layer 2 & Layer 3

> **Requires Windows and Python 3.8+. Must be run as Administrator.**

---

## Architecture Overview

| Layer | Component | What it does |
|-------|-----------|--------------|
| **Layer 1** | Browser Extension | Blocks adult sites at the browser level |
| **Layer 2** | Hosts file + Read-only lock | Redirects adult domains to `0.0.0.0` at the OS level; makes the hosts file read-only so it cannot be easily edited |
| **Layer 3** | Windows Background Service | Constantly watches the hosts file and re-enforces Layer 2 every 30 seconds; requires a password to stop or uninstall |

---

## Files in this Directory

| File | Purpose |
|------|---------|
| `blocker_service.py` | **Layer 3** – The Windows NT service (main file) |
| `setup_password.py` | Interactive script to set / change the blocker password |
| `hosts_blocker.py` | **Layer 2** – Applies hosts file entries and read-only flag |
| `blocklist.txt` | List of adult domains to block (one per line) |
| `config.json` | Stores the SHA-256 password hash |
| `service.log` | Service activity log (created on first run) |
| `requirements.txt` | Python dependencies (`pywin32`) |
| `install.bat` | Automated one-click installer |

---

## Quick Start — Automated Install

1. Open an **Administrator** command prompt.
2. Navigate to this folder:
   ```
   cd "C:\Users\Tridibesh\Desktop\Adult website blocker\system-service"
   ```
3. Run the installer:
   ```
   install.bat
   ```
   This will:
   - Check for admin rights
   - Install `pywin32` via pip
   - Run `setup_password.py` to create your secret password
   - Install and start the `AdultBlockerService` Windows service
   - Apply hosts file blocking rules

---

## Manual Setup (Step by Step)

### Prerequisites

```powershell
# Install Python dependency
pip install -r requirements.txt
```

### Step 1 — Set the Blocker Password

```powershell
python setup_password.py
```

This creates (or updates) `config.json` with your password stored as a SHA-256 hash.  
**Keep this password secret** — it is needed to stop or uninstall the service.

### Step 2 — Apply Hosts File Blocking (Layer 2)

```powershell
# Must be run as Administrator
python hosts_blocker.py
```

This injects block entries for all domains in `blocklist.txt` into:
```
C:\Windows\System32\drivers\etc\hosts
```
…and then makes the file **read-only** to prevent casual tampering.

### Step 3 — Install the Windows Service (Layer 3)

```powershell
# Must be run as Administrator
python blocker_service.py install
python blocker_service.py start
```

The service (`AdultBlockerService`) now runs in the background and:
- Every **30 seconds**, checks that the hosts block section is still present — re-injects if missing.
- Every **30 seconds**, checks that the hosts file is still read-only — re-applies if not.
- Logs all activity to `service.log`.

---

## Service Management Commands

| Command | Description | Password required? |
|---------|-------------|-------------------|
| `python blocker_service.py install` | Register the service with Windows SCM | No |
| `python blocker_service.py start` | Start the service | No |
| `python blocker_service.py stop` | Stop the service | **Yes** |
| `python blocker_service.py remove` | Uninstall the service | **Yes** |
| `python blocker_service.py debug` | Run service logic in foreground (for testing) | No |

### Stopping the Service

```powershell
python blocker_service.py stop
# Enter blocker password: ****
```

### Uninstalling the Service

```powershell
python blocker_service.py stop
python blocker_service.py remove
# Enter blocker password: **** (for each)
```

---

## Changing the Password

```powershell
python setup_password.py
```

> **Note:** You must know the current password (or have the old `config.json`) before you can change it, depending on your `setup_password.py` implementation.

---

## Modifying the Blocklist

1. **Stop the service** (requires password):
   ```powershell
   python blocker_service.py stop
   ```
2. Edit `blocklist.txt` — add or remove domains, one per line. Lines starting with `#` are comments.
3. Re-apply the hosts file:
   ```powershell
   python hosts_blocker.py
   ```
4. **Restart the service**:
   ```powershell
   python blocker_service.py start
   ```

---

## Log File

All service activity is written to **`service.log`** in this directory. Check this file if the blocker is not working as expected:

```
2025-01-01 12:00:00 [INFO]  AdultBlockerService started.
2025-01-01 12:00:00 [INFO]  Enforcement loop started (interval: 30 s).
2025-01-01 12:00:00 [DEBUG] --- Running enforcement checks ---
2025-01-01 12:00:00 [DEBUG] Hosts file block section is present. OK.
2025-01-01 12:00:00 [DEBUG] Hosts file is read-only. OK.
2025-01-01 12:00:30 [WARNING] Hosts block section is MISSING. Re-injecting...
2025-01-01 12:00:30 [INFO]  Hosts file: block entries injected (42 domains).
```

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `pip install` fails | Ensure Python is on PATH; run as Admin |
| Service won't install | Run command prompt as Administrator |
| Hosts file not updated | Confirm you're running as Admin; check `service.log` |
| Forgot password | Delete `config.json` and re-run `setup_password.py` (requires stopping the service first via Task Manager or `services.msc`) |
| Websites still accessible | Flush the DNS cache: `ipconfig /flushdns` |

---

## Security Notes

- The service runs as **SYSTEM**, which gives it full access to system files.
- The blocker password is stored as a **SHA-256 hash** — the plaintext is never saved.
- The hosts file is made **read-only** to deter quick manual edits, but a determined Administrator can still override this. The service re-enforces the block every 30 seconds.
- For stronger protection, consider also applying an **AppLocker** or **Software Restriction Policy** rule to prevent `python.exe` from being killed via Task Manager.

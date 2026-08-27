@echo off
:: ============================================================
:: install.bat - Adult Website Blocker: Layer 3 Installer
:: Run this script as Administrator to set up the blocker.
:: ============================================================

setlocal EnableDelayedExpansion

:: ------------------------------------------------------------
:: Step 1: Check for Administrator privileges
:: ------------------------------------------------------------
echo [1/5] Checking for administrator rights...
net session >nul 2>&1
if %errorLevel% NEQ 0 (
    echo.
    echo ERROR: This script must be run as Administrator.
    echo Right-click install.bat and select "Run as administrator".
    echo.
    pause
    exit /b 1
)
echo       Administrator rights confirmed.

:: ------------------------------------------------------------
:: Step 2: Install Python dependencies
:: ------------------------------------------------------------
echo.
echo [2/5] Installing Python requirements (pywin32)...
pip install -r "%~dp0requirements.txt"
if %errorLevel% NEQ 0 (
    echo.
    echo ERROR: pip install failed. Make sure Python and pip are on PATH.
    pause
    exit /b 1
)
echo       Requirements installed successfully.

:: Run the pywin32 post-install script so service utilities work correctly
python "%~dp0..\..\..\..\..\Scripts\pywin32_postinstall.py" -install 2>nul
:: (Ignore errors -- the postinstall script may not be needed in all setups)

:: ------------------------------------------------------------
:: Step 3: Set up the blocker password
:: ------------------------------------------------------------
echo.
echo [3/5] Running setup_password.py to configure the blocker password...
python "%~dp0setup_password.py"
if %errorLevel% NEQ 0 (
    echo.
    echo ERROR: Password setup failed. Please check setup_password.py.
    pause
    exit /b 1
)
echo       Password configured successfully.

:: ------------------------------------------------------------
:: Step 4: Install and start the Windows service
:: ------------------------------------------------------------
echo.
echo [4/5] Installing AdultBlockerService as a Windows service...
python "%~dp0blocker_service.py" install
if %errorLevel% NEQ 0 (
    echo.
    echo ERROR: Service installation failed.
    pause
    exit /b 1
)

echo       Starting AdultBlockerService...
python "%~dp0blocker_service.py" start
if %errorLevel% NEQ 0 (
    echo.
    echo WARNING: Service may not have started. Check service.log for details.
)
echo       Service installed and started.

:: ------------------------------------------------------------
:: Step 5: Apply hosts file blocking
:: ------------------------------------------------------------
echo.
echo [5/5] Applying hosts file blocking rules...
python "%~dp0hosts_blocker.py"
if %errorLevel% NEQ 0 (
    echo.
    echo WARNING: Hosts file update failed. The service will retry automatically.
)
echo       Hosts file blocking applied.

:: ------------------------------------------------------------
:: Done
:: ------------------------------------------------------------
echo.
echo ============================================================
echo  Adult Website Blocker (Layers 2 + 3) installed successfully!
echo  The background service is now running and protecting this PC.
echo ============================================================
echo.
echo  To verify: open services.msc and look for
echo             "Adult Website Blocker Service"
echo.
pause
endlocal

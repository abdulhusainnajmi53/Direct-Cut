@echo off
title Building DirectCut (Windows)

echo ==================================================
echo Installing dependencies and building for Windows
echo ==================================================

python -m pip install --upgrade pip
python -m pip install pywebview pyinstaller Pillow pythonnet

echo.
echo Running build_app.py...
python build_app.py

if exist "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" (
    echo.
    echo Building Windows Setup Installer...
    "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" installer_windows.iss
    echo Setup installer created in 'App Build\DirectCut-Setup.exe'
) else if exist "C:\Program Files\Inno Setup 6\ISCC.exe" (
    echo.
    echo Building Windows Setup Installer...
    "C:\Program Files\Inno Setup 6\ISCC.exe" installer_windows.iss
    echo Setup installer created in 'App Build\DirectCut-Setup.exe'
) else (
    echo.
    echo Inno Setup 6 not found in default path.
    echo Standalone application is available in 'App Build\DirectCut\'
)

echo.
echo ==================================================
echo Build finished! Check the 'App Build' folder.
echo ==================================================
pause

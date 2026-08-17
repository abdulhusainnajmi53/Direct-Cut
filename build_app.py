import os
import sys
import shutil
import subprocess
from pathlib import Path

# Ensure UTF-8 output encoding on all platforms (prevents Windows cp1252 charmap errors)
if sys.stdout and hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

def build():
    base_dir = Path(__file__).resolve().parent
    platform = sys.platform
    app_build_dir = base_dir / "App Build"

    print("==================================================")
    print(f"Building DirectCut for {platform}")
    print("==================================================")

    # 1. Prepare clean App Build directory
    if app_build_dir.exists():
        shutil.rmtree(app_build_dir)
    app_build_dir.mkdir(parents=True, exist_ok=True)

    sep = ";" if platform.startswith("win") else ":"

    # Data files to bundle: ui folder + bin directory
    add_data = [
        f"{base_dir / 'ui'}{sep}ui",
    ]

    mac_bin = base_dir / "bin" / "mac"
    win_bin = base_dir / "bin" / "win"

    # Ensure Windows binaries exist before packaging
    if platform.startswith("win"):
        win_bin.mkdir(parents=True, exist_ok=True)
        if not (win_bin / "ffmpeg.exe").exists():
            ff = shutil.which("ffmpeg.exe") or (Path(r"C:\ffmpeg\bin\ffmpeg.exe") if Path(r"C:\ffmpeg\bin\ffmpeg.exe").exists() else None)
            if ff:
                shutil.copy2(str(ff), str(win_bin / "ffmpeg.exe"))
                print(f"[FFmpeg] Copied ffmpeg.exe from {ff} to bin/win/")
        if not (win_bin / "ffprobe.exe").exists():
            fp = shutil.which("ffprobe.exe") or (Path(r"C:\ffmpeg\bin\ffprobe.exe") if Path(r"C:\ffmpeg\bin\ffprobe.exe").exists() else None)
            if fp:
                shutil.copy2(str(fp), str(win_bin / "ffprobe.exe"))
                print(f"[FFprobe] Copied ffprobe.exe from {fp} to bin/win/")

    if platform.startswith("darwin") and mac_bin.exists():
        add_data.append(f"{mac_bin}{sep}bin/mac")
    elif platform.startswith("win") and win_bin.exists():
        add_data.append(f"{win_bin}{sep}bin/win")

    cmd = [
        sys.executable, "-m", "PyInstaller",
        "--noconfirm",
        "--onedir",
        "--windowed",
        "--name=DirectCut",
        "--collect-all=webview",
        "--hidden-import=webview.platforms.winforms",
        "--hidden-import=clr_loader",
        "--hidden-import=pythonnet",
    ]

    # Check for custom app icon
    mac_icon = None
    for icon_name in ["icon.icns", "Icon.icns"]:
        if (base_dir / icon_name).exists():
            mac_icon = base_dir / icon_name
            break

    win_icon = base_dir / "icon.ico"

    if platform.startswith("darwin") and mac_icon:
        cmd.extend(["--icon", str(mac_icon)])
        print(f"[Icon] Using macOS App Icon: {mac_icon.name}")
    elif platform.startswith("win") and win_icon.exists():
        cmd.extend(["--icon", str(win_icon)])
        print(f"[Icon] Using Windows App Icon: {win_icon.name}")

    for data_item in add_data:
        cmd.extend(["--add-data", data_item])

    cmd.append(str(base_dir / "app.py"))

    print("\nRunning PyInstaller...")
    res = subprocess.run(cmd)

    if res.returncode != 0:
        print("\n[ERROR] PyInstaller build failed with return code:", res.returncode)
        sys.exit(res.returncode)

    dist_dir = base_dir / "dist"
    build_dir = base_dir / "build"
    spec_file = base_dir / "DirectCut.spec"

    if platform.startswith("darwin"):
        app_path = dist_dir / "DirectCut.app"
        final_app_path = app_build_dir / "DirectCut.app"
        dmg_path = app_build_dir / "DirectCut.dmg"

        if app_path.exists():
            # Copy .app bundle into App Build
            shutil.copytree(app_path, final_app_path, symlinks=True)

            print("\n[DMG] Creating clean macOS Drag-and-Drop DMG Installer...")
            # Staging folder containing ONLY DirectCut.app
            dmg_stage = base_dir / "_dmg_stage"
            if dmg_stage.exists():
                shutil.rmtree(dmg_stage)
            dmg_stage.mkdir(exist_ok=True)
            shutil.copytree(app_path, dmg_stage / "DirectCut.app", symlinks=True)

            create_dmg_bin = shutil.which("create-dmg")
            dmg_created = False

            if create_dmg_bin and not os.environ.get("GITHUB_ACTIONS"):
                dmg_cmd = [
                    create_dmg_bin,
                    "--volname", "DirectCut",
                    "--window-pos", "200", "120",
                    "--window-size", "600", "380",
                    "--icon-size", "120",
                    "--icon", "DirectCut.app", "160", "180",
                    "--app-drop-link", "440", "180",
                    "--hide-extension", "DirectCut.app",
                    "--format", "UDZO",
                    str(dmg_path),
                    str(dmg_stage)
                ]
                if mac_icon:
                    dmg_cmd.extend(["--volicon", str(mac_icon)])

                proc = subprocess.run(dmg_cmd)
                if proc.returncode == 0 and dmg_path.exists():
                    dmg_created = True

            if not dmg_created:
                # Fallback to native hdiutil (100% reliable in both local & GitHub CI)
                print("[DMG] Using native hdiutil to create disk image...")
                app_link = dmg_stage / "Applications"
                if not app_link.exists():
                    os.symlink("/Applications", str(app_link))

                subprocess.run([
                    "hdiutil", "create",
                    "-volname", "DirectCut",
                    "-srcfolder", str(dmg_stage),
                    "-ov",
                    "-format", "UDZO",
                    str(dmg_path)
                ])

            # Remove staging directory
            if dmg_stage.exists():
                shutil.rmtree(dmg_stage)

    elif platform.startswith("win"):
        win_dist_app = dist_dir / "DirectCut"
        if win_dist_app.exists():
            shutil.copytree(win_dist_app, app_build_dir / "DirectCut")
            # Ensure standalone binary folder is also accessible at root
            if win_bin.exists():
                out_bin = app_build_dir / "DirectCut" / "bin" / "win"
                out_bin.mkdir(parents=True, exist_ok=True)
                for f in win_bin.glob("*.exe"):
                    shutil.copy2(f, out_bin / f.name)

    # Clean up temporary build, dist, and spec artifacts
    print("\n[Cleanup] Cleaning up temporary build artifacts...")
    if dist_dir.exists():
        shutil.rmtree(dist_dir)
    if build_dir.exists():
        shutil.rmtree(build_dir)
    if spec_file.exists():
        spec_file.unlink()

    # Also remove legacy spec if present
    legacy_spec = base_dir / "VideoTrimmerStudio.spec"
    if legacy_spec.exists():
        legacy_spec.unlink()

    print("\n==================================================")
    print("[SUCCESS] PACKAGING COMPLETE!")
    print(f"Output Directory: {app_build_dir}")
    if (app_build_dir / "DirectCut.dmg").exists():
        print(f"   DMG Installer: {app_build_dir / 'DirectCut.dmg'}")
    if (app_build_dir / "DirectCut.app").exists():
        print(f"   macOS App:     {app_build_dir / 'DirectCut.app'}")
    if (app_build_dir / "DirectCut").exists():
        print(f"   Windows App:   {app_build_dir / 'DirectCut'}")
    print("==================================================")

if __name__ == "__main__":
    build()

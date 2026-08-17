import os
import sys
import json
import shutil
import subprocess
import threading
import mimetypes
import urllib.parse
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
import webview
from ffmpeg_engine import FFmpegEngine

class VideoStreamHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # Suppress request spam in console

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == '/stream':
            params = urllib.parse.parse_qs(parsed.query)
            file_param = params.get('file', [None])[0]
            if not file_param or not os.path.exists(file_param):
                self.send_error(404, "File not found")
                return

            file_size = os.path.getsize(file_param)
            range_header = self.headers.get('Range', None)
            mime_type, _ = mimetypes.guess_type(file_param)
            if not mime_type:
                mime_type = "video/mp4"

            if range_header:
                # Parse Range: bytes=START-END
                byte_range = range_header.strip().split("=")[-1]
                parts = byte_range.split("-")
                start = int(parts[0]) if parts[0] else 0
                end = int(parts[1]) if len(parts) > 1 and parts[1] else file_size - 1
                end = min(end, file_size - 1)
                chunk_len = (end - start) + 1

                self.send_response(206)
                self.send_header("Content-Type", mime_type)
                self.send_header("Content-Range", f"bytes {start}-{end}/{file_size}")
                self.send_header("Content-Length", str(chunk_len))
                self.send_header("Accept-Ranges", "bytes")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()

                with open(file_param, "rb") as f:
                    f.seek(start)
                    # Stream in 64KB blocks
                    bytes_left = chunk_len
                    try:
                        while bytes_left > 0:
                            read_size = min(65536, bytes_left)
                            chunk = f.read(read_size)
                            if not chunk:
                                break
                            self.wfile.write(chunk)
                            bytes_left -= len(chunk)
                    except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
                        pass
            else:
                self.send_response(200)
                self.send_header("Content-Type", mime_type)
                self.send_header("Content-Length", str(file_size))
                self.send_header("Accept-Ranges", "bytes")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()

                try:
                    with open(file_param, "rb") as f:
                        shutil.copyfileobj(f, self.wfile)
                except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
                    pass
        else:
            self.send_error(404, "Not Found")


class VideoTrimmerAPI:
    """
    Exposed JS-API class.
    NOTE: Internal properties MUST be prefixed with an underscore '_' so that
    pywebview on Windows does not recursively inspect .NET WinForms / COM handles.
    """
    def __init__(self, stream_port):
        self._engine = FFmpegEngine()
        self._window = None
        self._stream_port = stream_port
        self._current_loaded_file = None

    def set_window(self, window):
        self._window = window

    def select_file(self):
        """Opens native OS file open dialog for video files."""
        # 1. Try pywebview create_file_dialog
        try:
            if self._window:
                dialog_type = getattr(webview, 'OPEN_DIALOG', 10)
                if hasattr(webview, 'FileDialog') and hasattr(webview.FileDialog, 'OPEN'):
                    dialog_type = webview.FileDialog.OPEN
                
                file_types = ('Video Files (*.mp4;*.mov;*.mkv;*.avi;*.webm;*.m4v;*.ts)', 'All Files (*.*)')
                res = self._window.create_file_dialog(
                    dialog_type=dialog_type,
                    allow_multiple=False,
                    file_types=file_types
                )
                if res and len(res) > 0:
                    self._current_loaded_file = res[0]
                    return res[0]
        except Exception as e:
            print("pywebview dialog exception:", e)

        # 2. Native macOS AppleScript fallback
        if sys.platform == 'darwin':
            try:
                cmd = """osascript -e 'POSIX path of (choose file with prompt "Select Video File" of type {"mp4", "mov", "mkv", "avi", "webm", "m4v", "ts", "public.movie"})'"""
                p = subprocess.run(cmd, shell=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                path = p.stdout.strip()
                if path and os.path.exists(path):
                    self._current_loaded_file = path
                    return path
            except Exception as e:
                print("AppleScript dialog error:", e)

        # 3. Native Windows fallback via tkinter
        if sys.platform.startswith('win'):
            try:
                import tkinter as tk
                from tkinter import filedialog
                root = tk.Tk()
                root.withdraw()
                root.attributes('-topmost', True)
                file_path = filedialog.askopenfilename(
                    title="Select Video File",
                    filetypes=[
                        ("Video Files", "*.mp4 *.mov *.mkv *.avi *.webm *.m4v *.ts"),
                        ("All Files", "*.*")
                    ]
                )
                root.destroy()
                if file_path and os.path.exists(file_path):
                    self._current_loaded_file = os.path.normpath(file_path)
                    return self._current_loaded_file
            except Exception as e:
                print("Tkinter dialog fallback error:", e)

        return ""

    def load_video_data(self, file_path):
        """Returns metadata, keyframe timestamps, and filmstrip thumbnails for chosen video file."""
        if not file_path or not os.path.exists(file_path):
            if self._current_loaded_file and os.path.exists(self._current_loaded_file):
                file_path = self._current_loaded_file
            else:
                return {"error": "File path does not exist."}

        self._current_loaded_file = os.path.abspath(file_path)
        metadata = self._engine.get_metadata(file_path)
        keyframes = self._engine.get_keyframes(file_path)
        duration = metadata.get("duration", 0)
        thumbnails = self._engine.generate_thumbnails(file_path, duration, num_thumbs=16)

        # Local streaming URL with byte-range support
        encoded_path = urllib.parse.quote(file_path)
        stream_url = f"http://127.0.0.1:{self._stream_port}/stream?file={encoded_path}"

        return {
            "metadata": metadata,
            "keyframes": keyframes,
            "thumbnails": thumbnails,
            "file_url": stream_url
        }

    def start_export(self, file_path, segments, merge=True, output_dir=None):
        """Launches lossless export process in background thread."""
        # Ensure absolute valid file path
        if not file_path or not os.path.exists(file_path):
            if self._current_loaded_file and os.path.exists(self._current_loaded_file):
                file_path = self._current_loaded_file

        def run_worker():
            def status_cb(data):
                if self._window:
                    js_data = json.dumps(data)
                    self._window.evaluate_js(f"window.onExportProgress({js_data});")

            result = self._engine.export_lossless(
                file_path=file_path,
                segments=segments,
                merge=merge,
                output_dir=output_dir,
                status_callback=status_cb
            )

            if self._window:
                js_result = json.dumps(result)
                self._window.evaluate_js(f"window.onExportFinished({js_result});")

        threading.Thread(target=run_worker, daemon=True).start()
        return {"status": "started"}


def get_ui_path():
    """Returns absolute path to ui/index.html handling dev mode & PyInstaller bundle."""
    if getattr(sys, 'frozen', False) and hasattr(sys, '_MEIPASS'):
        return str(Path(sys._MEIPASS) / "ui" / "index.html")
    return str(Path(__file__).resolve().parent / "ui" / "index.html")


def main():
    # Start local HTTP streaming server on ephemeral port
    stream_server = ThreadingHTTPServer(('127.0.0.1', 0), VideoStreamHandler)
    stream_port = stream_server.server_address[1]
    threading.Thread(target=stream_server.serve_forever, daemon=True).start()

    api = VideoTrimmerAPI(stream_port)
    ui_html = get_ui_path()

    window = webview.create_window(
        title="DirectCut - Fast Lossless Video Trimmer",
        url=ui_html,
        js_api=api,
        width=1360,
        height=900,
        min_size=(1100, 750),
        background_color="#F8FAFC"
    )
    api.set_window(window)
    webview.start(debug=False)


if __name__ == "__main__":
    main()

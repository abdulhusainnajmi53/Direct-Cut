import os
import sys
import json
import shutil
import subprocess
import threading
from pathlib import Path

class FFmpegEngine:
    def __init__(self):
        self._subp_kwargs = {}
        if sys.platform.startswith("win"):
            # Hide popup console window on Windows when executing ffmpeg/ffprobe
            self._subp_kwargs["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000)

        self.ffmpeg_exe = self.find_binary("ffmpeg")
        self.ffprobe_exe = self.find_binary("ffprobe")

    def find_binary(self, name):
        """Locates FFmpeg / FFprobe binaries for macOS and Windows, considering PyInstaller bundle."""
        ext = ".exe" if sys.platform.startswith("win") else ""
        binary_name = f"{name}{ext}"
        platform_dir = "win" if sys.platform.startswith("win") else "mac"

        # 1. PyInstaller MEIPASS bundle path (onefile / onedir _MEIPASS)
        if getattr(sys, 'frozen', False) and hasattr(sys, '_MEIPASS'):
            candidates = [
                Path(sys._MEIPASS) / binary_name,
                Path(sys._MEIPASS) / "bin" / platform_dir / binary_name,
                Path(sys._MEIPASS) / "bin" / binary_name,
            ]
            for c in candidates:
                if c.exists():
                    return str(c)

        # 2. PyInstaller executable directory (onedir mode)
        if getattr(sys, 'frozen', False):
            exe_dir = Path(sys.executable).resolve().parent
            candidates = [
                exe_dir / binary_name,
                exe_dir / "bin" / platform_dir / binary_name,
                exe_dir / "_internal" / binary_name,
                exe_dir / "_internal" / "bin" / platform_dir / binary_name,
            ]
            for c in candidates:
                if c.exists():
                    return str(c)

        # 3. Local bin directory relative to current source project
        base_dir = Path(__file__).resolve().parent
        candidates = [
            base_dir / "bin" / platform_dir / binary_name,
            base_dir / binary_name,
            base_dir / "bin" / binary_name,
        ]
        for c in candidates:
            if c.exists():
                return str(c)

        # 4. System PATH fallback
        path_binary = shutil.which(binary_name) or shutil.which(name)
        if path_binary:
            return path_binary

        # 5. Standard Windows installation paths fallback
        if sys.platform.startswith("win"):
            win_fallbacks = [
                Path(r"C:\ffmpeg\bin") / binary_name,
                Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "ffmpeg" / "bin" / binary_name,
                Path(os.environ.get("LOCALAPPDATA", "")) / "Microsoft" / "WinGet" / "Packages" / binary_name,
            ]
            for fb in win_fallbacks:
                if fb.exists():
                    return str(fb)

        return binary_name

    def parse_fps(self, fps_str):
        """Converts FFprobe fps fraction string (e.g., '60000/1001') to float."""
        try:
            if not fps_str or fps_str == 'N/A':
                return 30.0
            if '/' in fps_str:
                num, den = fps_str.split('/')
                num_f, den_f = float(num), float(den)
                return num_f / den_f if den_f != 0 else 30.0
            return float(fps_str)
        except Exception:
            return 30.0

    def get_metadata(self, file_path):
        """Extracts comprehensive stream metadata from video file using ffprobe."""
        if not os.path.exists(file_path):
            return {"error": "File does not exist"}

        cmd = [
            self.ffprobe_exe,
            "-v", "error",
            "-show_format",
            "-show_streams",
            "-of", "json",
            str(file_path)
        ]

        try:
            res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=True, **self._subp_kwargs)
            data = json.loads(res.stdout)

            format_info = data.get("format", {})
            streams = data.get("streams", [])

            video_stream = next((s for s in streams if s.get("codec_type") == "video"), None)
            audio_stream = next((s for s in streams if s.get("codec_type") == "audio"), None)

            duration = float(format_info.get("duration", 0))
            if duration <= 0 and video_stream:
                duration = float(video_stream.get("duration", 0))

            bitrate_bps = int(format_info.get("bit_rate", 0))
            bitrate_mbps = round(bitrate_bps / 1_000_000, 2) if bitrate_bps > 0 else "N/A"

            fps = 30.0
            width, height = 0, 0
            codec_v, color_space, color_format, pix_fmt = "Unknown", "Unknown", "Unknown", "Unknown"
            
            if video_stream:
                width = int(video_stream.get("width", 0))
                height = int(video_stream.get("height", 0))
                fps_raw = video_stream.get("r_frame_rate") or video_stream.get("avg_frame_rate") or "30/1"
                fps = self.parse_fps(fps_raw)
                codec_v = video_stream.get("codec_name", "Unknown").upper()
                pix_fmt = video_stream.get("pix_fmt", "yuv420p")
                
                color_primaries = video_stream.get("color_space") or video_stream.get("color_primaries") or "bt709"
                color_space = color_primaries
                color_format = f"{pix_fmt} ({color_primaries})"

            codec_a, sample_rate, channels = "None", "N/A", "N/A"
            if audio_stream:
                codec_a = audio_stream.get("codec_name", "Unknown").upper()
                sample_rate = f"{int(audio_stream.get('sample_rate', 0))/1000:.1f} kHz" if audio_stream.get('sample_rate') else "N/A"
                ch_count = audio_stream.get("channels", 2)
                channels = "Stereo" if ch_count == 2 else ("5.1 Surround" if ch_count == 6 else f"{ch_count} ch")

            total_frames = int(duration * fps) if duration > 0 and fps > 0 else 0

            return {
                "file_path": str(file_path),
                "filename": Path(file_path).name,
                "duration": round(duration, 3),
                "fps": round(fps, 3),
                "total_frames": total_frames,
                "width": width,
                "height": height,
                "resolution": f"{width}x{height}",
                "bitrate": f"{bitrate_mbps} Mbps" if bitrate_mbps != "N/A" else "N/A",
                "video_codec": codec_v,
                "audio_codec": codec_a,
                "audio_sample_rate": sample_rate,
                "audio_channels": channels,
                "color_format": color_format,
                "container": Path(file_path).suffix.replace('.', '').upper()
            }

        except Exception as e:
            return {"error": f"Failed to probe file: {str(e)}"}

    def get_keyframes(self, file_path):
        """Queries video I-frames / keyframes timestamp list for rapid frame jumping."""
        cmd = [
            self.ffprobe_exe,
            "-v", "error",
            "-select_streams", "v:0",
            "-show_packets",
            "-show_entries", "packet=pts_time,flags",
            "-of", "csv=p=0",
            str(file_path)
        ]

        keyframes = []
        try:
            res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=True, **self._subp_kwargs)
            for line in res.stdout.strip().split("\n"):
                parts = line.strip().split(",")
                if len(parts) >= 2 and 'K' in parts[1]: # K flag indicates Keyframe / I-frame
                    try:
                        pts = float(parts[0])
                        keyframes.append(round(pts, 3))
                    except ValueError:
                        continue
            keyframes.sort()
            return keyframes
        except Exception:
            return []

    def generate_thumbnails(self, file_path, duration, num_thumbs=10):
        """Generates quick low-res thumbnail image data URLs for timeline filmstrip visualizer."""
        if duration <= 0:
            return []
        
        import base64
        thumbnails = []
        step = duration / max(1, num_thumbs)

        for i in range(num_thumbs):
            ts = round(i * step, 2)
            cmd = [
                self.ffmpeg_exe, "-y",
                "-noaccurate_seek",
                "-ss", str(ts),
                "-i", str(file_path),
                "-vframes", "1",
                "-vf", "scale=160:90:force_original_aspect_ratio=decrease",
                "-f", "image2",
                "-c:v", "mjpeg",
                "-q:v", "5",
                "pipe:1"
            ]
            try:
                proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True, **self._subp_kwargs)
                img_b64 = base64.b64encode(proc.stdout).decode('utf-8')
                thumbnails.append({
                    "time": ts,
                    "data": f"data:image/jpeg;base64,{img_b64}"
                })
            except Exception:
                continue

        return thumbnails

    def export_lossless(self, file_path, segments, merge=True, output_dir=None, status_callback=None):
        """
        Extracts clips using fast FFmpeg stream copying (-c copy).
        Merges using FFmpeg concat demuxer (-f concat -safe 0 -i list.txt -c copy).
        """
        p = Path(file_path)
        if not p.exists():
            return {"success": False, "message": "Source video file not found."}

        out_path = Path(output_dir) if output_dir else p.parent
        out_path.mkdir(parents=True, exist_ok=True)

        temp_dir = out_path / f"_temp_trim_{os.getpid()}"
        if temp_dir.exists():
            shutil.rmtree(temp_dir)
        temp_dir.mkdir(exist_ok=True)

        try:
            temp_files = []
            total_segs = len(segments)

            for i, seg in enumerate(segments):
                s_time = float(seg['start'])
                e_time = float(seg['end'])

                if status_callback:
                    status_callback({
                        "progress": int((i / total_segs) * 70),
                        "status": f"Extracting Clip {i+1} of {total_segs} ({s_time:.2f}s - {e_time:.2f}s)..."
                    })

                ext = p.suffix
                temp_clip = temp_dir / f"seg_{i:03d}{ext}"
                
                # Fast input seeking stream copy with max performance flags
                cmd = [
                    self.ffmpeg_exe, "-y",
                    "-threads", "0",
                    "-probesize", "100M",
                    "-analyzeduration", "100M",
                    "-ss", f"{s_time:.4f}",
                    "-to", f"{e_time:.4f}",
                    "-i", str(p),
                    "-c", "copy",
                    "-max_muxing_queue_size", "4096",
                    "-avoid_negative_ts", "make_zero",
                    str(temp_clip)
                ]

                proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, **self._subp_kwargs)
                if proc.returncode != 0:
                    raise Exception(f"FFmpeg slice error: {proc.stderr}")

                temp_files.append(temp_clip)

            if merge and len(temp_files) > 1:
                if status_callback:
                    status_callback({"progress": 80, "status": "Merging segments losslessly (concat demuxer)..."})

                concat_list = temp_dir / "concat_list.txt"
                with open(concat_list, "w", encoding="utf-8") as f_list:
                    for tf in temp_files:
                        # Escape single quotes and write POSIX path for FFmpeg concat demuxer
                        escaped_path = tf.resolve().as_posix().replace("'", "'\\''")
                        f_list.write(f"file '{escaped_path}'\n")

                final_output = out_path / f"{p.stem}_Trimmed{p.suffix}"
                
                # Concat demuxer command with max thread & queue buffer allocation
                cmd_concat = [
                    self.ffmpeg_exe, "-y",
                    "-threads", "0",
                    "-f", "concat",
                    "-safe", "0",
                    "-i", str(concat_list),
                    "-c", "copy",
                    "-max_muxing_queue_size", "4096",
                    str(final_output)
                ]

                proc = subprocess.run(cmd_concat, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, **self._subp_kwargs)
                if proc.returncode != 0:
                    raise Exception(f"FFmpeg concat error: {proc.stderr}")

                if status_callback:
                    status_callback({"progress": 100, "status": f"Export Complete: {final_output.name}"})

                return {"success": True, "output": str(final_output), "message": f"Saved merged video to: {final_output.name}"}

            elif merge and len(temp_files) == 1:
                final_output = out_path / f"{p.stem}_Trimmed{p.suffix}"
                shutil.move(str(temp_files[0]), str(final_output))

                if status_callback:
                    status_callback({"progress": 100, "status": f"Export Complete: {final_output.name}"})

                return {"success": True, "output": str(final_output), "message": f"Saved video to: {final_output.name}"}

            else:
                # Save as separate clips
                saved_clips = []
                for i, tf in enumerate(temp_files):
                    clip_name = f"{p.stem}_Clip_{i+1:02d}{p.suffix}"
                    final_clip = out_path / clip_name
                    shutil.move(str(tf), str(final_clip))
                    saved_clips.append(str(final_clip))

                if status_callback:
                    status_callback({"progress": 100, "status": f"Saved {len(saved_clips)} individual clips."})

                return {"success": True, "output": saved_clips, "message": f"Saved {len(saved_clips)} separate clips."}

        except Exception as e:
            return {"success": False, "message": str(e)}
        finally:
            if temp_dir.exists():
                shutil.rmtree(temp_dir, ignore_errors=True)

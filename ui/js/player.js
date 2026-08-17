class VideoPlayerController {
  constructor(videoElementId, options = {}) {
    this.video = document.getElementById(videoElementId);
    this.fps = 30.0;
    this.duration = 0;
    this.keyframes = [];

    this.markIn = null;
    this.markOut = null;
    this.segments = [];

    this.onTimeUpdateCb = options.onTimeUpdate || (() => {});
    this.onLoadedCb = options.onLoaded || (() => {});
    this.onSegmentsChangedCb = options.onSegmentsChanged || (() => {});

    this.initListeners();
  }

  setFps(fps) {
    this.fps = fps && fps > 0 ? fps : 30.0;
  }

  setKeyframes(keyframes) {
    this.keyframes = keyframes || [];
  }

  loadSource(srcUrl, fallbackDuration = 0) {
    this.video.src = srcUrl;
    if (fallbackDuration > 0) {
      this.duration = fallbackDuration;
      this.onLoadedCb(this.duration);
    }
    this.video.load();
    this.markIn = null;
    this.markOut = null;
    this.segments = [];
  }

  reset() {
    this.video.pause();
    this.video.removeAttribute('src');
    this.video.load();
    this.duration = 0;
    this.markIn = null;
    this.markOut = null;
    this.segments = [];
    this.keyframes = [];
    this.notifyMarkers();
  }

  initListeners() {
    this.video.addEventListener('loadedmetadata', () => {
      if (this.video.duration && !isNaN(this.video.duration) && this.video.duration > 0) {
        this.duration = this.video.duration;
      }
      this.onLoadedCb(this.duration);
    });

    this.video.addEventListener('timeupdate', () => {
      this.onTimeUpdateCb(this.video.currentTime);
    });

    this.video.addEventListener('error', (e) => {
      console.warn("Video playback error:", e, this.video.error);
    });

    // Global Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
      // Don't trigger if user is typing in an input field
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
        return;
      }

      const code = e.code;
      const shift = e.shiftKey;

      if (code === 'Space') {
        e.preventDefault();
        this.togglePlay();
      } else if (code === 'ArrowLeft') {
        e.preventDefault();
        if (shift) {
          this.stepTime(-1.0); // -1 Second
        } else {
          this.stepFrame(-1); // -1 Frame
        }
      } else if (code === 'ArrowRight') {
        e.preventDefault();
        if (shift) {
          this.stepTime(1.0); // +1 Second
        } else {
          this.stepFrame(1); // +1 Frame
        }
      } else if (code === 'ArrowUp') {
        e.preventDefault();
        this.jumpKeyframe(-1); // Prev Keyframe
      } else if (code === 'ArrowDown') {
        e.preventDefault();
        this.jumpKeyframe(1); // Next Keyframe
      } else if (code === 'KeyI') {
        e.preventDefault();
        this.setMarkIn();
      } else if (code === 'KeyO') {
        e.preventDefault();
        this.setMarkOut();
      } else if (code === 'Enter') {
        e.preventDefault();
        this.addSegmentFromMarkers();
      }
    });
  }

  togglePlay() {
    if (this.video.paused) {
      this.video.play();
    } else {
      this.video.pause();
    }
  }

  seekTo(seconds) {
    if (!this.video) return;
    const target = Math.max(0, Math.min(this.duration, seconds));
    this.video.currentTime = target;
    this.onTimeUpdateCb(target);
  }

  stepFrame(frameCount) {
    this.video.pause();
    const frameTime = 1 / this.fps;
    this.seekTo(this.video.currentTime + (frameCount * frameTime));
  }

  stepTime(seconds) {
    this.video.pause();
    this.seekTo(this.video.currentTime + seconds);
  }

  jumpKeyframe(direction) {
    this.video.pause();
    if (!this.keyframes || this.keyframes.length === 0) {
      // Fallback: jump 2 seconds
      this.stepTime(direction * 2.0);
      return;
    }

    const cur = this.video.currentTime;
    if (direction < 0) {
      // Find latest keyframe strictly before cur
      const prevKf = [...this.keyframes].reverse().find(kf => kf < cur - 0.05);
      if (prevKf !== undefined) {
        this.seekTo(prevKf);
      } else {
        this.seekTo(0);
      }
    } else {
      // Find earliest keyframe strictly after cur
      const nextKf = this.keyframes.find(kf => kf > cur + 0.05);
      if (nextKf !== undefined) {
        this.seekTo(nextKf);
      } else {
        this.seekTo(this.duration);
      }
    }
  }

  setMarkIn() {
    this.markIn = this.video.currentTime;
    if (this.markOut !== null && this.markOut < this.markIn) {
      this.markOut = null;
    }
    this.notifyMarkers();
  }

  setMarkOut() {
    this.markOut = this.video.currentTime;
    if (this.markIn !== null && this.markIn > this.markOut) {
      this.markIn = null;
    }
    this.notifyMarkers();
  }

  notifyMarkers() {
    this.onSegmentsChangedCb({
      markIn: this.markIn,
      markOut: this.markOut,
      segments: this.segments
    });
  }

  addSegmentFromMarkers() {
    if (this.markIn === null || this.markOut === null) {
      return false;
    }
    const start = Math.min(this.markIn, this.markOut);
    const end = Math.max(this.markIn, this.markOut);

    if (end - start < 0.05) return false;

    this.segments.push({
      id: Date.now() + Math.random(),
      start: round(start, 3),
      end: round(end, 3),
      duration: round(end - start, 3)
    });

    // Sort segments by start time
    this.segments.sort((a, b) => a.start - b.start);

    // Reset markers for next segment
    this.markIn = null;
    this.markOut = null;

    this.notifyMarkers();
    return true;
  }

  removeSegment(id) {
    this.segments = this.segments.filter(s => s.id !== id);
    this.notifyMarkers();
  }

  clearSegments() {
    this.segments = [];
    this.markIn = null;
    this.markOut = null;
    this.notifyMarkers();
  }

  formatTimecode(seconds) {
    if (isNaN(seconds) || seconds < 0) seconds = 0;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const f = Math.floor((seconds % 1) * this.fps);

    const pad = (num, len = 2) => String(num).padStart(len, '0');
    return `${pad(h)}:${pad(m)}:${pad(s)}:${pad(f)}`;
  }
}

function round(val, decimals = 3) {
  return Number(Math.round(val + 'e' + decimals) + 'e-' + decimals);
}

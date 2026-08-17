class ProTimelineCanvas {
  constructor(canvasId, options = {}) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');

    this.duration = 0;
    this.currentTime = 0;
    this.markIn = null;
    this.markOut = null;
    this.segments = [];
    this.keyframes = [];
    this.thumbnails = [];

    this.onSeekCb = options.onSeek || (() => {});

    this.isDragging = false;
    this.initEvents();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    if (!this.canvas) return;
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = rect.width * window.devicePixelRatio;
    this.canvas.height = rect.height * window.devicePixelRatio;
    this.ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    this.render();
  }

  setData(duration, keyframes = [], thumbnailsData = null) {
    if (duration > 0) this.duration = duration;
    if (keyframes && keyframes.length > 0) this.keyframes = keyframes;
    
    // Only update thumbnails if explicitly passed and non-empty
    if (thumbnailsData && thumbnailsData.length > 0) {
      this.loadThumbnails(thumbnailsData);
    }
    this.render();
  }

  reset() {
    this.duration = 0;
    this.currentTime = 0;
    this.markIn = null;
    this.markOut = null;
    this.segments = [];
    this.keyframes = [];
    this.thumbnails = [];
    this.render();
  }

  loadThumbnails(thumbnailsData) {
    if (!thumbnailsData || thumbnailsData.length === 0) return;
    this.thumbnails = [];

    thumbnailsData.forEach(item => {
      const img = new Image();
      img.src = item.data;
      img.onload = () => this.render();
      this.thumbnails.push({
        time: item.time,
        img: img
      });
    });
  }

  // Client-side video frame capture to guarantee filmstrip thumbnails
  captureThumbnailsFromVideo(videoUrl, duration, numThumbs = 16) {
    if (duration <= 0 || !videoUrl) return;

    const offscreenVideo = document.createElement('video');
    offscreenVideo.src = videoUrl;
    offscreenVideo.muted = true;
    offscreenVideo.crossOrigin = "anonymous";

    const offscreenCanvas = document.createElement('canvas');
    offscreenCanvas.width = 160;
    offscreenCanvas.height = 90;
    const offCtx = offscreenCanvas.getContext('2d');

    const step = duration / Math.max(1, numThumbs);
    let idx = 0;
    const collected = [];

    offscreenVideo.addEventListener('loadeddata', () => {
      seekNext();
    });

    const seekNext = () => {
      if (idx >= numThumbs) {
        this.loadThumbnails(collected);
        return;
      }
      offscreenVideo.currentTime = idx * step;
    };

    offscreenVideo.addEventListener('seeked', () => {
      try {
        offCtx.drawImage(offscreenVideo, 0, 0, 160, 90);
        const dataUrl = offscreenCanvas.toDataURL('image/jpeg', 0.7);
        collected.push({ time: idx * step, data: dataUrl });
      } catch (err) {
        console.warn("Canvas thumbnail capture error:", err);
      }
      idx++;
      seekNext();
    });
  }

  updatePlayhead(currentTime) {
    this.currentTime = currentTime || 0;
    this.render();
  }

  setMarkers(markIn, markOut) {
    this.markIn = markIn;
    this.markOut = markOut;
    this.render();
  }

  setSegments(segments) {
    this.segments = segments || [];
    this.render();
  }

  initEvents() {
    const handleMouse = (e) => {
      if (this.duration <= 0) return;
      const rect = this.canvas.getBoundingClientRect();
      const x = Math.max(0, Math.min(this.width, e.clientX - rect.left));
      const targetTime = (x / this.width) * this.duration;
      this.onSeekCb(targetTime);
    };

    this.canvas.addEventListener('mousedown', (e) => {
      this.isDragging = true;
      handleMouse(e);
    });

    window.addEventListener('mousemove', (e) => {
      if (this.isDragging) {
        handleMouse(e);
      }
    });

    window.addEventListener('mouseup', () => {
      this.isDragging = false;
    });
  }

  render() {
    if (!this.ctx || this.width <= 0) return;
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;

    // 1. Clear canvas
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, w, h);

    if (this.duration <= 0) {
      ctx.fillStyle = '#94a3b8';
      ctx.font = '600 12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.fillText('No video loaded', 16, h / 2 + 4);
      return;
    }

    // 2. Render Filmstrip Thumbnails Background
    if (this.thumbnails.length > 0) {
      const thumbW = w / this.thumbnails.length;
      this.thumbnails.forEach((t, idx) => {
        if (t.img.complete && t.img.naturalWidth > 0) {
          const x = idx * thumbW;
          ctx.drawImage(t.img, x, 0, thumbW, h);
          // Subtle frame separator line
          ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
          ctx.fillRect(x + thumbW - 1, 0, 1, h);
        }
      });
    } else {
      // Subtle time division grid
      ctx.fillStyle = '#e2e8f0';
      for (let i = 0; i < 12; i++) {
        ctx.fillRect((i / 12) * w, 0, 1, h);
      }
    }

    // 3. Draw Kept Segments (Clean Teal Bracket Highlights)
    for (const seg of this.segments) {
      const x1 = (seg.start / this.duration) * w;
      const x2 = (seg.end / this.duration) * w;
      const segW = Math.max(4, x2 - x1);

      // Semi-transparent teal body fill
      ctx.fillStyle = 'rgba(13, 148, 136, 0.35)';
      ctx.fillRect(x1, 0, segW, h);

      // Solid teal top and bottom border bars
      ctx.fillStyle = '#0d9488';
      ctx.fillRect(x1, 0, segW, 3);
      ctx.fillRect(x1, h - 3, segW, 3);

      // Clean end bracket handles
      ctx.fillRect(x1, 0, 3, h);
      ctx.fillRect(x2 - 3, 0, 3, h);
    }

    // 4. Draw Active In/Out Selection Range
    if (this.markIn !== null && this.markOut !== null) {
      const start = Math.min(this.markIn, this.markOut);
      const end = Math.max(this.markIn, this.markOut);
      const x1 = (start / this.duration) * w;
      const x2 = (end / this.duration) * w;
      const segW = Math.max(4, x2 - x1);

      ctx.fillStyle = 'rgba(99, 102, 241, 0.2)';
      ctx.fillRect(x1, 0, segW, h);

      ctx.strokeStyle = '#4f46e5';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(x1, 1, segW, h - 2);
      ctx.setLineDash([]);
    }

    // Draw Mark In Pin (Teal)
    if (this.markIn !== null) {
      const xin = (this.markIn / this.duration) * w;
      ctx.fillStyle = '#0d9488';
      ctx.fillRect(xin - 1, 0, 3, h);

      ctx.beginPath();
      ctx.moveTo(xin - 5, 0);
      ctx.lineTo(xin + 7, 0);
      ctx.lineTo(xin - 5, 12);
      ctx.fill();
    }

    // Draw Mark Out Pin (Rose)
    if (this.markOut !== null) {
      const xout = (this.markOut / this.duration) * w;
      ctx.fillStyle = '#e11d48';
      ctx.fillRect(xout - 1, 0, 3, h);

      ctx.beginPath();
      ctx.moveTo(xout + 5, 0);
      ctx.lineTo(xout - 7, 0);
      ctx.lineTo(xout + 5, 12);
      ctx.fill();
    }

    // 5. Draw Slim Purple Accent Bottom Border (Replaced thick solid purple bar)
    ctx.fillStyle = '#6366f1';
    ctx.fillRect(0, h - 2, w, 2);

    // 6. Draw Nordic Indigo Needle Playhead
    const px = (this.currentTime / this.duration) * w;

    // Needle shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.fillRect(px + 1, 0, 2, h);

    // Indigo Needle line
    ctx.fillStyle = '#4f46e5';
    ctx.fillRect(px - 1, 0, 2, h);

    // Diamond Playhead Indicator
    ctx.fillStyle = '#4f46e5';
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px + 6, 6);
    ctx.lineTo(px, 12);
    ctx.lineTo(px - 6, 6);
    ctx.closePath();
    ctx.fill();
  }
}

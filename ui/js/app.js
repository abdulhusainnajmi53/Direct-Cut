document.addEventListener('DOMContentLoaded', () => {
  let currentFilePath = null;

  // Initialize Timeline Canvas Component
  const timeline = new ProTimelineCanvas('timelineCanvas', {
    onSeek: (time) => {
      player.seekTo(time);
    }
  });

  // Initialize Video Player Controller Component
  const player = new VideoPlayerController('videoPlayer', {
    onTimeUpdate: (time) => {
      timeline.updatePlayhead(time);
      lblCurrentTimecode.textContent = player.formatTimecode(time);
    },
    onLoaded: (duration) => {
      timeline.setData(duration, player.keyframes);
      lblDurationTimecode.textContent = player.formatTimecode(duration);
      updateRuler(duration);
    },
    onSegmentsChanged: (state) => {
      timeline.setMarkers(state.markIn, state.markOut);
      timeline.setSegments(state.segments);
      renderSegmentsList(state.segments);
      updateExportButtonState();
    }
  });

  // DOM Handles
  const btnBrowse = document.getElementById('btnBrowse');
  const btnCloseVideo = document.getElementById('btnCloseVideo');
  const dropOverlay = document.getElementById('dropOverlay');
  
  const lblFilename = document.getElementById('lblFilename');
  const lblMetaSubtitle = document.getElementById('lblMetaSubtitle');

  const lblCurrentTimecode = document.getElementById('lblCurrentTimecode');
  const lblDurationTimecode = document.getElementById('lblDurationTimecode');
  const timelineRuler = document.getElementById('timelineRuler');

  const btnPlayPause = document.getElementById('btnPlayPause');
  const playIcon = document.getElementById('playIcon');
  const btnStepPrevFrame = document.getElementById('btnStepPrevFrame');
  const btnStepNextFrame = document.getElementById('btnStepNextFrame');
  const btnPrevKeyframe = document.getElementById('btnPrevKeyframe');
  const btnNextKeyframe = document.getElementById('btnNextKeyframe');
  const speedSelect = document.getElementById('speedSelect');

  const volSlider = document.getElementById('volSlider');
  const btnMute = document.getElementById('btnMute');
  const volIcon = document.getElementById('volIcon');

  const btnMarkIn = document.getElementById('btnMarkIn');
  const btnMarkOut = document.getElementById('btnMarkOut');
  const btnAddSegment = document.getElementById('btnAddSegment');
  const segmentsList = document.getElementById('segmentsList');
  const clipCountBadge = document.getElementById('clipCountBadge');

  const chkMerge = document.getElementById('chkMerge');
  const btnStartExport = document.getElementById('btnStartExport');
  const progressContainer = document.getElementById('progressContainer');
  const progressFill = document.getElementById('progressFill');
  const progressText = document.getElementById('progressText');
  const statusLog = document.getElementById('statusLog');
  const logResizeBar = document.getElementById('logResizeBar');

  const btnShortcutsHelp = document.getElementById('btnShortcutsHelp');
  const shortcutsModal = document.getElementById('shortcutsModal');
  const btnCloseModal = document.getElementById('btnCloseModal');

  // File Open Handler
  btnBrowse.addEventListener('click', async () => {
    if (window.pywebview && window.pywebview.api) {
      try {
        const filePath = await window.pywebview.api.select_file();
        if (filePath && filePath.trim() !== "") {
          loadVideoFile(filePath);
        }
      } catch (err) {
        logStatus(`File dialog error: ${err}`);
      }
    } else {
      // Browser dev fallback
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'video/*';
      input.onchange = (e) => {
        const file = e.target.files[0];
        if (file) {
          currentFilePath = file.name;
          const url = URL.createObjectURL(file);
          player.loadSource(url);
          timeline.captureThumbnailsFromVideo(url, 30);
          dropOverlay.classList.add('hidden');
          lblFilename.textContent = file.name;
          lblMetaSubtitle.textContent = "Local File Preview";
        }
      };
      input.click();
    }
  });

  // Close Video Handler
  btnCloseVideo.addEventListener('click', () => {
    currentFilePath = null;
    player.reset();
    timeline.reset();
    dropOverlay.classList.remove('hidden');

    lblFilename.textContent = "No Video Loaded";
    lblMetaSubtitle.textContent = "Open a video file to begin lossless trimming";

    lblCurrentTimecode.textContent = '00:00:00:00';
    lblDurationTimecode.textContent = '00:00:00:00';

    progressContainer.classList.remove('active');
    updateExportButtonState();
    logStatus("Video closed. Ready for next file.");
  });

  // Drag & Drop File Loading
  document.body.addEventListener('dragover', (e) => e.preventDefault());
  document.body.addEventListener('drop', (e) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (file.path) {
        loadVideoFile(file.path);
      } else if (file) {
        currentFilePath = file.name;
        const url = URL.createObjectURL(file);
        player.loadSource(url);
        timeline.captureThumbnailsFromVideo(url, 30);
        dropOverlay.classList.add('hidden');
        lblFilename.textContent = file.name;
        lblMetaSubtitle.textContent = "Local File Preview";
      }
    }
  });

  async function loadVideoFile(filePath) {
    currentFilePath = filePath;
    dropOverlay.classList.add('hidden');
    logStatus(`Loading video: ${filePath}`);

    if (window.pywebview && window.pywebview.api) {
      const data = await window.pywebview.api.load_video_data(filePath);
      if (data && !data.error) {
        const meta = data.metadata;
        player.setFps(meta.fps);
        player.setKeyframes(data.keyframes || []);
        player.loadSource(data.file_url, meta.duration);

        if (data.thumbnails && data.thumbnails.length > 0) {
          timeline.setData(meta.duration, data.keyframes || [], data.thumbnails);
        } else {
          timeline.setData(meta.duration, data.keyframes || []);
          timeline.captureThumbnailsFromVideo(data.file_url, meta.duration);
        }

        // Header Title & Specs
        lblFilename.textContent = meta.filename;
        lblMetaSubtitle.textContent = `${meta.resolution} | ${meta.fps} fps | ${meta.bitrate} | ${meta.video_codec} | ${meta.audio_codec}`;

        updateRuler(meta.duration);
        updateExportButtonState();
        logStatus(`Loaded: ${meta.filename} (${meta.resolution}, ${meta.fps}fps, ${meta.bitrate})`);
      } else {
        logStatus(`Error loading video: ${data.error || 'Unknown error'}`);
      }
    }
  }

  function updateRuler(duration) {
    if (!timelineRuler || duration <= 0) return;
    const step = duration / 4;
    timelineRuler.innerHTML = `
      <span>${player.formatTimecode(0)}</span>
      <span>${player.formatTimecode(step * 1)}</span>
      <span>${player.formatTimecode(step * 2)}</span>
      <span>${player.formatTimecode(step * 3)}</span>
      <span>${player.formatTimecode(duration)}</span>
    `;
  }

  // Playback Controls
  btnPlayPause.addEventListener('click', (e) => {
    e.stopPropagation();
    player.togglePlay();
  });

  player.video.addEventListener('play', () => {
    playIcon.innerHTML = `<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>`;
  });

  player.video.addEventListener('pause', () => {
    playIcon.innerHTML = `<path d="M8 5v14l11-7z"/>`;
  });

  btnStepPrevFrame.addEventListener('click', (e) => {
    e.stopPropagation();
    player.stepFrame(-1);
  });
  
  btnStepNextFrame.addEventListener('click', (e) => {
    e.stopPropagation();
    player.stepFrame(1);
  });
  
  btnPrevKeyframe.addEventListener('click', (e) => {
    e.stopPropagation();
    player.jumpKeyframe(-1);
  });
  
  btnNextKeyframe.addEventListener('click', (e) => {
    e.stopPropagation();
    player.jumpKeyframe(1);
  });

  speedSelect.addEventListener('change', (e) => {
    player.video.playbackRate = parseFloat(e.target.value);
  });

  // Volume Controls
  volSlider.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    player.video.volume = val;
    player.video.muted = val === 0;
    updateVolIcon(val);
  });

  btnMute.addEventListener('click', () => {
    player.video.muted = !player.video.muted;
    updateVolIcon(player.video.muted ? 0 : player.video.volume);
    volSlider.value = player.video.muted ? 0 : player.video.volume;
  });

  function updateVolIcon(vol) {
    if (vol === 0) {
      volIcon.innerHTML = `<path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>`;
    } else {
      volIcon.innerHTML = `<path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>`;
    }
  }

  // Markers & Segments
  btnMarkIn.addEventListener('click', (e) => {
    e.stopPropagation();
    player.setMarkIn();
    logStatus(`Mark In set: ${player.formatTimecode(player.video.currentTime)}`);
  });

  btnMarkOut.addEventListener('click', (e) => {
    e.stopPropagation();
    player.setMarkOut();
    logStatus(`Mark Out set: ${player.formatTimecode(player.video.currentTime)}`);
  });

  btnAddSegment.addEventListener('click', (e) => {
    e.stopPropagation();
    const success = player.addSegmentFromMarkers();
    if (!success) {
      logStatus("Please set both Mark In [I] and Mark Out [O] points before adding a clip.");
    } else {
      logStatus(`Clip added to Keep list.`);
    }
  });

  function renderSegmentsList(segments) {
    segmentsList.innerHTML = '';
    clipCountBadge.textContent = `${segments.length} ${segments.length === 1 ? 'Clip' : 'Clips'}`;

    if (segments.length === 0) {
      segmentsList.innerHTML = `
        <div class="empty-clips-msg">
          No clips added yet.<br>Mark In [I] and Out [O], then press "+ Add Clip".
        </div>`;
      return;
    }

    segments.forEach((seg, idx) => {
      const card = document.createElement('div');
      card.className = 'clip-card-row';

      // Find closest thumbnail for clip preview
      let thumbSrc = '';
      if (timeline.thumbnails && timeline.thumbnails.length > 0) {
        const closest = timeline.thumbnails.find(t => t.time >= seg.start) || timeline.thumbnails[0];
        if (closest && closest.img && closest.img.src) {
          thumbSrc = closest.img.src;
        }
      }

      const thumbHtml = thumbSrc 
        ? `<img class="clip-thumb-preview" src="${thumbSrc}" alt="thumb" />`
        : `<div class="clip-thumb-preview"><svg width="18" height="18" fill="#818CF8" viewBox="0 0 24 24"><path d="M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4h-4z"/></svg></div>`;

      card.innerHTML = `
        ${thumbHtml}
        <div class="clip-info">
          <div class="clip-title-line">
            <span>Clip ${idx + 1}</span>
            <span class="duration-pill">${player.formatTimecode(seg.duration)}</span>
          </div>
          <div class="clip-time-range">${player.formatTimecode(seg.start)} - ${player.formatTimecode(seg.end)}</div>
        </div>
        <div class="clip-right-actions">
          <button class="btn-card-del" data-remove="${seg.id}" title="Remove Clip">✕</button>
        </div>
      `;

      card.addEventListener('click', (e) => {
        if (!e.target.closest('[data-remove]')) {
          player.seekTo(seg.start);
          player.video.play();
        }
      });

      card.querySelector('[data-remove]').addEventListener('click', (e) => {
        e.stopPropagation();
        player.removeSegment(seg.id);
      });

      segmentsList.appendChild(card);
    });
  }

  function updateExportButtonState() {
    const hasSegments = player.segments && player.segments.length > 0;
    const hasVideo = currentFilePath || (player.video && player.video.src);
    btnStartExport.disabled = !(hasVideo && hasSegments);
  }

  // Export Trigger
  btnStartExport.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!currentFilePath || player.segments.length === 0) return;

    btnStartExport.disabled = true;
    progressContainer.classList.add('active');
    progressFill.style.width = '0%';
    progressText.textContent = 'Initializing Lossless Export... 0%';
    logStatus("Starting FFmpeg stream copy process...");

    if (window.pywebview && window.pywebview.api) {
      await window.pywebview.api.start_export(
        currentFilePath,
        player.segments,
        chkMerge.checked
      );
    }
  });

  // Export Callbacks
  window.onExportProgress = (data) => {
    const pct = data.progress || 0;
    progressFill.style.width = `${pct}%`;
    progressText.textContent = `${data.status} (${pct}%)`;
    logStatus(data.status);
  };

  window.onExportFinished = (result) => {
    progressFill.style.width = '100%';
    btnStartExport.disabled = false;

    if (result.success) {
      progressText.textContent = 'Export Completed! 100%';
      logStatus(`✅ SUCCESS: ${result.message}`);
    } else {
      progressText.textContent = 'Export Failed!';
      logStatus(`❌ ERROR: ${result.message}`);
    }
  };

  // Activity Log Resize Drag Handler
  if (logResizeBar && statusLog) {
    let isResizing = false;
    let startY = 0;
    let startH = 0;

    logResizeBar.addEventListener('mousedown', (e) => {
      isResizing = true;
      startY = e.clientY;
      startH = statusLog.clientHeight;
      document.body.style.cursor = 'ns-resize';
      e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
      if (!isResizing) return;
      const dy = startY - e.clientY; // dragging up increases height
      const newH = Math.max(40, Math.min(260, startH + dy));
      statusLog.style.height = `${newH}px`;
    });

    window.addEventListener('mouseup', () => {
      if (isResizing) {
        isResizing = false;
        document.body.style.cursor = 'default';
      }
    });
  }

  function logStatus(msg) {
    statusLog.textContent = `[${new Date().toLocaleTimeString()}] ${msg}\n` + statusLog.textContent;
  }

  // Shortcuts Modal
  btnShortcutsHelp.addEventListener('click', (e) => {
    e.stopPropagation();
    shortcutsModal.classList.add('active');
  });

  btnCloseModal.addEventListener('click', (e) => {
    e.stopPropagation();
    shortcutsModal.classList.remove('active');
  });

  shortcutsModal.addEventListener('click', (e) => {
    if (e.target === shortcutsModal) shortcutsModal.classList.remove('active');
  });
});

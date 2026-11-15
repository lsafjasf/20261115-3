/* Browser UI wired to the shared core modules (no duplicated logic). */
(function () {
  'use strict';

  const { SubtitleCore: core, SubtitleVTT: vtt, SubtitleStorage: storage } =
    window;

  const els = {
    cueList: document.getElementById('cue-list'),
    cueCount: document.getElementById('cue-count'),
    cueEditor: document.getElementById('cue-editor'),
    editorTitle: document.getElementById('editor-title'),
    cueStart: document.getElementById('cue-start'),
    cueEnd: document.getElementById('cue-end'),
    cueWidth: document.getElementById('cue-width'),
    cueLayout: document.getElementById('cue-layout'),
    cueWrap: document.getElementById('cue-wrap'),
    cueText: document.getElementById('cue-text'),
    tabs: document.querySelectorAll('.language-tabs .tab'),
    preview: document.getElementById('wrapped-preview'),
    duration: document.getElementById('timeline-duration'),
    validation: document.getElementById('validation-list'),
    tracks: document.getElementById('timeline-tracks'),
    playhead: document.getElementById('playhead'),
    timeline: document.getElementById('timeline'),
    stageCue: document.getElementById('stage-cue'),
    clockReadout: document.getElementById('clock-readout'),
    playPause: document.getElementById('play-pause'),
    audio: document.getElementById('audio'),
    fallbackNote: document.getElementById('fallback-note'),
    blockedDialog: document.getElementById('blocked-dialog'),
    blockedReasons: document.getElementById('blocked-reasons'),
  };

  /* Canvas gives exact per-glyph metrics for the editor font; the core's
   * estimator remains the fallback used in Node. */
  const measureContext = document.createElement('canvas').getContext('2d');
  measureContext.font = '16px "PingFang SC","Microsoft YaHei",sans-serif';
  const measure = (char) => measureContext.measureText(char).width;

  const project = storage.createProject({
    name: '双语演示 Bilingual demo',
    durationMs: 12000,
    cues: [
      {
        startMs: 500,
        endMs: 3500,
        zh: '欢迎观看2026年度发布会，分辨率支持4K和1080P。',
        en: 'Welcome to the 2026 keynote, streaming in 4K and 1080p.',
        maxWidthPx: 240,
        wrap: true,
        layout: core.LAYOUTS.STACKED,
      },
      {
        startMs: 4000,
        endMs: 7500,
        zh: '第3章：AI 字幕编辑器支持中英混排。',
        en: 'Chapter 3: the AI subtitle editor handles zh/en mixed text.',
        maxWidthPx: 360,
        wrap: true,
        layout: core.LAYOUTS.SIDE_BY_SIDE,
      },
      {
        startMs: 8000,
        endMs: 11500,
        zh: '联系我们：400-800-1234，编号 No.7。',
        en: 'Contact us at 400-800-1234, reference No.7.',
        maxWidthPx: 300,
        wrap: true,
        layout: core.LAYOUTS.STACKED,
      },
    ],
  });

  const clock = new core.Clock();
  let selectedId = project.cues[0] ? project.cues[0].id : null;
  let activeLanguage = 'zh';

  function selectedCue() {
    return project.cues.find((cue) => cue.id === selectedId) || null;
  }

  function renderCueList(report) {
    const errorIds = new Set(
      report.errors.map((issue) => issue.cueId)
    );
    els.cueList.innerHTML = '';
    project.cues.forEach((cue, index) => {
      const item = document.createElement('li');
      item.className = 'cue-item';
      if (cue.id === selectedId) item.classList.add('active');
      if (errorIds.has(cue.id)) item.classList.add('has-error');
      item.innerHTML =
        '<div class="cue-time">' +
        core.formatTimestamp(cue.startMs) +
        ' → ' +
        core.formatTimestamp(cue.endMs) +
        ' · ' +
        cue.maxWidthPx +
        'px · ' +
        cue.layout +
        '</div>' +
        '<div class="cue-zh"></div>' +
        '<div class="cue-en"></div>';
      item.querySelector('.cue-zh').textContent = cue.zh || '（无中文）';
      item.querySelector('.cue-en').textContent = cue.en || '(no English)';
      item.addEventListener('click', () => {
        selectedId = cue.id;
        renderAll();
      });
      item.dataset.index = index;
      els.cueList.appendChild(item);
    });
    els.cueCount.textContent = String(project.cues.length);
  }

  function renderEditor() {
    const cue = selectedCue();
    els.cueEditor.hidden = !cue;
    if (!cue) return;
    els.editorTitle.textContent =
      '编辑字幕 #' + (storage.findCueIndex(project, cue.id) + 1);
    els.cueStart.value = core.formatTimestamp(cue.startMs);
    els.cueEnd.value = core.formatTimestamp(cue.endMs);
    els.cueWidth.value = String(cue.maxWidthPx);
    els.cueLayout.value = cue.layout;
    els.cueWrap.checked = cue.wrap !== false;
    // Textarea only ever binds the active language; the sibling field is
    // never touched, so switching tabs preserves the other language.
    els.cueText.value = cue[activeLanguage];
    els.tabs.forEach((tab) => {
      tab.classList.toggle(
        'active',
        tab.dataset.language === activeLanguage
      );
    });
    renderWrappedPreview(cue);
  }

  function renderWrappedPreview(cue) {
    const rendered = core.renderCue(cue, measure);
    els.preview.innerHTML = '';
    const add = (label, lines, colorClass) => {
      const title = document.createElement('div');
      title.textContent = label;
      els.preview.appendChild(title);
      if (!lines.length) {
        const empty = document.createElement('div');
        empty.textContent = '（空）';
        els.preview.appendChild(empty);
        return;
      }
      lines.forEach((line) => {
        const node = document.createElement('div');
        node.className = colorClass;
        node.textContent = line || ' ';
        node.title =
          '宽度 ' + Math.round(core.textWidth(line, measure)) + 'px';
        els.preview.appendChild(node);
      });
    };
    add('中文折行（上限 ' + cue.maxWidthPx + 'px）', rendered.zh, 'stage-lang-zh');
    add('English wrap', rendered.en, 'stage-lang-en');
  }

  /* Editor event bindings ------------------------------------------- */

  els.tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const cue = selectedCue();
      if (cue) storage.updateCueText(project, cue.id, activeLanguage, els.cueText.value);
      activeLanguage = tab.dataset.language;
      renderAll();
    });
  });

  els.cueText.addEventListener('input', () => {
    const cue = selectedCue();
    if (cue) {
      storage.updateCueText(project, cue.id, activeLanguage, els.cueText.value);
      renderWrappedPreview(cue);
      renderValidationAndTimeline();
    }
  });

  function bindTimestamp(input, field) {
    input.addEventListener('change', () => {
      const cue = selectedCue();
      if (!cue) return;
      try {
        const ms = core.parseTimestamp(input.value);
        storage.updateCue(project, cue.id, { [field]: ms });
        storage.sortCues(project);
      } catch (error) {
        input.setCustomValidity(error.message);
        input.reportValidity();
        input.setCustomValidity('');
      }
      renderAll();
    });
  }
  bindTimestamp(els.cueStart, 'startMs');
  bindTimestamp(els.cueEnd, 'endMs');

  els.cueWidth.addEventListener('change', () => {
    const cue = selectedCue();
    if (!cue) return;
    storage.updateCue(project, cue.id, {
      maxWidthPx: Math.max(40, Number(els.cueWidth.value) || 320),
    });
    renderAll();
  });

  els.cueLayout.addEventListener('change', () => {
    const cue = selectedCue();
    if (!cue) return;
    storage.updateCue(project, cue.id, { layout: els.cueLayout.value });
    renderAll();
  });

  els.cueWrap.addEventListener('change', () => {
    const cue = selectedCue();
    if (!cue) return;
    storage.updateCue(project, cue.id, { wrap: els.cueWrap.checked });
    renderAll();
  });

  document.getElementById('delete-cue').addEventListener('click', () => {
    const cue = selectedCue();
    if (!cue) return;
    storage.removeCue(project, cue.id);
    selectedId = project.cues[0] ? project.cues[0].id : null;
    renderAll();
  });

  document.getElementById('add-cue').addEventListener('click', () => {
    const last = project.cues[project.cues.length - 1];
    const cue = storage.addCue(project, {
      startMs: last ? last.endMs : 0,
      endMs: last ? last.endMs + 2000 : 2000,
      maxWidthPx: 320,
      wrap: true,
      layout: core.LAYOUTS.STACKED,
    });
    selectedId = cue.id;
    renderAll();
  });

  els.duration.addEventListener('change', () => {
    project.durationMs = Number(els.duration.value) || null;
    renderAll();
  });

  /* Validation + timeline + stage ----------------------------------- */

  function currentReport() {
    return core.validateCues(project.cues, {
      durationMs: project.durationMs,
    });
  }

  function renderValidation() {
    const report = currentReport();
    els.validation.innerHTML = '';
    if (!report.issues.length) {
      const ok = document.createElement('li');
      ok.className = 'ok';
      ok.textContent = '✓ 无重叠、无越界，可以导出';
      els.validation.appendChild(ok);
      return report;
    }
    report.issues.forEach((issue) => {
      const item = document.createElement('li');
      item.className = issue.level;
      item.textContent =
        (issue.level === 'error' ? '✕ ' : '⚠ ') + issue.message;
      els.validation.appendChild(item);
    });
    return report;
  }

  function effectiveDuration() {
    if (project.durationMs) return project.durationMs;
    const audioDuration = clock.durationMs;
    if (audioDuration) return audioDuration;
    return Math.max(12000, ...project.cues.map((cue) => cue.endMs));
  }

  function renderTimeline(report) {
    const duration = effectiveDuration();
    const overlapIds = new Set(
      report.errors
        .filter((issue) => issue.code === 'OVERLAP')
        .flatMap((issue) => [issue.cueId, issue.otherCueId])
    );
    els.tracks.innerHTML = '';
    els.tracks.style.height = project.cues.length * 25 + 10 + 'px';
    project.cues.forEach((cue, index) => {
      const block = document.createElement('div');
      block.className = 'track-block' + (overlapIds.has(cue.id) ? ' overlap' : '');
      block.style.left = (cue.startMs / duration) * 100 + '%';
      block.style.width =
        Math.max(1, ((cue.endMs - cue.startMs) / duration) * 100) + '%';
      block.style.top = index * 25 + 'px';
      block.textContent =
        (index + 1) + ' ' + (cue.zh.slice(0, 8) || cue.en.slice(0, 8));
      block.title =
        core.formatTimestamp(cue.startMs) +
        ' → ' +
        core.formatTimestamp(cue.endMs);
      block.addEventListener('click', (event) => {
        event.stopPropagation();
        selectedId = cue.id;
        renderAll();
      });
      els.tracks.appendChild(block);
    });
    updatePlayhead();
  }

  function renderStage() {
    const now = clock.timeMs;
    const cue = project.cues.find(
      (item) => now >= item.startMs && now < item.endMs
    );
    els.stageCue.innerHTML = '';
    if (!cue) return;
    els.stageCue.className =
      'stage-cue ' +
      (cue.layout === core.LAYOUTS.SIDE_BY_SIDE
        ? 'side-by-side'
        : 'stacked');
    const rendered = core.renderCue(cue, measure);
    const columns = [
      { lines: rendered.zh, className: 'stage-lang-zh' },
      { lines: rendered.en, className: 'stage-lang-en' },
    ];
    columns.forEach((column) => {
      const wrap = document.createElement('div');
      wrap.style.maxWidth =
        (cue.layout === core.LAYOUTS.SIDE_BY_SIDE
          ? Math.floor(cue.maxWidthPx / 2)
          : cue.maxWidthPx) + 'px';
      column.lines.forEach((line) => {
        const node = document.createElement('div');
        node.className = 'stage-line ' + column.className;
        node.textContent = line;
        wrap.appendChild(node);
      });
      els.stageCue.appendChild(wrap);
    });
  }

  function updatePlayhead() {
    const duration = effectiveDuration();
    const percent = Math.min(100, (clock.timeMs / duration) * 100);
    els.playhead.style.left = `calc(12px + (100% - 24px) * ${percent / 100})`;
    els.clockReadout.textContent = core.formatTimestamp(clock.timeMs);
  }

  function renderValidationAndTimeline() {
    const report = renderValidation();
    renderTimeline(report);
    renderStage();
    return report;
  }

  function renderAll() {
    els.duration.value =
      project.durationMs == null ? '' : String(project.durationMs);
    renderCueList(currentReport());
    renderEditor();
    renderValidationAndTimeline();
  }

  /* Clock + audio: one source of truth for playhead and playback ----- */

  document
    .getElementById('audio-file')
    .addEventListener('change', (event) => {
      const file = event.target.files[0];
      if (!file) return;
      els.audio.src = URL.createObjectURL(file);
      els.audio.hidden = false;
      clock.attachAudio(els.audio);
      els.fallbackNote.textContent = '时钟：已绑定音频 ' + file.name;
      els.audio.addEventListener('loadedmetadata', () => {
        project.durationMs = els.audio.duration * 1000;
        renderAll();
      });
    });

  clock.subscribe(() => {
    updatePlayhead();
    renderStage();
  });

  els.playPause.addEventListener('click', () => {
    clock.toggle();
    els.playPause.textContent = clock.isPlaying ? '⏸ 暂停' : '▶ 播放';
  });

  els.timeline.addEventListener('click', (event) => {
    const rect = els.tracks.getBoundingClientRect();
    const ratio = Math.min(
      1,
      Math.max(0, (event.clientX - rect.left) / rect.width)
    );
    clock.seek(ratio * effectiveDuration());
  });

  /* Export blocked while validation reports errors ------------------- */

  function download(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  document.getElementById('export-vtt').addEventListener('click', () => {
    const cue = selectedCue();
    if (cue) storage.updateCueText(project, cue.id, activeLanguage, els.cueText.value);
    const report = currentReport();
    if (!report.canExport) {
      els.blockedReasons.innerHTML = '';
      report.errors.forEach((issue) => {
        const li = document.createElement('li');
        li.textContent = issue.message;
        els.blockedReasons.appendChild(li);
      });
      els.blockedDialog.showModal();
      return;
    }
    download('subtitles.vtt', vtt.exportVTT(project.cues, { measure }), 'text/vtt');
  });

  document.getElementById('vtt-import').addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const result = vtt.importVTT(String(reader.result));
        project.cues = result.cues;
        storage.sortCues(project);
        selectedId = project.cues[0] ? project.cues[0].id : null;
        renderAll();
        if (result.warnings.length) alert(result.warnings.join('\n'));
      } catch (error) {
        alert('导入失败：' + error.message);
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  });

  renderAll();

  window.__subtitleApp = { project, clock, core, vtt, storage, measure };
})();

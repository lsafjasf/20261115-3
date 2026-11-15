/*
 * Subtitle editor core: shared by the browser UI and the Node verification
 * harness. UMD-style module so the same code runs in both environments.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.SubtitleCore = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Timecode helpers (milliseconds <-> WebVTT timestamps)              */
  /* ------------------------------------------------------------------ */

  function pad(value, width) {
    return String(value).padStart(width, '0');
  }

  function formatTimestamp(ms) {
    if (!Number.isFinite(ms) || ms < 0) ms = 0;
    ms = Math.round(ms);
    const minutes = Math.floor(ms / 60000);
    const hours = Math.floor(minutes / 60);
    const seconds = Math.floor((ms % 60000) / 1000);
    return (
      pad(hours, 2) +
      ':' +
      pad(minutes % 60, 2) +
      ':' +
      pad(seconds, 2) +
      '.' +
      pad(ms % 1000, 3)
    );
  }

  function parseTimestamp(value) {
    if (typeof value !== 'string') {
      throw new Error('timestamp must be a string');
    }
    const match = value
      .trim()
      .match(/^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/);
    if (!match) {
      throw new Error('invalid timestamp: ' + value);
    }
    const hours = parseInt(match[1] || '0', 10);
    const minutes = parseInt(match[2], 10);
    const seconds = parseInt(match[3], 10);
    const fraction = match[4].padEnd(3, '0');
    const millis = parseInt(fraction, 10);
    if (minutes > 59 || seconds > 59) {
      throw new Error('timestamp field out of range: ' + value);
    }
    return ((hours * 60 + minutes) * 60 + seconds) * 1000 + millis;
  }

  /* ------------------------------------------------------------------ */
  /* Clock: one time source shared by the audio element and playhead.   */
  /* ------------------------------------------------------------------ */

  class Clock {
    constructor() {
      this._audio = null;
      this._manualStart = 0;
      this._manualBase = 0;
      this._playing = false;
      this._listeners = new Set();
      this._tick = this._tick.bind(this);
    }

    /* An <audio> element may be attached at any time. Once attached the
     * audio element's currentTime is the clock; there is no second timer. */
    attachAudio(audio) {
      if (this._audio) {
        this._audio.removeEventListener('timeupdate', this._tick);
      }
      this._audio = audio;
      if (audio) {
        audio.preload = 'metadata';
        audio.addEventListener('timeupdate', this._tick);
        this._tick();
      }
      return this;
    }

    get audio() {
      return this._audio;
    }

    get isPlaying() {
      return this._playing;
    }

    get timeMs() {
      if (this._audio) {
        return this._audio.currentTime * 1000;
      }
      if (this._playing) {
        return this._manualBase + (Date.now() - this._manualStart);
      }
      return this._manualBase;
    }

    get durationMs() {
      if (this._audio && Number.isFinite(this._audio.duration)) {
        return this._audio.duration * 1000;
      }
      return null;
    }

    seek(timeMs) {
      const clamped = Math.max(0, timeMs);
      if (this._audio) {
        this._audio.currentTime = clamped / 1000;
      } else {
        this._manualBase = clamped;
        this._manualStart = Date.now();
      }
      this._emit();
    }

    async play() {
      this._playing = true;
      if (this._audio) {
        await this._audio.play();
      } else {
        this._manualStart = Date.now();
      }
      this._emit();
    }

    pause() {
      if (!this._playing) return;
      if (this._audio) {
        this._audio.pause();
      } else {
        this._manualBase = this.timeMs;
      }
      this._playing = false;
      this._emit();
    }

    toggle() {
      return this._playing ? this.pause() : this.play();
    }

    subscribe(listener) {
      this._listeners.add(listener);
      return () => this._listeners.delete(listener);
    }

    _tick() {
      this._emit();
    }

    _emit() {
      for (const listener of this._listeners) {
        listener(this.timeMs, this._playing);
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Mixed CJK / Latin / digit text measurement and wrapping            */
  /*                                                                     */
  /* A "measure" function takes one character and returns its advance   */
  /* width in px. The default estimator mirrors common font metrics:    */
  /* CJK glyphs are full-width, Latin/digits are roughly half-width.    */
  /* The browser UI injects a canvas-based measure for exact metrics.   */
  /* ------------------------------------------------------------------ */

  function isCJK(char) {
    const code = char.codePointAt(0);
    return (
      (code >= 0x2e80 && code <= 0x9fff) ||
      (code >= 0xac00 && code <= 0xd7af) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xff00 && code <= 0xffef)
    );
  }

  function defaultMeasure(char) {
    if (char === ' ') return 3;
    if (isCJK(char)) return 16;
    if (/[A-Z0-9]/.test(char)) return 9;
    return 8;
  }

  function textWidth(text, measure) {
    const measureFn = measure || defaultMeasure;
    let width = 0;
    for (const char of text) {
      width += measureFn(char);
    }
    return width;
  }

  /* Split text into tokens. CJK characters and punctuation each become
   * breakable tokens; runs of Latin letters, digits and interior
   * punctuation (e.g. "1080p", "3.14", "COVID-19") stay atomic. */
  function tokenize(text) {
    const tokens = [];
    let latinRun = '';
    const flushLatin = () => {
      if (latinRun) {
        tokens.push({ text: latinRun, breakable: false });
        latinRun = '';
      }
    };
    for (const char of text) {
      if (/\s/.test(char)) {
        flushLatin();
        tokens.push({ text: char, breakable: true, space: true });
      } else if (isCJK(char)) {
        flushLatin();
        tokens.push({ text: char, breakable: true });
      } else if (/[A-Za-z0-9.,%+\-:/'&]/.test(char) && latinRun) {
        latinRun += char;
      } else if (/[A-Za-z0-9]/.test(char)) {
        latinRun = char;
      } else {
        flushLatin();
        tokens.push({ text: char, breakable: true });
      }
    }
    flushLatin();
    return tokens;
  }

  /* Greedy wrapping of one logical line. Existing line breaks supplied
   * by the user are honored by wrapText below. The detailed variant also
   * records whether a line began at a (dropped) space break, which lets
   * hard-wrapped exports be joined back together losslessly. */
  function wrapLineMeta(line, maxWidth, measure) {
    const measureFn = measure || defaultMeasure;
    const tokens = tokenize(line);
    const lines = [];
    let current = '';
    let currentWidth = 0;
    let pendingSpace = false;

    const pushLine = () => {
      lines.push({ text: current, leadingSpace: pendingSpace });
      current = '';
      currentWidth = 0;
      pendingSpace = false;
    };

    for (const token of tokens) {
      const tokenWidth = textWidth(token.text, measureFn);

      /* A token wider than the whole track is hard-broken character by
       * character so content can never overflow the configured width. */
      if (tokenWidth > maxWidth && !token.breakable) {
        for (const char of token.text) {
          const charWidth = measureFn(char);
          if (currentWidth + charWidth > maxWidth && current) pushLine();
          current += char;
          currentWidth += charWidth;
        }
        continue;
      }

      if (currentWidth + tokenWidth > maxWidth && current) {
        if (token.space) {
          pendingSpace = true;
          pushLine();
          continue;
        }
        pushLine();
      }
      if (token.space && !current) continue; // drop leading whitespace
      current += token.text;
      currentWidth += tokenWidth;
    }
    if (current) pushLine();
    return lines.length ? lines : [{ text: '', leadingSpace: false }];
  }

  function wrapLine(line, maxWidth, measure) {
    return wrapLineMeta(line, maxWidth, measure).map((item) => item.text);
  }

  /* Wrap text honoring manual line breaks. Returns an array of lines. */
  function wrapText(text, maxWidth, measure) {
    const paragraphs = String(text || '').split(/\r?\n/);
    return paragraphs.flatMap((paragraph) =>
      wrapLineMeta(paragraph, maxWidth, measure).map((item) => item.text)
    );
  }

  /* ------------------------------------------------------------------ */
  /* Cue model                                                          */
  /* ------------------------------------------------------------------ */

  const LAYOUTS = Object.freeze({
    STACKED: 'stacked', // zh above en, common for bilingual subtitles
    SIDE_BY_SIDE: 'side-by-side',
  });

  let cueSequence = 0;

  function createCue(partial) {
    const data = partial || {};
    return {
      id:
        data.id != null
          ? data.id
          : 'cue-' + String(++cueSequence).padStart(4, '0'),
      startMs: Number(data.startMs) || 0,
      endMs: Number(data.endMs) || 0,
      zh: data.zh || '',
      en: data.en || '',
      maxWidthPx: Number(data.maxWidthPx) || 320,
      wrap: data.wrap !== false,
      layout:
        data.layout === LAYOUTS.STACKED ||
        data.layout === LAYOUTS.SIDE_BY_SIDE
          ? data.layout
          : LAYOUTS.STACKED,
    };
  }

  /* Render a cue into display lines for preview. Bilingual rows are
   * returned separately so the UI can lay them out either way. */
  function renderCue(cue, measure) {
    const measureFn = measure || defaultMeasure;
    const widthFor = (language) =>
      cue.layout === LAYOUTS.SIDE_BY_SIDE
        ? Math.max(40, Math.floor(cue.maxWidthPx / 2))
        : cue.maxWidthPx;
    const render = (text, language) => {
      if (!text) return [];
      if (cue.wrap === false) {
        return String(text).split(/\r?\n/);
      }
      return wrapText(text, widthFor(language), measureFn);
    };
    return {
      zh: render(cue.zh, 'zh'),
      en: render(cue.en, 'en'),
    };
  }

  /* ------------------------------------------------------------------ */
  /* Validation: overlaps and out-of-bounds block export.               */
  /* ------------------------------------------------------------------ */

  /* tolerance absorbs rounding when two cues are adjacent (end == start) */
  function validateCues(cues, options) {
    const opts = options || {};
    const toleranceMs = opts.toleranceMs != null ? opts.toleranceMs : 1;
    const timelineDurationMs = opts.durationMs;
    const issues = [];

    cues.forEach((cue, index) => {
      if (!(cue.endMs > cue.startMs)) {
        issues.push({
          level: 'error',
          code: 'BAD_RANGE',
          cueIndex: index,
          cueId: cue.id,
          message:
            'Cue ' + (index + 1) + ': end time must be after start time',
        });
      }
      if (cue.startMs < 0) {
        issues.push({
          level: 'error',
          code: 'OUT_OF_BOUNDS',
          cueIndex: index,
          cueId: cue.id,
          message: 'Cue ' + (index + 1) + ': starts before 00:00:00.000',
        });
      }
      if (
        timelineDurationMs != null &&
        cue.endMs > timelineDurationMs + toleranceMs
      ) {
        issues.push({
          level: 'error',
          code: 'OUT_OF_BOUNDS',
          cueIndex: index,
          cueId: cue.id,
          message:
            'Cue ' +
            (index + 1) +
            ': ends at ' +
            formatTimestamp(cue.endMs) +
            ' beyond timeline duration ' +
            formatTimestamp(timelineDurationMs),
        });
      }
      if (cue.maxWidthPx <= 0) {
        issues.push({
          level: 'error',
          code: 'BAD_WIDTH',
          cueIndex: index,
          cueId: cue.id,
          message: 'Cue ' + (index + 1) + ': max width must be positive',
        });
      }
      if (!cue.zh.trim() && !cue.en.trim()) {
        issues.push({
          level: 'warning',
          code: 'EMPTY_CUE',
          cueIndex: index,
          cueId: cue.id,
          message: 'Cue ' + (index + 1) + ': no text in either language',
        });
      }
    });

    const sorted = cues
      .map((cue, index) => ({ cue, index }))
      .sort((a, b) => a.cue.startMs - b.cue.startMs);
    for (let i = 1; i < sorted.length; i += 1) {
      const previous = sorted[i - 1].cue;
      const current = sorted[i].cue;
      if (current.startMs < previous.endMs - toleranceMs) {
        issues.push({
          level: 'error',
          code: 'OVERLAP',
          cueIndex: sorted[i].index,
          cueId: current.id,
          otherCueId: previous.id,
          message:
            'Cue ' +
            (sorted[i].index + 1) +
            ' overlaps cue ' +
            (sorted[i - 1].index + 1) +
            ' at ' +
            formatTimestamp(current.startMs),
        });
      }
    }

    return {
      issues,
      errors: issues.filter((issue) => issue.level === 'error'),
      warnings: issues.filter((issue) => issue.level === 'warning'),
      canExport: !issues.some((issue) => issue.level === 'error'),
    };
  }

  return {
    Clock,
    LAYOUTS,
    createCue,
    defaultMeasure,
    formatTimestamp,
    isCJK,
    parseTimestamp,
    renderCue,
    textWidth,
    tokenize,
    validateCues,
    wrapLine,
    wrapLineMeta,
    wrapText,
  };
});

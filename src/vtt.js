/*
 * WebVTT export / import for bilingual cues.
 *
 * Exported cues use language markers so both languages survive a round
 * trip through any standard WebVTT parser:
 *
 *   cue-1
 *   00:00:01.000 --> 00:00:03.500
 *   [zh] 你好世界
 *   [en] Hello world
 *
 * Per-cue editor settings (max width, wrapping, bilingual layout) travel
 * in NOTE blocks. Manual line breaks inside a language are encoded as
 * literal "\n" because a VTT payload cannot contain raw newlines.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./core.js'));
  } else {
    root.SubtitleVTT = factory(root.SubtitleCore);
  }
})(typeof self !== 'undefined' ? self : this, function (core) {
  'use strict';

  const NOTE_PREFIX = 'project:uid489-subtitle-editor';
  const NEWLINE_ENCODE = /\r?\n/g;
  const NEWLINE_DECODE = /\\n/g;

  function encodeText(text) {
    return String(text || '').replace(NEWLINE_ENCODE, '\\n');
  }

  function decodeText(text) {
    return String(text || '').replace(NEWLINE_DECODE, '\n');
  }

  function parseNote(noteLines) {
    const settings = {};
    for (const line of noteLines) {
      if (line.startsWith(NOTE_PREFIX)) continue;
      for (const token of line.split(/\s+/)) {
        const separator = token.indexOf(':');
        if (separator < 1) continue;
        settings[token.slice(0, separator)] = token.slice(separator + 1);
      }
    }
    return settings;
  }

  function exportVTT(cues, options) {
    const opts = options || {};
    const measure = opts.measure || core.defaultMeasure;
    const lines = ['WEBVTT - uid489 bilingual subtitle editor', ''];

    cues.forEach((cue, index) => {
      const wrapMode = cue.wrap === false ? 'off' : opts.hardWrap ? 'hard' : 'on';
      lines.push('NOTE');
      lines.push(NOTE_PREFIX);
      lines.push(
        'cue-index:' +
          (index + 1) +
          ' max-width:' +
          cue.maxWidthPx +
          ' wrap:' +
          wrapMode +
          ' layout:' +
          cue.layout
      );
      lines.push('');
      lines.push(cue.id);
      lines.push(
        core.formatTimestamp(cue.startMs) +
          ' --> ' +
          core.formatTimestamp(cue.endMs)
      );

      const emit = (marker, text) => {
        if (!text) return;
        if (opts.hardWrap && cue.wrap !== false) {
          const width =
            cue.layout === core.LAYOUTS.SIDE_BY_SIDE
              ? Math.max(40, Math.floor(cue.maxWidthPx / 2))
              : cue.maxWidthPx;
          const paragraphs = String(text).split(/\r?\n/);
          paragraphs.forEach((paragraph, paragraphIndex) => {
            if (paragraphIndex > 0) {
              // Encodes a real (user-authored) paragraph break.
              lines.push(marker + ' \\n');
            }
            const wrapped = core.wrapLineMeta(paragraph, width, measure);
            wrapped.forEach((item, lineIndex) => {
              const prefix = lineIndex > 0 && item.leadingSpace ? ' ' : '';
              lines.push(marker + ' ' + prefix + item.text);
            });
          });
        } else {
          lines.push(marker + ' ' + encodeText(text));
        }
      };
      emit('[zh]', cue.zh);
      emit('[en]', cue.en);
      lines.push('');
    });

    return lines.join('\n');
  }

  function parseTimingLine(line) {
    const match = line.match(
      /^(.+?)\s+-->\s+(.+?)(?:\s+.+)?$/
    );
    if (!match) {
      throw new Error('invalid cue timing line: ' + line);
    }
    return {
      startMs: core.parseTimestamp(match[1]),
      endMs: core.parseTimestamp(match[2]),
    };
  }

  function importVTT(content) {
    const text = String(content || '').replace(/^﻿/, '');
    const rawLines = text.split(/\r?\n/);
    if (!rawLines[0] || !rawLines[0].startsWith('WEBVTT')) {
      throw new Error('not a WebVTT file: missing WEBVTT header');
    }

    const blocks = [];
    let block = [];
    for (const line of rawLines.slice(1)) {
      if (line.trim() === '') {
        if (block.length) blocks.push(block);
        block = [];
      } else {
        block.push(line);
      }
    }
    if (block.length) blocks.push(block);

    const cues = [];
    const warnings = [];
    let pendingNote = null;

    for (const blockLines of blocks) {
      if (blockLines[0] === 'NOTE') {
        pendingNote = parseNote(blockLines.slice(1));
        continue;
      }

      let cursor = 0;
      let identifier = null;
      if (!blockLines[0].includes('-->')) {
        identifier = blockLines[0];
        cursor = 1;
      }
      const timing = parseTimingLine(blockLines[cursor]);
      cursor += 1;

      const marked = { zh: [], en: [] };
      const unmarked = [];
      for (const payloadLine of blockLines.slice(cursor)) {
        const zhMatch = payloadLine.match(/^\[zh\]\s?(.*)$/);
        const enMatch = payloadLine.match(/^\[en\]\s?(.*)$/);
        if (zhMatch) marked.zh.push(zhMatch[1]);
        else if (enMatch) marked.en.push(enMatch[1]);
        else unmarked.push(payloadLine);
      }

      const note = pendingNote || {};
      pendingNote = null;

      /* Rebuild logical text. In hard-wrap mode each VTT line is one
       * visual line; lines starting with a space were broken at a word
       * boundary and join with that space, while '\\n' lines encode real
       * paragraph breaks. In normal mode text was newline-encoded. */
      const buildText = (rawLines) => {
        if (note.wrap !== 'hard') {
          return rawLines.map(decodeText).join('\n');
        }
        let out = '';
        for (const raw of rawLines) {
          if (raw === '\\n') {
            out += '\n';
          } else {
            // Leading space marks a word break; CJK breaks carry no
            // whitespace and simply concatenate.
            out += raw;
          }
        }
        return out;
      };

      let zh = buildText(marked.zh);
      let en = buildText(marked.en);
      if (!zh && !en && unmarked.length) {
        warnings.push(
          'Cue ' +
            (cues.length + 1) +
            ': no [zh]/[en] markers, unmarked text imported as English'
        );
        en = unmarked.join('\n');
      }

      const partial = {
        id: identifier || undefined,
        startMs: timing.startMs,
        endMs: timing.endMs,
        zh,
        en,
      };
      if (note['max-width']) partial.maxWidthPx = Number(note['max-width']);
      if (note.layout === core.LAYOUTS.SIDE_BY_SIDE) {
        partial.layout = core.LAYOUTS.SIDE_BY_SIDE;
      }
      if (note.wrap === 'off') partial.wrap = false;
      cues.push(core.createCue(partial));
    }

    return { cues, warnings };
  }

  return { exportVTT, importVTT, parseTimingLine };
});

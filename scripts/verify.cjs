#!/usr/bin node
/*
 * End-to-end verification driven from Node (no browser required):
 *   1. build three bilingual zh/en cues with mixed CJK/Latin/digit text
 *   2. exercise width/wrapping and bilingual layout
 *   3. export WebVTT and re-import, proving a lossless round trip
 *   4. prove language edits stay isolated
 *   5. prove the playhead and audio share one clock
 *   6. prove overlaps / out-of-bounds cues block export
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const core = require('../src/core.js');
const vtt = require('../src/vtt.js');
const storage = require('../src/storage.js');

const ARTIFACT_DIR = path.join(__dirname, '..', 'artifacts');
const results = [];

function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition), detail: detail || '' });
  const tag = condition ? 'PASS' : 'FAIL';
  console.log(`[${tag}] ${name}${detail ? ' - ' + detail : ''}`);
}

function assertEqual(actual, expected, name) {
  check(
    name,
    JSON.stringify(actual) === JSON.stringify(expected),
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
  );
}

fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

/* ------------------------------------------------------------------ */
/* 1. The three required bilingual cues (timeline = 12 s)             */
/* ------------------------------------------------------------------ */

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

check('three cues created', project.cues.length === 3);
check(
  'all cues are bilingual',
  project.cues.every((cue) => cue.zh.trim() && cue.en.trim())
);

/* ------------------------------------------------------------------ */
/* 2. Mixed-script width measurement and wrapping                      */
/* ------------------------------------------------------------------ */

check(
  'CJK detected as full-width breakable unit',
  core.isCJK('字') && !core.isCJK('A') && !core.isCJK('7')
);

const tokens = core.tokenize('AI 字幕1080P');
check(
  'digit/Latin run stays atomic while CJK breaks per character',
  tokens.some((token) => token.text === 'AI') &&
    tokens.some((token) => token.text === '1080P' && !token.breakable) &&
    tokens.some((token) => token.text === '字' && token.breakable)
);

const wideCue = project.cues[0];
const rendered = core.renderCue(wideCue);
check(
  'long mixed line wraps inside maxWidthPx',
  rendered.zh.length > 1 &&
    rendered.zh.every(
      (line) => core.textWidth(line) <= wideCue.maxWidthPx
    )
);

const sideBySide = core.renderCue(project.cues[1]);
const halfWidth = Math.floor(project.cues[1].maxWidthPx / 2);
check(
  'side-by-side layout measures each language against half width',
  sideBySide.zh.every(
    (line) => core.textWidth(line) <= halfWidth
  ) &&
    sideBySide.en.every(
      (line) => core.textWidth(line) <= halfWidth
    )
);

const narrowSide = core.renderCue(
  core.createCue({
    ...project.cues[1],
    maxWidthPx: 160,
  })
);
check(
  'narrow side-by-side track wraps each language into multiple lines',
  narrowSide.zh.length > 1 &&
    narrowSide.zh.every((line) => core.textWidth(line) <= 80)
);

const nowrap = core.renderCue(
  core.createCue({
    ...project.cues[0],
    wrap: false,
  })
);
check(
  'wrap disabled keeps the manual line structure',
  nowrap.zh.length === String(wideCue.zh).split('\n').length
);

/* ------------------------------------------------------------------ */
/* 3. WebVTT export + re-import round trip                             */
/* ------------------------------------------------------------------ */

const validationBefore = core.validateCues(project.cues, {
  durationMs: project.durationMs,
});
check('clean project passes validation', validationBefore.canExport);

const vttText = vtt.exportVTT(project.cues);
const vttPath = path.join(ARTIFACT_DIR, 'subtitles.vtt');
fs.writeFileSync(vttPath, vttText, 'utf8');
check('WebVTT header present', vttText.startsWith('WEBVTT'));
check(
  'both language markers exported',
  (vttText.match(/\[zh\]/g) || []).length === 3 &&
    (vttText.match(/\[en\]/g) || []).length === 3
);

const reimported = vtt.importVTT(vttText);
assertEqual(reimported.warnings, [], 'import reports no warnings');
assertEqual(
  reimported.cues.map((cue) => cue.startMs),
  project.cues.map((cue) => cue.startMs),
  'start times survive round trip'
);
assertEqual(
  reimported.cues.map((cue) => cue.endMs),
  project.cues.map((cue) => cue.endMs),
  'end times survive round trip'
);
assertEqual(
  reimported.cues.map((cue) => cue.zh),
  project.cues.map((cue) => cue.zh),
  'Chinese text survives round trip'
);
assertEqual(
  reimported.cues.map((cue) => cue.en),
  project.cues.map((cue) => cue.en),
  'English text survives round trip'
);
assertEqual(
  reimported.cues.map((cue) => cue.maxWidthPx),
  project.cues.map((cue) => cue.maxWidthPx),
  'max width settings survive round trip'
);
assertEqual(
  reimported.cues.map((cue) => cue.layout),
  project.cues.map((cue) => cue.layout),
  'bilingual layouts survive round trip'
);

const reparsed = storage.parseProject(
  storage.serializeProject({ ...project, cues: reimported.cues })
);
const reexported = vtt.exportVTT(reparsed.cues);
check(
  're-exported VTT is byte-identical (idempotent)',
  reexported === vttText
);

/* Hard-wrapped export still re-imports to the same logical text. */
const hardWrapped = vtt.exportVTT(project.cues, { hardWrap: true });
fs.writeFileSync(
  path.join(ARTIFACT_DIR, 'subtitles-hardwrap.vtt'),
  hardWrapped,
  'utf8'
);
const hardImport = vtt.importVTT(hardWrapped);
assertEqual(
  hardImport.cues.map((cue) => cue.zh),
  project.cues.map((cue) => cue.zh),
  'hard-wrapped Chinese rejoins into original text'
);
assertEqual(
  hardImport.cues.map((cue) => cue.en),
  project.cues.map((cue) => cue.en),
  'hard-wrapped English rejoins into original text'
);

/* Manual paragraph breaks must survive hard wrapping as well. */
const manualBreakCue = core.createCue({
  startMs: 0,
  endMs: 1000,
  zh: '第一段很长的中文内容需要被自动折行处理\n第二段手动另起一行',
  en: 'First long English line that must wrap on its own\nSecond paragraph',
  maxWidthPx: 120,
  wrap: true,
  layout: core.LAYOUTS.STACKED,
});
const manualVTT = vtt.exportVTT([manualBreakCue], { hardWrap: true });
const manualImport = vtt.importVTT(manualVTT);
assertEqual(
  [manualImport.cues[0].zh],
  [manualBreakCue.zh],
  'manual Chinese paragraph break survives hard-wrap round trip'
);
assertEqual(
  [manualImport.cues[0].en],
  [manualBreakCue.en],
  'manual English paragraph break survives hard-wrap round trip'
);

/* ------------------------------------------------------------------ */
/* 4. Editing one language never clears the other                      */
/* ------------------------------------------------------------------ */

const isolated = storage.createProject({
  cues: [
    { id: 'only-zh', startMs: 0, endMs: 1000, zh: '中文', en: '' },
  ],
});
storage.updateCueText(isolated, 'only-zh', 'en', 'English added later');
assertEqual(
  isolated.cues[0].zh,
  '中文',
  'adding English leaves Chinese untouched'
);
storage.updateCueText(isolated, 'only-zh', 'zh', '中文修改');
assertEqual(
  isolated.cues[0].en,
  'English added later',
  'editing Chinese leaves English untouched'
);

const bilingualCopy = storage.parseProject(
  storage.serializeProject(project)
);
bilingualCopy.cues.forEach((cue) =>
  storage.updateCueText(bilingualCopy, cue.id, 'zh', cue.zh + '【改】')
);
check(
  'batch Chinese edits preserve all English content',
  bilingualCopy.cues.every(
    (cue, index) => cue.en === project.cues[index].en
  )
);

/* ------------------------------------------------------------------ */
/* 5. Playhead and audio share a single clock                          */
/* ------------------------------------------------------------------ */

class FakeAudio {
  constructor(durationSeconds) {
    this.currentTime = 0;
    this.duration = durationSeconds;
    this.paused = true;
    this._listeners = new Map();
  }
  addEventListener(type, fn) {
    if (!this._listeners.has(type)) this._listeners.set(type, new Set());
    this._listeners.get(type).add(fn);
  }
  removeEventListener(type, fn) {
    this._listeners.get(type)?.delete(fn);
  }
  dispatch(type) {
    this._listeners.get(type)?.forEach((fn) => fn());
  }
  async play() {
    this.paused = false;
  }
  pause() {
    this.paused = true;
  }
}

const fakeAudio = new FakeAudio(12);
const clock = new core.Clock().attachAudio(fakeAudio);
let lastTick = null;
clock.subscribe((timeMs, playing) => {
  lastTick = { timeMs, playing };
});

fakeAudio.currentTime = 2.5;
fakeAudio.dispatch('timeupdate');
check(
  'playhead reads audio currentTime (single clock source)',
  clock.timeMs === 2500 && lastTick.timeMs === 2500
);

clock.seek(6000);
check(
  'seek writes through to the audio element',
  fakeAudio.currentTime === 6 && clock.timeMs === 6000
);

clock.play().then(() => {
  check('play propagates to audio', fakeAudio.paused === false && clock.isPlaying);
  clock.pause();
  check('pause propagates to audio', fakeAudio.paused === true && !clock.isPlaying);
});

const standalone = new core.Clock();
standalone.seek(1500);
check(
  'clock without audio still drives the playhead deterministically',
  standalone.timeMs === 1500
);

/* ------------------------------------------------------------------ */
/* 6. Overlap and out-of-bounds cues block export                      */
/* ------------------------------------------------------------------ */

const overlapping = storage.createProject({
  durationMs: 12000,
  cues: [
    core.createCue({ id: 'a', startMs: 1000, endMs: 4000, zh: '甲', en: 'A' }),
    core.createCue({ id: 'b', startMs: 3000, endMs: 5000, zh: '乙', en: 'B' }),
  ],
});
const overlapReport = core.validateCues(overlapping.cues, {
  durationMs: overlapping.durationMs,
});
check(
  'overlap detected and export blocked',
  !overlapReport.canExport &&
    overlapReport.errors.some((issue) => issue.code === 'OVERLAP')
);

const outOfBounds = storage.createProject({
  durationMs: 12000,
  cues: [
    core.createCue({ id: 'c', startMs: 11000, endMs: 13000, zh: '尾', en: 'end' }),
  ],
});
const boundsReport = core.validateCues(outOfBounds.cues, {
  durationMs: outOfBounds.durationMs,
});
check(
  'cue past timeline duration blocks export',
  !boundsReport.canExport &&
    boundsReport.errors.some((issue) => issue.code === 'OUT_OF_BOUNDS')
);

const reversed = storage.createProject({
  cues: [
    core.createCue({ id: 'd', startMs: 5000, endMs: 4000, zh: '反', en: 'rev' }),
  ],
});
const reversedReport = core.validateCues(reversed.cues);
check(
  'reversed start/end blocks export',
  !reversedReport.canExport &&
    reversedReport.errors.some((issue) => issue.code === 'BAD_RANGE')
);

const adjacent = storage.createProject({
  durationMs: 12000,
  cues: [
    core.createCue({ id: 'e', startMs: 0, endMs: 1000, zh: '一', en: 'one' }),
    core.createCue({ id: 'f', startMs: 1000, endMs: 2000, zh: '二', en: 'two' }),
  ],
});
check(
  'adjacent (non-overlapping) cues are allowed',
  core.validateCues(adjacent.cues, { durationMs: 12000 }).canExport
);

const emptyWarning = core.validateCues([
  core.createCue({ startMs: 0, endMs: 1000 }),
]);
check(
  'empty bilingual cue warns but does not block export',
  emptyWarning.canExport &&
    emptyWarning.warnings.some((issue) => issue.code === 'EMPTY_CUE')
);

/* VTT import of a foreign (marker-less) file still loads safely. */
const foreign = vtt.importVTT(
  'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nplain subtitle line\n'
);
check(
  'marker-less VTT imported as English with a warning',
  foreign.cues.length === 1 &&
    foreign.cues[0].en === 'plain subtitle line' &&
    foreign.warnings.length === 1
);

/* Real workflow: read the VTT file back from disk and verify. */
const fromDisk = vtt.importVTT(fs.readFileSync(vttPath, 'utf8'));
check('disk re-import yields three cues', fromDisk.cues.length === 3);
check(
  'disk re-import preserves every Chinese/English pair',
  fromDisk.cues.every(
    (cue, index) =>
      cue.zh === project.cues[index].zh &&
      cue.en === project.cues[index].en &&
      cue.startMs === project.cues[index].startMs &&
      cue.endMs === project.cues[index].endMs &&
      cue.maxWidthPx === project.cues[index].maxWidthPx &&
      cue.layout === project.cues[index].layout &&
      cue.wrap === project.cues[index].wrap
  )
);
const diskProject = storage.parseProject(
  storage.serializeProject({ ...project, cues: fromDisk.cues })
);
check(
  'disk round trip passes validation again',
  core.validateCues(diskProject.cues, {
    durationMs: diskProject.durationMs,
  }).canExport
);

/* ------------------------------------------------------------------ */
/* Summary and artifact write                                          */
/* ------------------------------------------------------------------ */

setTimeout(() => {
  const failed = results.filter((result) => !result.ok);
  const report = {
    at: new Date().toISOString(),
    total: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    checks: results,
    artifacts: ['subtitles.vtt', 'subtitles-hardwrap.vtt', 'verification-report.json'],
  };
  fs.writeFileSync(
    path.join(ARTIFACT_DIR, 'verification-report.json'),
    JSON.stringify(report, null, 2),
    'utf8'
  );
  console.log(
    `\n${report.passed}/${report.total} checks passed` +
      (failed.length ? `, ${failed.length} FAILED` : '')
  );
  process.exit(failed.length ? 1 : 0);
}, 50);

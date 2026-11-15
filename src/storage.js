/*
 * Project model. The text update path is intentionally field-scoped:
 * editing one language can never clear or mutate the other language.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./core.js'));
  } else {
    root.SubtitleStorage = factory(root.SubtitleCore);
  }
})(typeof self !== 'undefined' ? self : this, function (core) {
  'use strict';

  function createProject(partial) {
    const data = partial || {};
    return {
      name: data.name || 'Untitled project',
      durationMs: data.durationMs != null ? Number(data.durationMs) : null,
      cues: (data.cues || []).map(core.createCue),
    };
  }

  function findCueIndex(project, cueId) {
    return project.cues.findIndex((cue) => cue.id === cueId);
  }

  function addCue(project, partial) {
    const cue = core.createCue(partial);
    project.cues.push(cue);
    sortCues(project);
    return cue;
  }

  function removeCue(project, cueId) {
    const index = findCueIndex(project, cueId);
    if (index >= 0) project.cues.splice(index, 1);
    return index >= 0;
  }

  function updateCue(project, cueId, patch) {
    const cue = project.cues[findCueIndex(project, cueId)];
    if (!cue) return null;
    Object.assign(cue, patch);
    return cue;
  }

  /* Update zh or en only. The sibling language field is never read or
   * written, so switching language tabs cannot erase existing content. */
  function updateCueText(project, cueId, language, text) {
    if (language !== 'zh' && language !== 'en') {
      throw new Error('language must be "zh" or "en"');
    }
    const cue = project.cues[findCueIndex(project, cueId)];
    if (!cue) return null;
    cue[language] = text;
    return cue;
  }

  function sortCues(project) {
    project.cues.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
    return project.cues;
  }

  function serializeProject(project) {
    return JSON.stringify(
      {
        format: 'uid489-subtitle-project',
        version: 1,
        name: project.name,
        durationMs: project.durationMs,
        cues: project.cues,
      },
      null,
      2
    );
  }

  function parseProject(json) {
    const data = typeof json === 'string' ? JSON.parse(json) : json;
    if (!data || !Array.isArray(data.cues)) {
      throw new Error('invalid project file: cues missing');
    }
    return createProject({
      name: data.name,
      durationMs: data.durationMs,
      cues: data.cues,
    });
  }

  return {
    addCue,
    createProject,
    findCueIndex,
    parseProject,
    removeCue,
    serializeProject,
    sortCues,
    updateCue,
    updateCueText,
  };
});

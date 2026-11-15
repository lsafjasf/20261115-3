// Mixed CJK/Latin text layout along a curve.
// Pure module: depends only on a `measure` interface, testable in Node.

const CJK_RE =
  /[　-〿぀-ヿ㐀-䶿一-鿿豈-﫿가-힯]/;
// Punctuation that must not start a line (kinsoku gyocho kinshi).
const NO_LINE_START = new Set(
  '，。！？；：、）》」』】〉》…—·％‰'.split('')
);
// Punctuation that must not end a line.
const NO_LINE_END = new Set('（《「『【〈'.split(''));

export function isCJK(ch) {
  return CJK_RE.test(ch);
}

// Tokenize into breakable units.
// - CJK chars and CJK punctuation: one token per char (break anywhere,
//   subject to kinsoku rules).
// - Latin/digit runs: one token per word (break only at spaces).
// - Spaces: break opportunities, zero-width at line start.
export function tokenize(text) {
  const tokens = [];
  let word = '';
  const flushWord = () => {
    if (word) {
      tokens.push({ text: word, kind: 'word' });
      word = '';
    }
  };
  for (const ch of text) {
    if (ch === '\n') {
      flushWord();
      tokens.push({ text: ch, kind: 'newline' });
    } else if (ch === ' ' || ch === '\t') {
      flushWord();
      tokens.push({ text: ' ', kind: 'space' });
    } else if (isCJK(ch)) {
      flushWord();
      tokens.push({ text: ch, kind: 'cjk' });
    } else {
      word += ch;
    }
  }
  flushWord();
  return tokens;
}

// Greedy line breaking. `widthOf(token)` returns advance width in px.
// Returns array of lines; each line is an array of tokens.
// `overflow` collects tokens that did not fit within maxLines.
export function breakLines(tokens, widthOf, lineWidth, maxLines) {
  const lines = [];
  let current = [];
  let currentWidth = 0;
  const overflow = [];

  const pushLine = () => {
    // trim trailing spaces
    while (current.length && current[current.length - 1].kind === 'space') current.pop();
    if (lines.length >= maxLines) {
      overflow.push(...current);
    } else if (current.length) {
    lines.push(current);
    }
    current = [];
    currentWidth = 0;
  };

  for (const tok of tokens) {
    if (tok.kind === 'newline') {
      pushLine();
      continue;
    }
    const w = widthOf(tok);
    if (tok.kind === 'space' && current.length === 0) continue;
    if (current.length && currentWidth + w > lineWidth) {
      // Kinsoku: don't break before NO_LINE_START / after NO_LINE_END.
      const last = current[current.length - 1];
      const firstChar = tok.text[0];
      if (
        tok.kind === 'cjk' &&
        last.kind === 'cjk' &&
        (NO_LINE_START.has(firstChar) || NO_LINE_END.has(last.text[0]))
      ) {
        // Pull the previous char onto the next line instead.
        const pulled = current.pop();
        currentWidth -= widthOf(pulled);
        pushLine();
        current.push(pulled);
        currentWidth += widthOf(pulled);
      } else {
        pushLine();
        if (tok.kind === 'space') continue;
      }
    }
    current.push(tok);
    currentWidth += w;
  }
  if (current.length) pushLine();
  return { lines, overflow };
}

const RAD = 180 / Math.PI;

function normAngle(deg) {
  let a = deg % 360;
  if (a > 180) a -= 360;
  if (a < -180) a += 360;
  return a;
}

// Place one line of tokens along `curve` (an ArcLengthCurve).
//
// Bend protection:
// - Tangent is smoothed over a window >= glyph width, so a sharp kink
//   cannot flip a single glyph.
// - Per-glyph rotation is clamped to `maxTurnPerGlyph`; excess curvature
//   is absorbed as extra advance instead of letting the glyph flip.
// - Chord distance between consecutive glyph centers is enforced to be
//   >= minChordRatio * advance, so spacing can never collapse at bends.
//
// Returns { glyphs, stats }. Each glyph: { ch, x, y, angle, advance }.
export function layoutLineOnCurve(tokens, curve, opts) {
  const {
    glyphAdvance, // (ch) => advance width in px (including letterSpacing)
    letterSpacing = 0,
    baselineOffset = 0, // px along the curve normal (positive = outward/left)
    align = 'left', // 'left' | 'center'
    maxTurnPerGlyph = 32, // degrees
    minChordRatio = 0.55,
  } = opts;

  const glyphs = [];
  for (const tok of tokens) {
    if (tok.kind === 'newline') continue;
    for (const ch of tok.text) {
      const adv = glyphAdvance(ch);
      if (ch === ' ') {
        if (adv > 0) glyphs.push({ ch, advance: adv, isSpace: true });
      } else if (adv > 0) {
        glyphs.push({ ch, advance: adv });
      }
    }
  }
  const total = glyphs.reduce((s, g) => s + g.advance, 0) +
    (glyphs.length > 1 ? letterSpacing * (glyphs.length - 1) : 0);

  let s = align === 'center' ? Math.max(0, (curve.length - total) / 2) : 0;
  let prevAngle = null;
  let prevPos = null;
  const stats = { clampedTurns: 0, spacingBoosts: 0, dropped: 0, endS: 0, fits: true };

  for (const g of glyphs) {
    if (g.isSpace) { // spaces consume advance but render nothing
      s += g.advance + letterSpacing;
      continue;
    }
    const half = g.advance / 2;
    let centerS = s + half;

    // Enforce minimum chord distance from previous glyph center.
    if (prevPos) {
      for (let iter = 0; iter < 24; iter++) {
        const p = curve.at(centerS, g.advance);
        const chord = Math.hypot(p.x - prevPos.x, p.y - prevPos.y);
        const need = minChordRatio * (g.advance + (prevPos.advance || g.advance)) / 2;
        if (chord >= need || centerS >= curve.length) break;
        centerS += (need - chord);
        stats.spacingBoosts++;
      }
    }

    // Beyond the curve end: leave the glyph unplaced (dropped) rather
    // than piling it onto the endpoint (which would collapse spacing).
    if (centerS + half > curve.length + 0.5) {
      stats.dropped++;
      stats.fits = false;
      s = centerS + half + letterSpacing;
      continue;
    }

    const p = curve.at(centerS, Math.max(g.advance, 6));
    let angle = Math.atan2(p.ty, p.tx) * RAD;
    if (prevAngle !== null) {
      const delta = normAngle(angle - prevAngle);
      if (Math.abs(delta) > maxTurnPerGlyph) {
        angle = prevAngle + Math.sign(delta) * maxTurnPerGlyph;
        stats.clampedTurns++;
      }
      angle = normAngle(angle);
    }

    // Baseline offset along the normal (left of travel direction).
    const rad = angle / RAD;
    const nx = -Math.sin(rad);
    const ny = Math.cos(rad);
    const x = p.x + nx * baselineOffset;
    const y = p.y + ny * baselineOffset;

    g.x = x;
    g.y = y;
    g.angle = angle;
    prevAngle = angle;
    prevPos = { x: p.x, y: p.y, advance: g.advance };
    s = centerS + half + letterSpacing;
  }

  stats.endS = s - letterSpacing;
  stats.fits = stats.endS <= curve.length + 0.5;
  return { glyphs, stats, total };
}

// Full pipeline: tokenize -> break lines -> place each line on the curve
// (line i is offset by i * lineHeight along the normal).
//
// fontAdapter: { advance(ch, fontSize) -> px }
// Returns { lines: [{glyphs, stats}], overflow, curveLength, maxLines }.
export function layoutTitle(text, curve, fontAdapter, opts) {
  const {
    fontSize = 48,
    letterSpacing = 0,
    baselineOffset = 0,
    align = 'center',
    maxLines = 3,
    lineHeightFactor = 1.35,
  } = opts;

  const spacingPx = letterSpacing;
  const advanceOf = (ch) =>
    ch === ' ' ? fontAdapter.advance(' ', fontSize) + spacingPx
               : fontAdapter.advance(ch, fontSize) + spacingPx;
  const widthOfToken = (tok) =>
    tok.kind === 'space'
      ? advanceOf(' ')
      : [...tok.text].reduce((sum, ch) => sum + advanceOf(ch), 0);

  const tokens = tokenize(text);
  const { lines, overflow } = breakLines(
    tokens,
    widthOfToken,
    curve.length,
    maxLines
  );

  const lineHeight = fontSize * lineHeightFactor;
  const placed = lines.map((lineTokens, i) => {
    const lineCurve = i === 0 ? curve : curve.offset(i * lineHeight);
    return layoutLineOnCurve(lineTokens, lineCurve, {
      glyphAdvance: advanceOf,
      letterSpacing: 0, // already folded into advanceOf
      baselineOffset,
      align,
      maxTurnPerGlyph: opts.maxTurnPerGlyph,
      minChordRatio: opts.minChordRatio,
    });
  });

  return {
    lines: placed,
    overflow,
    curveLength: curve.length,
    maxLines,
    lineHeight,
  };
}

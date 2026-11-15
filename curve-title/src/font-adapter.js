// Adapter around an opentype.js Font object (works in browser and Node).
export function makeFontAdapter(font) {
  const cache = new Map();
  return {
    font,
    advance(ch, fontSize) {
      const key = ch + '@' + fontSize;
      let w = cache.get(key);
      if (w === undefined) {
        w = font.getAdvanceWidth(ch, fontSize);
        cache.set(key, w);
      }
      return w;
    },
    // Outline path (opentype Path object) for a glyph at origin, y-up.
    glyphPath(ch, x, y, fontSize) {
      return font.getPath(ch, x, y, fontSize);
    },
    ascender(fontSize) {
      return (font.ascender / font.unitsPerEm) * fontSize;
    },
  };
}

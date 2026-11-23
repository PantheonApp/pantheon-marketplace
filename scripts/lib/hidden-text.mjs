/**
 * What hides or reorders the text the person reads, the characters the app refuses in a connection type: bidi controls,
 * a zero width space or word joiner on its own, control characters other than \n and \t, and the tag characters, which
 * no screen shows. ZWJ, ZWNJ and the soft hyphen compose emoji and words, and pass.
 */
export const HIDES_TEXT = /[؜‎‏‪-‮⁦-⁩​⁠﻿\u0000-\u0008\u000B-\u001F\u007F-\u009F\u{E0000}-\u{E007F}]/u;

/** The error for a text with such a character, or none. */
export function hiddenText(value, at) {
  const found = typeof value === "string" ? HIDES_TEXT.exec(value) : null;
  if (found === null) return [];
  const code = found[0].codePointAt(0).toString(16).toUpperCase().padStart(4, "0");
  return [{ field: at, message: `has the invisible or control character U+${code}, which hides or reorders what the person reads` }];
}

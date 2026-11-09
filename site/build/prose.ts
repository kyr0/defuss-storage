// The site's prose rules, shared by the build (over the strings table) and the
// e2e suite (over the rendered page text in both languages).

/**
 * Characters the copy must not use. Dashes, typographic quotes, ellipses,
 * arrows, bullets and middle dots are typical of generated text; the site uses
 * commas, colons, plain quotes and full sentences instead. Unit and key glyphs
 * stay allowed: µs, the macOS command key, umlauts.
 */
export const FORBIDDEN_CHARACTERS = /[‒-―‘-‟•…·←-⇿✓-✗✨⭐]/u;

/** Words that promise instead of inform. Matched case-insensitively as whole words. */
export const FORBIDDEN_WORDS = [
  'seamless', 'seamlessly', 'blazing', 'blazingly', 'revolutionary', 'unleash', 'empower', 'empowers', 'leverage',
  'cutting-edge', 'game-changer', 'game-changing', 'effortless', 'effortlessly', 'delve', 'supercharge', 'robust',
  'next-generation', 'world-class', 'best-in-class', 'unparalleled', 'state-of-the-art', 'magic', 'magical',
  'nahtlos', 'revolutionär', 'bahnbrechend', 'mühelos', 'blitzschnell', 'hochmodern', 'erstklassig',
];
const WORD_PATTERN = new RegExp(`(?<![\\p{L}-])(${FORBIDDEN_WORDS.join('|')})(?![\\p{L}-])`, 'iu');

/** Readable findings for one text: each forbidden character or word with its context. */
export function proseFindings(text: string, where: string): string[] {
  const findings: string[] = [];
  const character = FORBIDDEN_CHARACTERS.exec(text);
  if (character) findings.push(`${where}: character U+${character[0].codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')} in "${text.slice(Math.max(0, character.index - 30), character.index + 30)}"`);
  const word = WORD_PATTERN.exec(text);
  if (word) findings.push(`${where}: word "${word[1]}" in "${text.slice(Math.max(0, word.index - 30), word.index + 40)}"`);
  return findings;
}

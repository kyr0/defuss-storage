// Build-time localization: turns the page source into defuss-i18n markup.
//
// The source marks every translatable text with an empty placeholder element,
// `<h2 data-t="how.title"></h2>`, and every translatable attribute with
// `data-ta="aria-label:key;title:key"`. One strings table holds English and
// German side by side, so a missing translation fails the build instead of
// shipping. Why generate instead of hand-writing the templates: each string
// would otherwise appear three times in the markup (visible text plus one
// template per locale) and drift.

import { TRANSLATABLE_ATTRIBUTES } from 'defuss-i18n/core';

export type Locale = 'en' | 'de';
export const LOCALES: readonly Locale[] = ['en', 'de'];
export type Strings = Readonly<Record<string, Readonly<Record<Locale, string>>>>;

const escapeAttribute = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

const ATTRIBUTE_PLACEHOLDER = /<([a-z][a-z0-9-]*)([^>]*?)\sdata-ta="([^"]*)"([^>]*)>/g;
const TEXT_PLACEHOLDER = /<([a-z][a-z0-9-]*)([^>]*?)\sdata-t="([^"]+)"([^>]*)><\/\1>/g;

function lookup(strings: Strings, key: string, used: Set<string>): Readonly<Record<Locale, string>> {
  const entry = strings[key];
  if (!entry) throw new Error(`i18n: no string for key "${key}"`);
  used.add(key);
  return entry;
}

/**
 * Renders the page source in `locale`: placeholders get that locale's text, and
 * each gets the defuss-i18n templates (text) or `data-i18n-{attr}-{locale}`
 * variants (attributes) for every locale, so the client can switch without a
 * reload. Keys found are added to `used`. VERIFIED: (test/build.test.ts) a
 * repeated key renders with distinct targets, and an attribute defuss-i18n
 * cannot translate fails the build. Throws on an unknown key, on an
 * attribute that is set twice, and on a placeholder that is not empty (the
 * regular expressions only accept empty ones, so a leftover means misuse).
 */
export function localize(html: string, strings: Strings, locale: Locale, used = new Set<string>()): string {
  let out = html.replace(ATTRIBUTE_PLACEHOLDER, (_match, tag: string, before: string, spec: string, after: string) => {
    let attributes = '';
    for (const pair of spec.split(';').filter(Boolean)) {
      const [name, key] = pair.split(':').map(part => part.trim());
      if (!name || !key) throw new Error(`i18n: malformed data-ta "${spec}"`);
      // defuss-i18n refuses any other attribute at runtime and the page stops starting.
      if (!(TRANSLATABLE_ATTRIBUTES as readonly string[]).includes(name)) throw new Error(`i18n: defuss-i18n cannot translate "${name}"`);
      if (new RegExp(`\\s${name}="`).test(before + after)) throw new Error(`i18n: <${tag}> sets ${name} and translates it`);
      const entry = lookup(strings, key, used);
      attributes += ` ${name}="${escapeAttribute(entry[locale])}"`;
      for (const variant of LOCALES) attributes += ` data-i18n-${name}-${variant}="${escapeAttribute(entry[variant])}"`;
    }
    return `<${tag}${before}${attributes}${after}>`;
  });
  // defuss-i18n rejects two targets of one name in a component, so a repeated
  // key gets a numbered target (`key~2`) with its own templates.
  const seen = new Map<string, number>();
  out = out.replace(TEXT_PLACEHOLDER, (_match, tag: string, before: string, key: string, after: string) => {
    const entry = lookup(strings, key, used);
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    const target = count === 1 ? key : `${key}~${count}`;
    const templates = LOCALES.map(variant => `<template data-i18n-for="${target}" data-i18n-locale="${variant}">${entry[variant]}</template>`).join('');
    return `<${tag}${before} data-i18n-target="${target}"${after}>${entry[locale]}</${tag}>${templates}`;
  });
  const leftover = /\sdata-ta?="[^"]*"/.exec(out);
  if (leftover) throw new Error(`i18n: placeholder not replaced (not empty?) near ${out.slice(Math.max(0, leftover.index - 80), leftover.index + 60)}`);
  return out;
}

/** Keys of `strings` that the page never used: dead copy that would still need translating. */
export function unusedKeys(strings: Strings, used: ReadonlySet<string>, prefixes: readonly string[] = []): string[] {
  return Object.keys(strings).filter(key => !used.has(key) && !prefixes.some(prefix => key.startsWith(prefix)));
}

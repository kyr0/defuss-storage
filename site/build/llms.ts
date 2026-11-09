// /llms.txt: the package explained for coding agents, in the llmstxt.org shape
// (title, summary, then sections with links). The text lives in site/llms.txt;
// its code comes from src/snippets.ts and its numbers from the benchmark
// reports ({{name}} slots), so the agents' view cannot drift from the page or
// the measurements. VERIFIED: (test/build.test.ts) snippets and slots fill, and
// an unknown id or a forbidden character fails the build.
import type { Snippet } from './highlight.ts';
import { fillSlots } from './figures.ts';
import { proseFindings } from './prose.ts';

const SNIPPET = /\{\{snippet:([\w-]+)\}\}/g;

/** `template` with its snippets and slots filled; throws on an unknown snippet or slot and on copy the prose rules forbid. */
export function llmsText(template: string, snippets: Readonly<Record<string, Snippet>>, slots: Readonly<Record<string, string>>): string {
  const withCode = template.replace(SNIPPET, (_match, id: string) => {
    const snippet = snippets[id];
    if (!snippet) throw new Error(`llms: no snippet "${id}"`);
    return snippet.code.replace(/\n$/, '');
  });
  const text = fillSlots(withCode, slots);
  const findings = proseFindings(text, 'llms.txt');
  if (findings.length) throw new Error(`llms: copy check failed\n${findings.join('\n')}`);
  return text;
}

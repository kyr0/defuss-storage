// Turns a playground script's static imports into lookups in an object of
// bundled modules. A script built from text cannot resolve package names the
// way the app's bundler does, so 'defuss-storage' and 'defuss-storage/opfs'
// are served from the worker's own bundle instead.
// VERIFIED: (test/client.test.ts) named, aliased and namespace imports; others rejected.

/**
 * Rewrites `import { a, b as c } from 'x'` to `const { a, b: c } = __modules["x"];`
 * and `import * as n from 'x'` to `const n = __modules["x"];`. Throws a
 * SyntaxError for a specifier outside `allowed` and for default imports, which
 * the package does not have.
 */
export function rewriteImports(source: string, allowed: readonly string[]): string {
  return source.replace(/^\s*import\s+([^;]+?)\s+from\s+['"]([^'"]+)['"];?/gm, (_statement, clause: string, specifier: string) => {
    if (!allowed.includes(specifier)) throw new SyntaxError(`only ${allowed.map(name => `'${name}'`).join(' and ')} can be imported here, not '${specifier}'`);
    const module = `__modules[${JSON.stringify(specifier)}]`;
    const namespace = /^\*\s+as\s+([\w$]+)$/.exec(clause.trim());
    if (namespace) return `const ${namespace[1]} = ${module};`;
    const named = /^\{([^}]*)\}$/.exec(clause.trim());
    if (!named) throw new SyntaxError(`use named imports, for example import { createOPFSStorage } from '${specifier}'`);
    return `const {${named[1]!.replace(/([\w$]+)\s+as\s+([\w$]+)/g, '$1: $2')}} = ${module};`;
  });
}

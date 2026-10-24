// tsc keeps the import specifiers of the sources, which carry no extension.
// Node16 and NodeNext resolution need one, so every relative specifier in the
// emitted declarations gets `.js`, or `/index.js` when it names a directory.
// Usage: node scripts/fix-declaration-imports.ts dist
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? 'dist');

const declarations = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return declarations(full);
    return entry.name.endsWith('.d.ts') ? [full] : [];
  });

const SPECIFIER = /(\bfrom\s*|\bimport\s*\(\s*)(['"])(\.{1,2}\/[^'"]*)\2/g;

let changed = 0;
for (const file of declarations(root)) {
  const source = readFileSync(file, 'utf8');
  const fixed = source.replace(
    SPECIFIER,
    (match, prefix: string, quote: string, specifier: string) => {
      if (/\.(c|m)?js$/.test(specifier)) return match;
      const target = path.resolve(path.dirname(file), specifier);
      if (existsSync(`${target}.d.ts`)) return `${prefix}${quote}${specifier}.js${quote}`;
      if (existsSync(path.join(target, 'index.d.ts'))) {
        return `${prefix}${quote}${specifier}/index.js${quote}`;
      }
      throw new Error(`${path.relative(root, file)}: ${specifier} resolves to no declaration`);
    },
  );
  if (fixed !== source) {
    writeFileSync(file, fixed);
    changed++;
  }
}
console.log(`declaration imports: ${changed} files given explicit extensions`);

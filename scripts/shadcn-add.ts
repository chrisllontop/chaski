// Adds shadcn components (new-york-v4) to the dashboard, with the components
// they depend on, rewriting the registry's imports to the dashboard's ~/
// alias. It leaves existing files alone unless --force is given, because
// chart.tsx carries a change for the dashboard's CSP (see its comment).
// Usage: node scripts/shadcn-add.ts [--force] <component>...
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const REGISTRY = 'https://ui.shadcn.com/r/styles/new-york-v4';
const ROOT = 'src/dashboard';

type RegistryItem = {
  dependencies?: string[];
  registryDependencies?: string[];
  files: Array<{ path: string; content: string }>;
};

const force = process.argv.includes('--force');
const names = process.argv.slice(2).filter((arg) => arg !== '--force');
const seen = new Set<string>();
const packages = new Set<string>();

const add = async (name: string): Promise<void> => {
  if (seen.has(name)) return;
  seen.add(name);
  const response = await fetch(`${REGISTRY}/${name}.json`);
  if (!response.ok) throw new Error(`${name}: the registry answered ${response.status}`);
  const item = (await response.json()) as RegistryItem;
  for (const dependency of item.dependencies ?? []) packages.add(dependency);
  for (const file of item.files) {
    const relative = file.path.replace('registry/new-york-v4/', '');
    const target = path.join(
      ROOT,
      relative.startsWith('ui/') ? `components/${relative}` : relative,
    );
    if (existsSync(target) && !force) {
      console.log(`kept ${target}`);
      continue;
    }
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(
      target,
      file.content
        .replaceAll('"@/registry/new-york-v4/ui/', '"~/components/ui/')
        .replaceAll('"@/registry/new-york-v4/hooks/', '"~/hooks/')
        .replaceAll('"@/registry/new-york-v4/lib/', '"~/lib/'),
    );
    console.log(`wrote ${target}`);
  }
  for (const dependency of item.registryDependencies ?? [])
    await add(dependency.split('/').at(-1) ?? dependency);
};

for (const name of names) await add(name);
if (packages.size > 0) console.log(`npm packages they use: ${[...packages].sort().join(' ')}`);

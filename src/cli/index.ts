#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { isChaskiError } from '../contract/errors';
import { templatesToSql } from './templates-sql';

const USAGE = `Usage: chaskijs templates sql <file>

Prints the SQL that loads a chaski.templates file the way chaski.templates.import() does, for
\`wrangler d1 execute <database> --local --file <sql>\`. Apply Chaski's migrations first.`;

const [group, command, path] = process.argv.slice(2);

if (group !== 'templates' || command !== 'sql' || !path) {
  console.error(USAGE);
  process.exit(group === '--help' || group === '-h' ? 0 : 1);
}

try {
  const { statements, warnings } = templatesToSql(JSON.parse(readFileSync(path, 'utf8')));
  for (const warning of warnings) console.error(`warning: ${warning}`);
  process.stdout.write(
    `-- chaski templates from ${path}; run it after Chaski's migrations.\n` +
      statements.map((statement) => `${statement};\n`).join(''),
  );
} catch (error) {
  console.error(isChaskiError(error) ? error.message : `${path}: ${String(error)}`);
  process.exit(1);
}

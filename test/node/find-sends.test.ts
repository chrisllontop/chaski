import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const SCRIPT = join(import.meta.dirname, '../../skills/chaski/scripts/find-sends.mjs');

let project = '';

// A project on disk with the given files, and what the finder prints under each heading.
const findSends = (files: Record<string, string>) => {
  project = mkdtempSync(join(tmpdir(), 'find-sends-'));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(project, path, '..'), { recursive: true });
    writeFileSync(join(project, path), content);
  }
  const output = execFileSync(process.execPath, [SCRIPT, project], { encoding: 'utf8' });
  const sections: Record<string, string[]> = {};
  for (const block of output.split('\n## ').slice(1)) {
    const [heading = '', ...lines] = block.trim().split('\n');
    sections[heading] = lines.filter(Boolean);
  }
  return sections;
};

const names = (lines: string[] = []) => lines.map((line) => line.slice(0, line.indexOf(':')));

afterEach(() => {
  rmSync(project, { recursive: true, force: true });
});

describe('find-sends', () => {
  it('reads a provider name only as a whole segment of a setting', () => {
    const found = findSends({
      'src/constants.ts': [
        "export const JOB_STATUSES = ['queued'];",
        "export const BOX_CLASSES = ['a'];",
        'export const PRICE_USES = 2;',
        "export const INVALID_EMAIL_OR_PASSWORD = 'Wrong email or password';",
        "export const MAIL_STATUSES = ['sent'];",
        'export const key = (env: Env) => env.RESEND_API_KEY;',
        "export const SMTP_HOST = 'smtp.example.com';",
      ].join('\n'),
    });

    expect(names(found.credentials)).toEqual(['RESEND_API_KEY', 'SMTP_HOST']);
  });

  // With the finder alone, a provider it doesn't list would read as nothing to move.
  it('lists a provider it doesn’t know as candidates', () => {
    const found = findSends({
      'package.json': JSON.stringify({
        dependencies: { 'acme-notify': '^2.0.0', '@beta/mailer': '^1.0.0', hono: '^4.0.0' },
      }),
      '.dev.vars': 'ACME_API_KEY=secret\nACME_URL=https://api.acme.example\n',
      'src/send.ts': "export const token = (env: Env) => env.GAMMA_TOKEN ?? 'x';",
    });

    expect(found.packages).toEqual([
      'package.json: acme-notify@^2.0.0 (unknown, shares its name with the ACME_ settings)',
      'package.json: @beta/mailer@^1.0.0 (unknown, named like a sender)',
    ]);
    expect(names(found['other settings'])).toEqual(['ACME_API_KEY', 'ACME_URL', 'GAMMA_TOKEN']);
  });
});

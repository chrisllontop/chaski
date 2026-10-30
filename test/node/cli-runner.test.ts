import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli/runner';
import { tempDir } from './cli-helpers';

const repo = join(import.meta.dirname, '../..');

describe('the command runner', () => {
  it('writes the input to stdin and captures both outputs and the exit code', async () => {
    const result = await run(
      'node',
      [
        '-e',
        'process.stdin.on("data", (d) => { console.log("got " + d); console.error("bye"); process.exit(3); })',
      ],
      { cwd: tempDir(), input: 'a-secret', capture: true },
    );

    expect(result).toEqual({ code: 3, stdout: 'got a-secret\n', stderr: 'bye\n' });
  });

  it('runs the wrangler the project installed', async () => {
    const { version } = JSON.parse(
      readFileSync(join(repo, 'node_modules/wrangler/package.json'), 'utf8'),
    ) as { version: string };

    const result = await run('wrangler', ['--version'], { cwd: repo, capture: true });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain(version);
  });

  it('runs only the chaskijs the project installed', async () => {
    const cwd = tempDir();

    await expect(run('chaskijs', ['sync'], { cwd })).rejects.toThrow(
      `chaskijs isn't installed in ${cwd}`,
    );
  });
});

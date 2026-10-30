import { createInterface } from 'node:readline/promises';
import { CliError, type Prompts } from './context';

// One interface per question: closing it hands the terminal back before any command runs, so
// Ctrl+C reaches Wrangler too rather than only this process.
const ask = async (question: string) => {
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  readline.on('SIGINT', () => {
    process.stdout.write('\n');
    process.exit(130);
  });
  try {
    return (await readline.question(question)).trim();
  } catch (error) {
    // Ctrl+D, or stdin ending, before an answer. Every command asks before it acts.
    if ((error as NodeJS.ErrnoException).code !== 'ABORT_ERR') throw error;
    throw new CliError('\nStopped before any change.');
  } finally {
    readline.close();
  }
};

export const terminalPrompts: Prompts = {
  text: async (question, fallback) => {
    const answer = await ask(`? ${question}${fallback ? ` (${fallback})` : ''}: `);
    return answer || fallback || '';
  },
  select: async (question, choices) => {
    process.stdout.write(
      `? ${question}\n${choices.map((choice, i) => `  ${i + 1}. ${choice}\n`).join('')}`,
    );
    for (;;) {
      const index = Number(await ask(`  Choose 1-${choices.length}: `)) - 1;
      if (Number.isInteger(index) && index >= 0 && index < choices.length) return index;
    }
  },
  confirm: async (question, fallback) => {
    for (;;) {
      const answer = (await ask(`? ${question} (${fallback ? 'Y/n' : 'y/N'}) `)).toLowerCase();
      if (!answer) return fallback;
      if (['y', 'yes'].includes(answer)) return true;
      if (['n', 'no'].includes(answer)) return false;
    }
  },
};

import { createInterface } from 'node:readline/promises';
import { CliError, type Prompts } from './context';

/** Prompts on the terminal; `close()` lets the process exit once the answers are in. */
export const terminalPrompts = (): Prompts & { close: () => void } => {
  let readline: ReturnType<typeof createInterface> | undefined;
  // Opened on the first question, so a command that asks nothing doesn't hold stdin open.
  const ask = (question: string) => {
    if (!readline) {
      readline = createInterface({ input: process.stdin, output: process.stdout });
      readline.on('SIGINT', () => {
        process.stdout.write('\n');
        process.exit(130);
      });
    }
    return readline.question(question).then(
      (answer) => answer.trim(),
      // Ctrl+D, or stdin ending, before an answer. Every command asks before it acts.
      (error: NodeJS.ErrnoException) => {
        if (error.code !== 'ABORT_ERR') throw error;
        throw new CliError('\nStopped before any change.');
      },
    );
  };

  return {
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
    close: () => readline?.close(),
  };
};

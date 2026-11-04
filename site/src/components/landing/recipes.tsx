import { Link } from '@tanstack/react-router';
import { ArrowRightIcon } from '../icons';
import { Code } from './code';
import { receiptSample, reminderSample, resetSample } from './samples';

const RECIPES = [
  {
    file: 'src/billing.ts',
    code: receiptSample,
    title: 'A receipt that cannot go out twice',
    text: 'Your handler retries. The key returns the first send instead, so the user gets one receipt and you keep one record of it.',
    guide: 'sending',
    hash: undefined as string | undefined,
    delay: '[--reveal-delay:0ms]',
  },
  {
    file: 'src/auth.ts',
    code: resetSample,
    title: 'A reset while someone waits',
    text: 'Inline delivery finishes before send() returns, so the request on screen can say when the email did not go out.',
    guide: 'sending',
    hash: 'inline',
    delay: '[--reveal-delay:70ms]',
  },
  {
    file: 'src/trials.ts',
    code: reminderSample,
    title: 'A reminder that moves when the trial does',
    text: 'Schedule the same key again and the pending send moves. Cancel by that key when they upgrade and nothing fires.',
    guide: 'scheduling',
    hash: undefined as string | undefined,
    delay: '[--reveal-delay:140ms]',
  },
];

export const Recipes = () => (
  <section
    id="recipes"
    className="wrap flex flex-col gap-14 pt-32 lg:pt-40"
    aria-labelledby="recipes-title"
  >
    <div
      data-reveal=""
      className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between lg:gap-20"
    >
      <div className="flex max-w-[640px] flex-col gap-5">
        <p className="kicker">In practice</p>
        <h2 id="recipes-title" className="h2">
          Three sends every app ends up owing its users.
        </h2>
      </div>
      <p className="lede max-w-[400px]">
        Receipts, resets and reminders are where notifications stop being a feature and start being
        infrastructure. Each one is a call.
      </p>
    </div>

    <div className="grid gap-px overflow-hidden rounded-2xl border border-border bg-border lg:grid-cols-3">
      {RECIPES.map((recipe) => (
        <article
          key={recipe.title}
          className="group relative bg-background p-6 transition-colors duration-300 hover:bg-raised has-[:focus-visible]:bg-raised has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-2 has-[:focus-visible]:outline-signal sm:p-8"
        >
          <div data-reveal="" className={`flex h-full flex-col gap-8 ${recipe.delay}`}>
            <div className="overflow-hidden rounded-[10px] border border-border bg-card transition-colors duration-300 group-hover:border-white/14">
              <p className="border-b border-border px-4 py-2.5 font-mono text-xs leading-4 text-muted-foreground/70">
                {recipe.file}
              </p>
              <Code className="overflow-x-auto px-4 py-3.5 text-[12.5px] leading-5">
                {recipe.code}
              </Code>
            </div>
            <div className="flex flex-col gap-2">
              <h3 className="cell-title">
                <Link
                  to="/docs/$"
                  params={{ _splat: recipe.guide }}
                  hash={recipe.hash}
                  className="inline-flex items-center gap-2 after:absolute after:inset-0 focus-visible:outline-none"
                >
                  {recipe.title}
                  <ArrowRightIcon
                    size={18}
                    className="text-signal opacity-0 transition-[opacity,translate] duration-200 group-hover:opacity-100 group-has-[:focus-visible]:opacity-100 motion-safe:-translate-x-1.5 motion-safe:group-hover:translate-x-0 motion-safe:group-has-[:focus-visible]:translate-x-0"
                  />
                </Link>
              </h3>
              <p className="cell-text">{recipe.text}</p>
            </div>
          </div>
        </article>
      ))}
    </div>
  </section>
);

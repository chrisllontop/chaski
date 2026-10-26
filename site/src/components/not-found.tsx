import { Link } from '@tanstack/react-router';
import { Logo } from './logo';

export const NotFound = () => (
  <div className="flex min-h-dvh flex-col">
    <header className="border-b border-border">
      <div className="wrap flex h-[72px] items-center">
        <Link to="/" className="rounded-md">
          <Logo className="h-7 w-auto" />
        </Link>
      </div>
    </header>
    <main className="wrap flex grow flex-col items-start justify-center gap-6 py-24">
      <p className="kicker">404</p>
      <h1 className="h2">This page isn’t on the route.</h1>
      <p className="lede max-w-[480px]">
        The address may have changed, or it never existed. The rest of Chaski is one step back.
      </p>
      <div className="mt-2 flex flex-wrap gap-3">
        <Link
          to="/"
          className="flex h-11 items-center rounded-lg bg-primary px-5 text-[15px] leading-5 font-medium text-primary-foreground transition-colors hover:bg-white"
        >
          Go to chaski.sh
        </Link>
        <Link
          to="/docs/$"
          params={{ _splat: '' }}
          className="flex h-11 items-center rounded-lg border border-border bg-card px-5 text-[15px] leading-5 font-medium transition-colors hover:border-white/15"
        >
          Read the docs
        </Link>
      </div>
    </main>
  </div>
);

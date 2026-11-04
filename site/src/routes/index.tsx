import { createFileRoute } from '@tanstack/react-router';
import { useRef } from 'react';
import { Agent } from '~/components/landing/agent';
import { Browser } from '~/components/landing/browser';
import { Closing } from '~/components/landing/closing';
import { Compare } from '~/components/landing/compare';
import { Features } from '~/components/landing/features';
import { Handoffs } from '~/components/landing/handoffs';
import { Hero } from '~/components/landing/hero';
import { HowItWorks } from '~/components/landing/how-it-works';
import { ProductShot } from '~/components/landing/product-shot';
import { Recipes } from '~/components/landing/recipes';
import { SiteFooter } from '~/components/landing/site-footer';
import { SiteHeader } from '~/components/landing/site-header';
import { Usage } from '~/components/landing/usage';
import { useEntrances } from '~/lib/motion';
import { seo } from '~/lib/seo';

const Landing = () => {
  const main = useRef<HTMLElement>(null);
  useEntrances(main);
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60] focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:text-primary-foreground"
      >
        Skip to content
      </a>
      <SiteHeader />
      <main id="main" ref={main} className="overflow-x-clip">
        <Hero />
        <ProductShot />
        <HowItWorks />
        <Usage />
        <Features />
        <Recipes />
        <Compare />
        <Browser />
        <Handoffs />
        <Agent />
        <Closing />
      </main>
      <SiteFooter />
    </>
  );
};

export const Route = createFileRoute('/')({
  head: () =>
    seo({
      title: 'Chaski · Notifications that run in a Worker of your own',
      description:
        'Open-source email, push and an in-app feed that run as a Worker on your Cloudflare account, without building the queues, retries, templates and preferences behind them. You pay Cloudflare, not per notification.',
      path: '/',
    }),
  component: Landing,
});

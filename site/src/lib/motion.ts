import { type RefObject, useEffect, useSyncExternalStore } from 'react';

const MOTION_QUERY = '(prefers-reduced-motion: no-preference)';

const subscribeMotion = (onChange: () => void) => {
  const query = matchMedia(MOTION_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};

/** False on the server and under reduced motion, so the prerendered page shows final frames. */
export const useMotionAllowed = () =>
  useSyncExternalStore(
    subscribeMotion,
    () => matchMedia(MOTION_QUERY).matches,
    () => false,
  );

const ENTRANCES = [
  { attribute: 'data-reveal', armed: 'hidden', played: 'shown' },
  { attribute: 'data-play', armed: 'armed', played: 'on' },
] as const;

/**
 * Arms every `data-reveal` and `data-play` element below the fold, then plays each once it scrolls
 * into view. What is already on screen at load keeps its final frame, and so does every element
 * when motion is reduced or the script never runs.
 */
export const useEntrances = (root: RefObject<HTMLElement | null>) => {
  useEffect(() => {
    const container = root.current;
    if (!container || !matchMedia(MOTION_QUERY).matches) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const { target, isIntersecting } of entries) {
          if (!isIntersecting) continue;
          for (const { attribute, played } of ENTRANCES) {
            if (target.hasAttribute(attribute)) target.setAttribute(attribute, played);
          }
          observer.unobserve(target);
        }
      },
      { rootMargin: '0px 0px -12% 0px' },
    );
    for (const { attribute, armed } of ENTRANCES) {
      for (const element of container.querySelectorAll(`[${attribute}]`)) {
        if (element.getBoundingClientRect().top < window.innerHeight) continue;
        element.setAttribute(attribute, armed);
        observer.observe(element);
      }
    }
    return () => observer.disconnect();
  }, [root]);
};

/**
 * Mirrors whether `watched` (the element itself unless given) shows at least `threshold` of itself
 * into the element's `data-in-view`, for CSS to pause on.
 */
export const useInViewAttribute = (
  ref: RefObject<HTMLElement | null>,
  watched: RefObject<HTMLElement | null> = ref,
  threshold = 0,
) => {
  useEffect(() => {
    const element = ref.current;
    const target = watched.current;
    if (!element || !target) return;
    const observer = new IntersectionObserver(
      // An entry intersects as soon as one pixel shows, whatever the threshold.
      ([entry]) => {
        const shown = entry?.isIntersecting && entry.intersectionRatio >= threshold;
        element.toggleAttribute('data-in-view', Boolean(shown));
      },
      { threshold },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [ref, watched, threshold]);
};

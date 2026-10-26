import { useCallback, useEffect, useState } from 'react';

const COPIED_FOR_MS = 1600;

/**
 * Copies text, or runs a custom clipboard write, and reports success for a moment; without
 * clipboard access nothing changes.
 */
export const useCopy = () => {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const reset = setTimeout(() => setCopied(false), COPIED_FOR_MS);
    return () => clearTimeout(reset);
  }, [copied]);

  const copy = useCallback(async (write: string | (() => Promise<void>)) => {
    try {
      await (typeof write === 'string' ? navigator.clipboard.writeText(write) : write());
      setCopied(true);
    } catch {
      // The text stays on screen to select by hand.
    }
  }, []);

  return { copied, copy };
};

/** Announces a copy to screen readers, since the visible change is only an icon. */
export const CopyStatus = ({ copied }: { copied: boolean }) => (
  <span role="status" className="sr-only">
    {copied ? 'Copied' : ''}
  </span>
);

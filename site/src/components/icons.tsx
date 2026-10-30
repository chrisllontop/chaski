import type { ReactNode } from 'react';

type IconProps = {
  size?: number;
  strokeWidth?: number;
  className?: string;
};

const icon =
  (paths: ReactNode, defaults: { strokeWidth?: number } = {}) =>
  ({ size = 16, strokeWidth = defaults.strokeWidth ?? 2, className }: IconProps) => (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {paths}
    </svg>
  );

export const BookIcon = icon(
  <path d="M12 7v14M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" />,
  { strokeWidth: 1.75 },
);

export const GitHubIcon = icon(
  <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4M9 18c-4.51 2-5-2-7-2" />,
  { strokeWidth: 1.75 },
);

export const PackageIcon = icon(
  <path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73zM12 22V12M3.3 7l7.703 4.734a2 2 0 0 0 2.004 0L20.7 7M7.5 4.27l9 5.15" />,
  { strokeWidth: 1.75 },
);

export const ArrowRightIcon = icon(<path d="M5 12h14M13 6l6 6-6 6" />);

export const ArrowLeftIcon = icon(<path d="M19 12H5M11 18l-6-6 6-6" />);

export const ArrowUpIcon = icon(<path d="m5 12 7-7 7 7M12 19V5" />);

export const CopyIcon = icon(
  <>
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
  </>,
);

export const CheckIcon = icon(<path d="M20 6 9 17l-5-5" />);

export const TickIcon = icon(<path d="M5 12.5l4.5 4.5L19 7.5" />, { strokeWidth: 2.25 });

export const MailIcon = icon(
  <>
    <rect x="2" y="4" width="20" height="16" rx="2" />
    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
  </>,
);

export const BellIcon = icon(
  <path d="M10.27 21a2 2 0 0 0 3.46 0M3.26 15.33A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.67C19.41 13.96 18 12.5 18 8A6 6 0 0 0 6 8c0 4.5-1.41 5.96-2.74 7.33" />,
);

export const PhoneIcon = icon(
  <>
    <rect x="5" y="2" width="14" height="20" rx="2" />
    <path d="M12 18h.01" />
  </>,
);

export const MonitorIcon = icon(
  <>
    <rect x="2" y="3" width="20" height="14" rx="2" />
    <path d="M8 21h8M12 17v4" />
  </>,
);

export const GlobeIcon = icon(
  <>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20M2 12h20" />
  </>,
);

export const LockIcon = icon(
  <>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </>,
);

export const SearchIcon = icon(
  <>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </>,
);

export const MenuIcon = icon(<path d="M4 7h16M4 12h16M4 17h16" />, { strokeWidth: 1.75 });

export const CloseIcon = icon(<path d="M18 6 6 18M6 6l12 12" />, { strokeWidth: 1.75 });

export const ChevronRightIcon = icon(<path d="m9 18 6-6-6-6" />);

export const ChevronDownIcon = icon(<path d="m6 9 6 6 6-6" />);

export const PencilIcon = icon(
  <path d="M12 20h9M16.38 3.62a1 1 0 0 1 3 3L7.37 18.64a2 2 0 0 1-.86.51l-2.87.84a.5.5 0 0 1-.62-.62l.84-2.87a2 2 0 0 1 .51-.86z" />,
);

export const TerminalIcon = icon(<path d="m4 17 6-5-6-5M12 19h8" />);

export const InfoIcon = icon(
  <>
    <circle cx="12" cy="12" r="10" strokeWidth={1.75} />
    <path d="M12 16v-4M12 8h.01" />
  </>,
);

export const FileIcon = icon(
  <>
    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z" />
    <path d="M14 2v4a2 2 0 0 0 2 2h4" />
  </>,
);

export const Mark = ({ size = 56, className }: { size?: number; className?: string }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 32 32"
    fill="none"
    stroke="currentColor"
    strokeWidth="4"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className={className}
  >
    <path d="M5 9.5H12A4 4 0 0 1 16 13.5V18.5A4 4 0 0 0 20 22.5H27" />
  </svg>
);

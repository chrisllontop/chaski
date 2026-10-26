import logo from '../../../brand/logo-white.svg';

export const Logo = ({ className }: { className?: string }) => (
  <img src={logo} alt="Chaski" width={113} height={32} className={className} />
);

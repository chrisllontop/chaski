import { DocsButton, InstallButton } from '../actions';
import { Mark } from '../icons';

export const Closing = () => (
  <section
    data-reveal=""
    className="wrap flex flex-col items-center gap-7 pt-40 pb-36 text-center lg:pt-[200px] lg:pb-[180px]"
    aria-labelledby="closing-title"
  >
    <Mark className="text-signal" />
    <h2
      id="closing-title"
      className="text-[44px] leading-[48px] font-semibold tracking-[-0.045em] text-balance sm:text-[72px] sm:leading-[76px]"
    >
      Mount it this afternoon.
    </h2>
    <p className="lede max-w-[520px]">
      Free and open source under the MIT license. Install it, follow the guide, and your first
      notification goes out from your own Worker.
    </p>
    <div className="flex flex-wrap items-center justify-center gap-3 pt-5">
      <DocsButton />
      <InstallButton />
    </div>
  </section>
);

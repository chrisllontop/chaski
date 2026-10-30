import { DocsButton, InstallChip } from '../actions';
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
      Deploy it this afternoon.
    </h2>
    <p className="lede max-w-[520px]">
      Free and open source under the MIT license. Create it with one command and follow the guide,
      or hand it to your agent. Either way, your first notification goes out from a Worker of your
      own.
    </p>
    <div className="flex flex-wrap items-center justify-center gap-3 pt-5">
      <DocsButton />
      <InstallChip initial="npm" />
    </div>
  </section>
);

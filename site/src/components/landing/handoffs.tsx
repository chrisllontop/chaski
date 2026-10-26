import { useMotionAllowed } from '~/lib/motion';

const LINE =
  'M0 12 H142 Q150 12 150 20 V44 Q150 52 158 52 H292 Q300 52 300 44 V20 Q300 12 308 12 H442 Q450 12 450 20 V44 Q450 52 458 52 H592 Q600 52 600 44 V20 Q600 12 608 12 H742 Q750 12 750 20 V44 Q750 52 758 52 H892 Q900 52 900 44 V20 Q900 12 908 12 H1042 Q1050 12 1050 20 V44 Q1050 52 1058 52 H1200';

// Where along LINE (as a share of its length) the runner passes each post.
const POSTS = [
  { x: 150, at: 0.117 },
  { x: 300, at: 0.245 },
  { x: 450, at: 0.372 },
  { x: 600, at: 0.5 },
  { x: 750, at: 0.628 },
  { x: 900, at: 0.756 },
  { x: 1050, at: 0.883 },
];

const LOOP = '10s';
const POST = '#4a4a4a';
// SMIL interpolates literal colors only, so the palette is spelled out here.
const SIGNAL = '#f4a340';
const GROUND = '#080808';
// A post holds the light 1.5 s of the 10 s loop as it fades back.
const AFTERGLOW = 0.15;
const TRAIL = 70;

const lightUp = (at: number) => {
  const fadedAt = Math.min(at + AFTERGLOW, 1);
  const times = [0, at - 0.001, at, fadedAt];
  const values = [POST, POST, SIGNAL, POST];
  if (fadedAt < 1) {
    times.push(1);
    values.push(POST);
  }
  return { keyTimes: times.join(';'), values: values.join(';') };
};

/** The frame the design shows: a send halfway along, the post it just passed still lit. */
const StillFrame = () => (
  <>
    <path
      d="M600 12 H742 Q750 12 750 20 V44 Q750 52 758 52 H884"
      stroke={SIGNAL}
      strokeWidth="2.5"
    />
    {POSTS.map((post) => (
      <circle
        key={post.x}
        cx={post.x}
        cy="32"
        r="3.5"
        fill={GROUND}
        stroke={post.x === 750 ? SIGNAL : POST}
        strokeWidth="1.5"
      />
    ))}
    <circle cx="884" cy="52" r="5" fill={SIGNAL} />
  </>
);

const Runner = () => (
  <>
    <path
      d={LINE}
      pathLength={1000}
      stroke={SIGNAL}
      strokeWidth="2.5"
      strokeDasharray={`${TRAIL} 2000`}
      strokeDashoffset={TRAIL}
    >
      <animate
        attributeName="stroke-dashoffset"
        from={TRAIL}
        to={TRAIL - 1000}
        dur={LOOP}
        repeatCount="indefinite"
      />
    </path>
    {POSTS.map((post) => (
      <circle
        key={post.x}
        cx={post.x}
        cy="32"
        r="3.5"
        fill={GROUND}
        stroke={POST}
        strokeWidth="1.5"
      >
        <animate attributeName="stroke" dur={LOOP} repeatCount="indefinite" {...lightUp(post.at)} />
      </circle>
    ))}
    <circle r="5" fill={SIGNAL} opacity="0">
      <animateMotion dur={LOOP} repeatCount="indefinite" path={LINE} />
      <animate
        attributeName="opacity"
        dur={LOOP}
        repeatCount="indefinite"
        values="0;1;1;0"
        keyTimes="0;0.03;0.97;1"
      />
    </circle>
  </>
);

export const Handoffs = () => {
  const motion = useMotionAllowed();
  return (
    <section
      id="handoffs"
      className="wrap flex flex-col gap-14 pt-36 lg:gap-[72px] lg:pt-[200px]"
      aria-labelledby="handoffs-title"
    >
      <svg
        data-reveal=""
        className="h-auto w-full"
        width="1200"
        height="64"
        viewBox="0 0 1200 64"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d={LINE} stroke="#2b2b2b" strokeWidth="2" />
        {motion ? <Runner /> : <StillFrame />}
      </svg>
      <div
        data-reveal=""
        className="flex flex-col gap-8 lg:flex-row lg:items-start lg:justify-between lg:gap-20"
      >
        <div className="flex max-w-[600px] flex-col gap-5">
          <p className="kicker">Delivery timeline</p>
          <h2 id="handoffs-title" className="h2">
            Every handoff, on the record.
          </h2>
        </div>
        <div className="flex max-w-[470px] flex-col gap-4 lg:pt-9">
          <p className="lede">
            A send leaves your code, waits in your queue, reaches the provider and gets opened.
            Chaski records each step as it happens, retries included.
          </p>
          <p className="text-[17px] leading-7 text-pretty">
            Open any delivery in the dashboard to see where it is, how long each step took and, if
            it failed, why.
          </p>
        </div>
      </div>
    </section>
  );
};

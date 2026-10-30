import type { Context } from 'hono';

/** Who Cloudflare Access signed in to the dashboard; admin actions are logged under this id. */
export type Actor = {
  id: string;
  name?: string;
};

const actors = new WeakMap<Request, Actor>();

export const setActor = (c: Context, actor: Actor): void => {
  actors.set(c.req.raw, actor);
};

/** The actor the Access guard let in; the guard runs before every admin route. */
export const actorOf = (c: Context): Actor | undefined => actors.get(c.req.raw);

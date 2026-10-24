import { z } from 'zod';

export const CHANNELS = ['email', 'in_app', 'push'] as const;
export const channelSchema = z.enum(CHANNELS);
export type Channel = z.infer<typeof channelSchema>;

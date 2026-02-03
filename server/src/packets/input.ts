import { z } from 'zod';

export const InputSchema = z.object({
	seq: z.number(),
	tick: z.number(),
	moveX: z.number().min(-1).max(1),
	moveY: z.number().min(-1).max(1),
	jump: z.boolean(),
	shoot: z.boolean(),
	yaw: z.number(),
	pitch: z.number()
});

export type InputPacket = z.infer<typeof InputSchema>;

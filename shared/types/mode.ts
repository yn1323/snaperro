import { z } from "zod/v4";

/**
 * Operation mode
 */
export const ModeSchema = z.enum(["proxy", "record", "mock"]);
export type Mode = z.infer<typeof ModeSchema>;

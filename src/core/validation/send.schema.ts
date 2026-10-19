import { z } from "zod";

const numOrStr = z.union([z.number(), z.string()]);
const actor = z.object({ id: numOrStr.nullish(), name: z.string().nullish() }).optional();

export const previewSchema = z.object({
  templateId: numOrStr,
  channelId: numOrStr.nullish(),
  actor,
});
export type PreviewInput = z.infer<typeof previewSchema>;

export const confirmSchema = z.object({ batchId: numOrStr, actor });
export type ConfirmInput = z.infer<typeof confirmSchema>;

export const cancelSchema = z.object({ batchId: numOrStr });
export type CancelInput = z.infer<typeof cancelSchema>;

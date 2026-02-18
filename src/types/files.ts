import { z } from "zod";

/**
 * Options for copying files from host to container.
 */
export const CopyToContainerOptionsSchema = z.object({
  sourcePath: z.string().min(1),
  destPath: z.string().min(1),
  overwrite: z.boolean().default(true),
});

export type CopyToContainerOptions = z.infer<typeof CopyToContainerOptionsSchema>;

/**
 * Options for copying files from container to host.
 */
export const CopyFromContainerOptionsSchema = z.object({
  sourcePath: z.string().min(1),
  destPath: z.string().min(1),
});

export type CopyFromContainerOptions = z.infer<typeof CopyFromContainerOptionsSchema>;

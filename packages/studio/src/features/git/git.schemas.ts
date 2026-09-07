import { z } from 'zod'

export const gitPathsRequestSchema = z.object({
  paths: z.array(z.string()).optional(),
})
export const gitCommitRequestSchema = gitPathsRequestSchema.extend({
  message: z.string().optional(),
  confirmed: z.boolean().optional(),
})
export const gitStatusSchema = z.object({
  branch: z.string().optional(),
  files: z.array(
    z.object({
      path: z.string(),
      status: z.string(),
      staged: z.boolean(),
      diff: z.string(),
    }),
  ),
  pullRequestAvailable: z.boolean(),
  pullRequestReason: z.string().optional(),
})
export const pullRequestResultSchema = z.object({
  url: z.string().optional(),
  message: z.string(),
})
export type GitFile = z.infer<typeof gitStatusSchema>['files'][number]
export type GitStatus = z.infer<typeof gitStatusSchema>
export type GitCommitRequest = z.infer<typeof gitCommitRequestSchema>

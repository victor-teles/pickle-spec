import { describe, expect, test } from 'vitest'
import {
  planValidationRequestSchema,
  planValidationReviewSchema,
} from '../../../src/features/execution-plans/validation.schemas'
import { studioRunRequestSchema } from '../../../src/features/runs/run.schemas'

const revisionId = 'a'.repeat(64)
const reviewId = 'b'.repeat(64)

describe('plan validation schemas', () => {
  test('requires review rationale and reset confirmation', () => {
    expect(
      planValidationReviewSchema.parse({
        revisionId,
        rationale: 'Preserves the checkout submission target.',
        evidenceRunIds: ['run-1'],
      }),
    ).toEqual({
      revisionId,
      rationale: 'Preserves the checkout submission target.',
      evidenceRunIds: ['run-1'],
    })

    expect(() =>
      planValidationReviewSchema.parse({
        revisionId,
        rationale: '   ',
        evidenceRunIds: ['run-1'],
      }),
    ).toThrow()

    expect(
      planValidationRequestSchema.parse({
        revisionId,
        reviewId,
        resetConfirmed: true,
      }),
    ).toEqual({
      revisionId,
      reviewId,
      resetConfirmed: true,
    })

    expect(() =>
      planValidationRequestSchema.parse({
        revisionId,
        reviewId,
        resetConfirmed: false,
      }),
    ).toThrow()
  })

  test('accepts a dedicated validation run request and rejects mixed run options', () => {
    expect(
      studioRunRequestSchema.parse({
        planValidation: {
          revisionId,
          reviewId,
          resetConfirmed: true,
        },
      }),
    ).toEqual({
      planValidation: {
        revisionId,
        reviewId,
        resetConfirmed: true,
      },
    })

    expect(() =>
      studioRunRequestSchema.parse({
        planValidation: {
          revisionId,
          reviewId,
          resetConfirmed: true,
        },
        refreshCache: true,
      }),
    ).toThrow()
  })
})

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { PlanValidation } from '../../../src/features/execution-plans/plan-validation'
import {
  planValidationRequestSchema,
  planValidationReviewSchema,
} from '../../../src/features/execution-plans/validation.schemas'
import { studioRunRequestSchema } from '../../../src/features/runs/run.schemas'

const revisionId = 'a'.repeat(64)
const reviewId = 'b'.repeat(64)

describe('plan validation UI', () => {
  test('labels validation side effects, reset ownership, and inactive execution', () => {
    const markup = renderToStaticMarkup(
      <PlanValidation revisionId={revisionId} disabled={false} />,
    )

    expect(markup).toContain('Validate candidate')
    expect(markup).toContain('may submit forms, create records')
    expect(markup).toContain('Reset the application first')
    expect(markup).toContain('Pickle does not reset it')
    expect(markup).toContain('Cancelling cannot undo completed actions')
    expect(markup).toContain('without model inference')
    expect(markup).toContain('The active plan and cache stay unchanged')
    expect(markup).toContain('Review for validation')
  })

  test('blocks validation while a locator edit is open', () => {
    const markup = renderToStaticMarkup(
      <PlanValidation revisionId={revisionId} disabled={true} />,
    )

    expect(markup).toContain(
      'Save or cancel the locator edit before validating',
    )
    expect(markup).toContain('disabled=""')
  })
})

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

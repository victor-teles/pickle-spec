import { test, expect, describe, beforeAll, afterAll } from 'bun:test'
import { parseFeatureFile, parseFeatureFiles, filterPicklesByTag } from './parser'
import { tmpdir } from 'os'
import { join } from 'path'
import { mkdirSync, rmSync } from 'fs'

const fixtureDir = join(tmpdir(), `pickle-parser-test-${Date.now()}`)

beforeAll(() => {
  mkdirSync(fixtureDir, { recursive: true })
})

afterAll(() => {
  rmSync(fixtureDir, { recursive: true, force: true })
})

async function writeFeature(name: string, content: string): Promise<string> {
  const filePath = join(fixtureDir, name)
  await Bun.write(filePath, content)
  return filePath
}

describe('parseFeatureFile', () => {
  test('parses feature name and scenario pickles', async () => {
    const path = await writeFeature('basic.feature', `
Feature: Login
  Scenario: Valid login
    Given I am on the login page
    When I enter valid credentials
    Then I should see the dashboard
`)

    const result = await parseFeatureFile(path)
    expect(result.featureName).toBe('Login')
    expect(result.pickles).toHaveLength(1)
    expect(result.pickles[0]!.name).toBe('Valid login')
    expect(result.pickles[0]!.steps).toHaveLength(3)
    expect(result.pickles[0]!.steps[0]!.text).toBe('I am on the login page')
    expect(result.pickles[0]!.steps[1]!.text).toBe('I enter valid credentials')
    expect(result.pickles[0]!.steps[2]!.text).toBe('I should see the dashboard')
  })

  test('handles Scenario Outline with Examples', async () => {
    const path = await writeFeature('outline.feature', `
Feature: Search
  Scenario Outline: Search for items
    Given I am on the search page
    When I search for "<query>"
    Then I should see "<result>"

    Examples:
      | query  | result       |
      | apple  | Apple Inc    |
      | banana | Banana Corp  |
`)

    const result = await parseFeatureFile(path)
    expect(result.pickles).toHaveLength(2)
    expect(result.pickles[0]!.steps[1]!.text).toBe('I search for "apple"')
    expect(result.pickles[0]!.steps[2]!.text).toBe('I should see "Apple Inc"')
    expect(result.pickles[1]!.steps[1]!.text).toBe('I search for "banana"')
    expect(result.pickles[1]!.steps[2]!.text).toBe('I should see "Banana Corp"')
  })

  test('handles Background steps', async () => {
    const path = await writeFeature('background.feature', `
Feature: Dashboard
  Background:
    Given I am logged in

  Scenario: View profile
    When I click on my profile
    Then I should see my name

  Scenario: View settings
    When I click on settings
    Then I should see settings page
`)

    const result = await parseFeatureFile(path)
    expect(result.pickles).toHaveLength(2)
    // Background step is prepended to each pickle
    expect(result.pickles[0]!.steps).toHaveLength(3)
    expect(result.pickles[0]!.steps[0]!.text).toBe('I am logged in')
    expect(result.pickles[1]!.steps).toHaveLength(3)
    expect(result.pickles[1]!.steps[0]!.text).toBe('I am logged in')
  })

  test('handles tags on scenarios', async () => {
    const path = await writeFeature('tags.feature', `
Feature: Tagged
  @smoke
  Scenario: Smoke test
    Given something

  @regression
  Scenario: Regression test
    Given something else
`)

    const result = await parseFeatureFile(path)
    expect(result.pickles[0]!.tags).toHaveLength(1)
    expect(result.pickles[0]!.tags[0]!.name).toBe('@smoke')
    expect(result.pickles[1]!.tags).toHaveLength(1)
    expect(result.pickles[1]!.tags[0]!.name).toBe('@regression')
  })

  test('returns file path in result', async () => {
    const path = await writeFeature('path.feature', `
Feature: Path Test
  Scenario: Test
    Given something
`)

    const result = await parseFeatureFile(path)
    expect(result.filePath).toBe(path)
  })
})

describe('parseFeatureFiles', () => {
  test('discovers files matching a glob', async () => {
    await writeFeature('glob1.feature', `
Feature: Glob One
  Scenario: Test
    Given something
`)
    await writeFeature('glob2.feature', `
Feature: Glob Two
  Scenario: Test
    Given something
`)

    const results = await parseFeatureFiles(join(fixtureDir, '*.feature'))
    expect(results.length).toBeGreaterThanOrEqual(2)
  })

  test('throws when no files match', async () => {
    expect(parseFeatureFiles('nonexistent/**/*.feature')).rejects.toThrow(
      'No .feature files found',
    )
  })
})

describe('filterPicklesByTag', () => {
  test('filters by tag with @ prefix', async () => {
    const path = await writeFeature('filter.feature', `
Feature: Filter
  @smoke
  Scenario: A
    Given step a

  @regression
  Scenario: B
    Given step b

  Scenario: C
    Given step c
`)

    const result = await parseFeatureFile(path)
    const filtered = filterPicklesByTag(result.pickles, '@smoke')
    expect(filtered).toHaveLength(1)
    expect(filtered[0]!.name).toBe('A')
  })

  test('normalizes tags without @ prefix', async () => {
    const path = await writeFeature('filter2.feature', `
Feature: Filter 2
  @smoke
  Scenario: Smoky
    Given step
`)

    const result = await parseFeatureFile(path)
    const filtered = filterPicklesByTag(result.pickles, 'smoke')
    expect(filtered).toHaveLength(1)
    expect(filtered[0]!.name).toBe('Smoky')
  })

  test('returns empty array when no tags match', async () => {
    const path = await writeFeature('filter3.feature', `
Feature: Filter 3
  Scenario: No tags
    Given step
`)

    const result = await parseFeatureFile(path)
    const filtered = filterPicklesByTag(result.pickles, '@nonexistent')
    expect(filtered).toHaveLength(0)
  })
})

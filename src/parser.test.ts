import { test, expect, describe, beforeAll, afterAll } from 'bun:test'
import { parseFeatureFile, parseFeatureFiles, filterPicklesByTag, hasIgnoreTag } from './parser'
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

  test('accepts an array of glob patterns', async () => {
    await writeFeature('multi-a1.feature', `
Feature: Multi A
  Scenario: Test
    Given something
`)
    await writeFeature('multi-b1.feature', `
Feature: Multi B
  Scenario: Test
    Given something
`)

    const results = await parseFeatureFiles([
      join(fixtureDir, 'multi-a*.feature'),
      join(fixtureDir, 'multi-b*.feature'),
    ])
    expect(results.length).toBe(2)
    expect(results.map(r => r.featureName)).toContain('Multi A')
    expect(results.map(r => r.featureName)).toContain('Multi B')
  })

  test('deduplicates files matched by overlapping patterns', async () => {
    await writeFeature('overlap.feature', `
Feature: Overlap
  Scenario: Test
    Given something
`)

    const results = await parseFeatureFiles([
      join(fixtureDir, 'overlap*.feature'),
      join(fixtureDir, 'over*.feature'),
    ])
    const overlapResults = results.filter(r => r.featureName === 'Overlap')
    expect(overlapResults.length).toBe(1)
  })

  test('throws with all patterns listed when no files match', async () => {
    expect(
      parseFeatureFiles(['nonexistent-a/**/*.feature', 'nonexistent-b/**/*.feature']),
    ).rejects.toThrow(
      'No .feature files found matching pattern: nonexistent-a/**/*.feature, nonexistent-b/**/*.feature',
    )
  })
})

describe('i18n support', () => {
  test('parses Portuguese feature file with language parameter', async () => {
    const path = await writeFeature('pt.feature', `
Funcionalidade: Busca
  Cenário: Visitar página principal
    Dado eu estou na página principal
    Quando eu digito "Brasil" no campo de busca
    Então eu devo ver resultados relacionados ao Brasil
`)

    const result = await parseFeatureFile(path, 'pt')
    expect(result.featureName).toBe('Busca')
    expect(result.pickles).toHaveLength(1)
    expect(result.pickles[0]!.name).toBe('Visitar página principal')
    expect(result.pickles[0]!.steps).toHaveLength(3)
  })

  test('parses Spanish feature file with language parameter', async () => {
    const path = await writeFeature('es.feature', `
Característica: Búsqueda
  Escenario: Visitar página principal
    Dado estoy en la página principal
    Cuando ingreso "test" en el campo de búsqueda
    Entonces debería ver resultados
`)

    const result = await parseFeatureFile(path, 'es')
    expect(result.featureName).toBe('Búsqueda')
    expect(result.pickles).toHaveLength(1)
    expect(result.pickles[0]!.steps).toHaveLength(3)
  })

  test('per-file language comment overrides default', async () => {
    const path = await writeFeature('language-comment.feature', `# language: fr
Fonctionnalité: Connexion
  Scénario: Connexion valide
    Soit je suis sur la page de connexion
    Quand je saisis des identifiants valides
    Alors je devrais voir le tableau de bord
`)

    // Pass 'en' as default, but the file declares 'fr'
    const result = await parseFeatureFile(path, 'en')
    expect(result.featureName).toBe('Connexion')
    expect(result.pickles).toHaveLength(1)
    expect(result.pickles[0]!.steps).toHaveLength(3)
  })

  test('defaults to English when no language is specified', async () => {
    const path = await writeFeature('default-en.feature', `
Feature: Default
  Scenario: English test
    Given something
    When I do something
    Then I see something
`)

    const result = await parseFeatureFile(path)
    expect(result.featureName).toBe('Default')
    expect(result.pickles).toHaveLength(1)
    expect(result.pickles[0]!.steps).toHaveLength(3)
  })

  test('parseFeatureFiles passes language to each file', async () => {
    await writeFeature('i18n-es1.feature', `
Característica: Primera
  Escenario: Prueba
    Dado algo
`)
    await writeFeature('i18n-es2.feature', `
Característica: Segunda
  Escenario: Prueba
    Dado algo mas
`)

    const results = await parseFeatureFiles(join(fixtureDir, 'i18n-es*.feature'), 'es')
    expect(results.length).toBe(2)
    for (const r of results) {
      expect(r.pickles).toHaveLength(1)
    }
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

describe('hasIgnoreTag', () => {
  test('returns true for pickle with @ignore tag', async () => {
    const path = await writeFeature('ignore1.feature', `
Feature: Ignore
  @ignore
  Scenario: Ignored
    Given step
`)

    const result = await parseFeatureFile(path)
    expect(hasIgnoreTag(result.pickles[0]!)).toBe(true)
  })

  test('returns false for pickle without @ignore tag', async () => {
    const path = await writeFeature('ignore2.feature', `
Feature: No Ignore
  Scenario: Normal
    Given step
`)

    const result = await parseFeatureFile(path)
    expect(hasIgnoreTag(result.pickles[0]!)).toBe(false)
  })

  test('returns false for pickle with other tags but not @ignore', async () => {
    const path = await writeFeature('ignore3.feature', `
Feature: Other Tags
  @smoke @regression
  Scenario: Tagged
    Given step
`)

    const result = await parseFeatureFile(path)
    expect(hasIgnoreTag(result.pickles[0]!)).toBe(false)
  })

  test('detects @ignore inherited from feature level', async () => {
    const path = await writeFeature('ignore4.feature', `
@ignore
Feature: Ignored Feature
  Scenario: Inherits ignore
    Given step
`)

    const result = await parseFeatureFile(path)
    expect(hasIgnoreTag(result.pickles[0]!)).toBe(true)
  })
})

import { type Dispatch, type SetStateAction, useEffect, useState } from 'react'
import { Button } from '../../components/ui/button'
import { SettingField } from './setting-field'
import type {
  ConfigurableProject,
  SettingsProps,
  StudioSuite,
} from './settings-types'
import { commaSeparatedValues, reasonMessage } from './settings-utils'

const specificationStates = ['draft', 'active', 'deprecated'] as const

function pathsText(paths: StudioSuite['paths']): string {
  if (!paths) return ''
  if (typeof paths === 'string') return paths
  return paths.join(', ')
}

function initialSuiteEditor(suites: readonly StudioSuite[] | undefined) {
  const suite = suites?.[0]
  return {
    name: suite?.name ?? '',
    paths: pathsText(suite?.paths),
    tags: suite?.tagExpression ?? '',
    states: (suite?.states ?? ['active']).join(', '),
    scenario: suite?.scenarioName ?? '',
  }
}

function suiteConfiguration(suite: StudioSuite) {
  return {
    ...(suite.paths ? { paths: suite.paths } : {}),
    ...(suite.tagExpression ? { tagExpression: suite.tagExpression } : {}),
    ...(suite.states ? { states: suite.states } : {}),
    ...(suite.scenarioName ? { scenarioName: suite.scenarioName } : {}),
  }
}

function existingSuites(suites: readonly StudioSuite[] | undefined) {
  return Object.fromEntries(
    (suites ?? []).map((suite) => [suite.name, suiteConfiguration(suite)]),
  )
}

function editedSuiteConfiguration(input: {
  paths: string
  tags: string
  states: string
  scenario: string
}) {
  const paths = commaSeparatedValues(input.paths)
  const states = commaSeparatedValues(input.states).filter(
    (state): state is (typeof specificationStates)[number] =>
      specificationStates.includes(
        state as (typeof specificationStates)[number],
      ),
  )
  return {
    ...(paths.length ? { paths } : {}),
    ...(input.tags.trim() ? { tagExpression: input.tags.trim() } : {}),
    ...(states.length ? { states } : {}),
    ...(input.scenario.trim() ? { scenarioName: input.scenario.trim() } : {}),
  }
}

function SuiteSelector(props: {
  suites: readonly StudioSuite[]
  selectedName: string
  onSelect: (suite: StudioSuite) => void
  onNew: () => void
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {props.suites.map((suite) => (
        <Button
          key={suite.name}
          type="button"
          size="sm"
          variant={suite.name === props.selectedName ? 'default' : 'outline'}
          aria-pressed={suite.name === props.selectedName}
          onClick={() => props.onSelect(suite)}
        >
          {suite.name}
        </Button>
      ))}
      <Button type="button" size="sm" variant="outline" onClick={props.onNew}>
        New test suite
      </Button>
    </div>
  )
}

function useSuiteFieldSync(
  suites: readonly StudioSuite[] | undefined,
  selectedName: string,
  setters: {
    paths: Dispatch<SetStateAction<string>>
    tags: Dispatch<SetStateAction<string>>
    states: Dispatch<SetStateAction<string>>
    scenario: Dispatch<SetStateAction<string>>
  },
): void {
  const { paths, tags, states, scenario } = setters
  useEffect(() => {
    if (!selectedName) {
      paths('')
      tags('')
      states('active')
      scenario('')
      return
    }
    const suite = suites?.find((item) => item.name === selectedName)
    if (!suite) return
    paths(pathsText(suite.paths))
    tags(suite.tagExpression ?? '')
    states((suite.states ?? ['active']).join(', '))
    scenario(suite.scenarioName ?? '')
  }, [paths, scenario, selectedName, states, suites, tags])
}

export function SuiteSettings<T extends ConfigurableProject>(
  props: SettingsProps<T>,
) {
  const editor = useSuiteEditor(props.project.suiteDetails)
  const save = () => void saveSuite(props, editor)
  return (
    <section
      className="space-y-4 border-t border-border pt-5"
      aria-labelledby="suites-heading"
    >
      <h2 id="suites-heading" className="studio-display text-sm">
        Test suites
      </h2>
      <SuiteSelector
        suites={props.project.suiteDetails ?? []}
        selectedName={editor.originalName}
        onSelect={editor.select}
        onNew={editor.create}
      />
      <SuiteFields {...editor.fields} />
      <Button type="button" onClick={save}>
        Save test suite
      </Button>
    </section>
  )
}

function useSuiteEditor(suites: readonly StudioSuite[] | undefined) {
  const initialSuite = initialSuiteEditor(suites)
  const [suiteName, setSuiteName] = useState(initialSuite.name)
  const [originalSuiteName, setOriginalSuiteName] = useState(suiteName)
  const [suitePaths, setSuitePaths] = useState(initialSuite.paths)
  const [suiteTags, setSuiteTags] = useState(initialSuite.tags)
  const [suiteStates, setSuiteStates] = useState(initialSuite.states)
  const [suiteScenario, setSuiteScenario] = useState(initialSuite.scenario)
  useSuiteFieldSync(suites, originalSuiteName, {
    paths: setSuitePaths,
    tags: setSuiteTags,
    states: setSuiteStates,
    scenario: setSuiteScenario,
  })
  const select = (suite: StudioSuite) => {
    setSuiteName(suite.name)
    setOriginalSuiteName(suite.name)
  }

  const create = () => {
    setSuiteName('')
    setOriginalSuiteName('')
    setSuitePaths('')
    setSuiteTags('')
    setSuiteStates('active')
    setSuiteScenario('')
  }

  return {
    create,
    fields: {
      name: suiteName,
      paths: suitePaths,
      tags: suiteTags,
      states: suiteStates,
      scenario: suiteScenario,
      onName: setSuiteName,
      onPaths: setSuitePaths,
      onTags: setSuiteTags,
      onStates: setSuiteStates,
      onScenario: setSuiteScenario,
    },
    originalName: originalSuiteName,
    select,
    setOriginalName: setOriginalSuiteName,
  }
}

async function saveSuite<T extends ConfigurableProject>(
  props: SettingsProps<T>,
  editor: ReturnType<typeof useSuiteEditor>,
) {
  const name = editor.fields.name.trim()
  if (!name) return props.onError('A test suite name is required')
  const suites = existingSuites(props.project.suiteDetails)
  suites[name] = editedSuiteConfiguration(editor.fields)
  if (editor.originalName && editor.originalName !== name)
    delete suites[editor.originalName]
  props.onError(undefined)
  try {
    props.onProject(
      await props.api<T>('/api/config', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ suites }),
      }),
    )
    editor.setOriginalName(name)
  } catch (reason) {
    props.onError(reasonMessage(reason))
  }
}

function SuiteFields(props: {
  name: string
  paths: string
  tags: string
  states: string
  scenario: string
  onName: (value: string) => void
  onPaths: (value: string) => void
  onTags: (value: string) => void
  onStates: (value: string) => void
  onScenario: (value: string) => void
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <SettingField
        id="suite-name"
        label="Suite name"
        value={props.name}
        onChange={props.onName}
      />
      <SettingField
        id="suite-paths"
        label="Paths"
        ariaLabel="Suite paths"
        value={props.paths}
        onChange={props.onPaths}
      />
      <SettingField
        id="suite-tags"
        label="Tag expression"
        ariaLabel="Suite tag expression"
        value={props.tags}
        onChange={props.onTags}
      />
      <SettingField
        id="suite-states"
        label="States"
        ariaLabel="Suite states"
        value={props.states}
        onChange={props.onStates}
      />
      <div className="sm:col-span-2">
        <SettingField
          id="suite-scenario"
          label="Scenario name"
          ariaLabel="Suite scenario name"
          value={props.scenario}
          onChange={props.onScenario}
        />
      </div>
    </div>
  )
}

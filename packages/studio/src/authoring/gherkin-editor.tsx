import './monaco-env'
import {
  type IDisposable,
  languages,
  editor as monacoEditor,
} from 'monaco-editor/editor/editor.api.js'
import 'monaco-editor/editor/editor.main.js'
import { useEffect, useRef } from 'react'
import {
  catalogFromSource,
  type GherkinCatalog,
  gherkinCompletions,
  gherkinMonarch,
} from './gherkin-language'
import { oklchToMonacoHex } from './monaco-theme-color'

let languageReady = false

const editorPalette = {
  canvas: 'oklch(0.183 0.002 286.18)',
  ink: 'oklch(0.88 0 0)',
  inkStrong: 'oklch(0.985 0 0)',
  body: 'oklch(0.76 0 0)',
  muted: 'oklch(0.6 0 0)',
  mutedSoft: 'oklch(0.45 0 0)',
  hairline: 'oklch(1 0 0 / 0.12)',
  hairlineStrong: 'oklch(1 0 0 / 0.14)',
  surfaceStrong: 'oklch(1 0 0 / 0.075)',
  canvasSoft: 'oklch(1 0 0 / 0.025)',
  scrollbar: 'oklch(1 0 0 / 0.14)',
  scrollbarHover: 'oklch(1 0 0 / 0.22)',
} as const

type EditorPaletteColor = keyof typeof editorPalette

function editorColor(color: EditorPaletteColor) {
  return oklchToMonacoHex(editorPalette[color])
}

function tokenColor(color: EditorPaletteColor) {
  return oklchToMonacoHex(editorPalette[color], { omitHash: true })
}

function registerGherkinLanguage(catalogRef: { current: GherkinCatalog }) {
  if (languageReady) return
  languageReady = true
  languages.register({
    id: 'gherkin',
    extensions: ['.feature'],
    aliases: ['Gherkin'],
  })
  languages.setMonarchTokensProvider(
    'gherkin',
    gherkinMonarch as languages.IMonarchLanguage,
  )
  languages.registerCompletionItemProvider('gherkin', {
    triggerCharacters: ['@', ' ', '\t'],
    provideCompletionItems(model, position) {
      const line = model
        .getLineContent(position.lineNumber)
        .slice(0, position.column - 1)
      const local = catalogFromSource(model.getValue())
      const items = gherkinCompletions({
        line,
        catalog: {
          tags: [...local.tags, ...catalogRef.current.tags],
          steps: [...local.steps, ...catalogRef.current.steps],
        },
      })
      const word = model.getWordUntilPosition(position)
      return {
        suggestions: items.map((item) => ({
          label: item.label,
          kind:
            item.kind === 'keyword'
              ? languages.CompletionItemKind.Keyword
              : item.kind === 'tag'
                ? languages.CompletionItemKind.Constant
                : languages.CompletionItemKind.Snippet,
          insertText: item.insertText,
          detail: item.detail,
          range: {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endColumn: word.endColumn,
          },
        })),
      }
    },
  })
  monacoEditor.defineTheme('pickle-studio-dark', {
    base: 'vs-dark',
    inherit: false,
    colors: {
      'editor.background': editorColor('canvas'),
      'editor.foreground': editorColor('ink'),
      'editorLineNumber.foreground': editorColor('mutedSoft'),
      'editorLineNumber.activeForeground': editorColor('body'),
      'editorCursor.foreground': editorColor('inkStrong'),
      'editor.selectionBackground': editorColor('hairline'),
      'editor.inactiveSelectionBackground': editorColor('surfaceStrong'),
      'editor.lineHighlightBackground': editorColor('canvasSoft'),
      'editorWidget.background': editorColor('canvas'),
      'editorWidget.border': editorColor('hairlineStrong'),
      'editorSuggestWidget.background': editorColor('canvas'),
      'editorSuggestWidget.border': editorColor('hairlineStrong'),
      'editorSuggestWidget.foreground': editorColor('ink'),
      'editorSuggestWidget.selectedBackground': editorColor('surfaceStrong'),
      'editorSuggestWidget.highlightForeground': editorColor('inkStrong'),
      focusBorder: editorColor('ink'),
      'scrollbarSlider.background': editorColor('scrollbar'),
      'scrollbarSlider.hoverBackground': editorColor('scrollbarHover'),
    },
    rules: [
      {
        token: 'keyword',
        foreground: tokenColor('inkStrong'),
        fontStyle: 'bold',
      },
      {
        token: 'comment',
        foreground: tokenColor('muted'),
      },
      {
        token: 'tag',
        foreground: tokenColor('body'),
      },
      {
        token: 'table',
        foreground: tokenColor('muted'),
      },
      {
        token: 'string',
        foreground: tokenColor('ink'),
      },
      {
        token: 'placeholder',
        foreground: tokenColor('body'),
      },
    ],
  })
}

export function GherkinEditor(props: {
  source: string
  catalog: GherkinCatalog
  onChange: (source: string) => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monacoEditor.IStandaloneCodeEditor | undefined>(
    undefined,
  )
  const catalogRef = useRef(props.catalog)
  const onChangeRef = useRef(props.onChange)
  const emittedSource = useRef(props.source)
  const initialSource = useRef(props.source)
  catalogRef.current = props.catalog
  onChangeRef.current = props.onChange

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    registerGherkinLanguage(catalogRef)
    const instance = monacoEditor.create(host, {
      value: initialSource.current,
      language: 'gherkin',
      theme: 'pickle-studio-dark',
      ariaLabel: 'Gherkin source',
      automaticLayout: true,
      fontFamily:
        '"JetBrains Mono Variable", "JetBrains Mono", ui-monospace, monospace',
      fontSize: 13,
      lineHeight: 20,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      padding: { top: 12, bottom: 12 },
      tabSize: 2,
      insertSpaces: true,
      wordWrap: 'on',
      renderLineHighlight: 'line',
      overviewRulerLanes: 0,
      hideCursorInOverviewRuler: true,
      scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
      quickSuggestions: { other: true, comments: false, strings: true },
      suggestOnTriggerCharacters: true,
      wordBasedSuggestions: 'off',
    })
    editorRef.current = instance
    const subscription: IDisposable = instance.onDidChangeModelContent(() => {
      const next = instance.getValue()
      emittedSource.current = next
      onChangeRef.current(next)
    })
    return () => {
      subscription.dispose()
      instance.dispose()
      editorRef.current = undefined
    }
  }, [])

  useEffect(() => {
    const instance = editorRef.current
    if (!instance) return
    if (props.source === emittedSource.current) return
    emittedSource.current = props.source
    if (instance.getValue() !== props.source) instance.setValue(props.source)
  }, [props.source])

  return (
    <div
      ref={hostRef}
      className="gherkin-editor-host relative z-10 h-full overflow-visible rounded-lg border border-border bg-secondary"
    />
  )
}

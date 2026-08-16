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

let languageReady = false

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
  monacoEditor.defineTheme('pickle-ledger', {
    base: 'vs-dark',
    inherit: false,
    colors: {
      'editor.background': '#2c2e34',
      'editor.foreground': '#e8eaee',
      'editorLineNumber.foreground': '#8b919c',
      'editorLineNumber.activeForeground': '#e8eaee',
      'editorCursor.foreground': '#e8eaee',
      'editor.selectionBackground': '#3d424c',
      'editor.inactiveSelectionBackground': '#32363e',
      'editor.lineHighlightBackground': '#32363e',
      'editorWidget.background': '#24262b',
      'editorWidget.border': '#8b919c29',
      'editorSuggestWidget.background': '#24262b',
      'editorSuggestWidget.border': '#8b919c29',
      'editorSuggestWidget.foreground': '#e8eaee',
      'editorSuggestWidget.selectedBackground': '#32363e',
      'editorSuggestWidget.highlightForeground': '#e8eaee',
      focusBorder: '#8b919c66',
      'scrollbarSlider.background': '#8b919c38',
      'scrollbarSlider.hoverBackground': '#8b919c55',
    },
    rules: [
      { token: 'keyword', foreground: 'e8eaee', fontStyle: 'bold' },
      { token: 'comment', foreground: 'a8adb8' },
      { token: 'tag', foreground: 'c5c9d0' },
      { token: 'table', foreground: 'a8adb8' },
      { token: 'string', foreground: 'd0d4dc' },
      { token: 'placeholder', foreground: 'c5c9d0' },
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
      theme: 'pickle-ledger',
      ariaLabel: 'Gherkin source',
      automaticLayout: true,
      fontFamily: '"JetBrains Mono", ui-monospace, monospace',
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
      className="relative z-10 h-[28rem] overflow-visible rounded-lg border border-border bg-secondary"
    />
  )
}

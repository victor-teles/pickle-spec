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
  monacoEditor.defineTheme('pickle-editorial', {
    base: 'vs',
    inherit: false,
    colors: {
      'editor.background': '#ffffff',
      'editor.foreground': '#292524',
      'editorLineNumber.foreground': '#a8a29e',
      'editorLineNumber.activeForeground': '#4e4e4e',
      'editorCursor.foreground': '#0c0a09',
      'editor.selectionBackground': '#e7e5e4',
      'editor.inactiveSelectionBackground': '#f0efed',
      'editor.lineHighlightBackground': '#fafafa',
      'editorWidget.background': '#ffffff',
      'editorWidget.border': '#d6d3d1',
      'editorSuggestWidget.background': '#ffffff',
      'editorSuggestWidget.border': '#d6d3d1',
      'editorSuggestWidget.foreground': '#292524',
      'editorSuggestWidget.selectedBackground': '#f0efed',
      'editorSuggestWidget.highlightForeground': '#0c0a09',
      focusBorder: '#292524',
      'scrollbarSlider.background': '#a8a29e55',
      'scrollbarSlider.hoverBackground': '#77716966',
    },
    rules: [
      { token: 'keyword', foreground: '0c0a09', fontStyle: 'bold' },
      { token: 'comment', foreground: '777169' },
      { token: 'tag', foreground: '4e4e4e' },
      { token: 'table', foreground: '777169' },
      { token: 'string', foreground: '292524' },
      { token: 'placeholder', foreground: '4e4e4e' },
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
      theme: 'pickle-editorial',
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
      className="relative z-10 h-[28rem] overflow-visible rounded-lg border border-border bg-secondary"
    />
  )
}

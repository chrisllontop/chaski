import {
  autocompletion,
  type CompletionContext,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { json } from '@codemirror/lang-json';
import {
  bracketMatching,
  indentOnInput,
  LRLanguage,
  syntaxHighlighting,
} from '@codemirror/language';
import { Compartment, EditorState } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  MatchDecorator,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';
import { parser as cssParser } from '@lezer/css';
import { classHighlighter } from '@lezer/highlight';
import { configureNesting, parser as htmlParser } from '@lezer/html';
import { cn } from 'cn';
import { useEffect, useRef } from 'react';
import { LIQUID_FILTERS, liquidFilterPrefix, liquidNamesAt, liquidReference } from '~/lib/liquid';

// CodeMirror writes its base styles at runtime, so they take the nonce the
// server put in the shell's CSP. Colors come from tok-* classes in styles.css.
const nonce = document.querySelector<HTMLMetaElement>('meta[name="chaski-nonce"]')?.content;

// Email HTML, with CSS inside <style> and style attributes. Emails run no
// script, so the JavaScript parser stays out of the bundle.
const emailHtml = LRLanguage.define({
  name: 'html',
  parser: htmlParser.configure({
    wrap: configureNesting(
      [{ tag: 'style', parser: cssParser }],
      [{ name: 'style', parser: cssParser.configure({ top: 'Styles' }) }],
    ),
  }),
  languageData: { commentTokens: { block: { open: '<!--', close: '-->' } } },
});

const liquidTags = new MatchDecorator({
  regexp: /\{\{.*?\}\}|\{%.*?%\}/g,
  decoration: Decoration.mark({ class: 'cm-liquid' }),
});

const liquidHighlight = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = liquidTags.createDeco(view);
    }
    update(update: ViewUpdate) {
      this.decorations = liquidTags.updateDeco(update, this.decorations);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

const liquidCompletions =
  (sample: Record<string, unknown> | null) => (context: CompletionContext) => {
    const line = context.state.doc.lineAt(context.pos);
    const before = line.text.slice(0, context.pos - line.from);
    const filter = liquidFilterPrefix(before);
    if (filter !== null) {
      return {
        from: context.pos - filter.length,
        options: LIQUID_FILTERS.map(({ name, usage }) => ({
          label: name,
          detail: usage,
          type: 'function',
        })),
        validFor: /^\w*$/,
      };
    }
    const reference = liquidReference(before);
    if (!reference) return null;
    if (!context.explicit && !reference.prefix && reference.path.length === 0) return null;
    return {
      from: context.pos - reference.prefix.length,
      options: liquidNamesAt(sample, reference.path).map((label) => ({ label, type: 'variable' })),
      validFor: /^\w*$/,
    };
  };

const languageFor = (language: 'html' | 'json', sample: Record<string, unknown> | null) =>
  language === 'json'
    ? json()
    : [
        emailHtml,
        liquidHighlight,
        autocompletion({ override: [liquidCompletions(sample)], icons: false }),
      ];

export const CodeEditor = ({
  value,
  onChange,
  language,
  sample = null,
  labelledBy,
  invalid = false,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  language: 'html' | 'json';
  /** Liquid completions offer this sample's names, plus `recipient`. */
  sample?: Record<string, unknown> | null;
  labelledBy: string;
  invalid?: boolean;
  className?: string;
}) => {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const languageSlot = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // The editor is created once; the effects below feed it later changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: value and language arrive through the effects below
  useEffect(() => {
    if (!host.current) return;
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          ...(nonce ? [EditorView.cspNonce.of(nonce)] : []),
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          history(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          syntaxHighlighting(classHighlighter),
          EditorView.lineWrapping,
          keymap.of([
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...historyKeymap,
            ...completionKeymap,
            indentWithTab,
          ]),
          languageSlot.current.of(languageFor(language, sample)),
          EditorView.contentAttributes.of({ 'aria-labelledby': labelledBy }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = editor;
    return () => {
      editor.destroy();
      view.current = null;
    };
  }, []);

  // Discarding changes or switching channels rewrites the document from outside.
  useEffect(() => {
    const editor = view.current;
    if (editor && editor.state.doc.toString() !== value) {
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } });
    }
  }, [value]);

  useEffect(() => {
    view.current?.dispatch({
      effects: languageSlot.current.reconfigure(languageFor(language, sample)),
    });
  }, [language, sample]);

  return (
    <div
      ref={host}
      data-slot="code-editor"
      aria-invalid={invalid || undefined}
      className={cn('code-editor', className)}
    />
  );
};

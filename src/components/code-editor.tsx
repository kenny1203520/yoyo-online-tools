"use client";

import { basicSetup } from "codemirror";
import { json } from "@codemirror/lang-json";
import { EditorState } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView, keymap } from "@codemirror/view";
import { defaultKeymap } from "@codemirror/commands";
import { useEffect, useRef } from "react";

export function CodeEditor({
  label,
  value,
  onChange,
  language = "text",
  dark = false,
  minHeight = 280,
  errorPosition,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  language?: "text" | "json";
  dark?: boolean;
  minHeight?: number;
  errorPosition?: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const latest = useRef({ onChange, value });

  useEffect(() => {
    latest.current = { onChange, value };
  }, [onChange, value]);

  useEffect(() => {
    if (!host.current) return;
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: latest.current.value,
        extensions: [
          basicSetup,
          keymap.of(defaultKeymap),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ "aria-label": label, spellcheck: "false" }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) latest.current.onChange(update.state.doc.toString());
          }),
          EditorView.theme({ "&": { minHeight: `${minHeight}px` }, ".cm-scroller": { fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace" } }),
          ...(language === "json" ? [json()] : []),
          ...(dark ? [oneDark] : []),
        ],
      }),
    });
    view.current = editor;
    return () => { editor.destroy(); view.current = null; };
  }, [dark, label, language, minHeight]);

  useEffect(() => {
    const editor = view.current;
    if (!editor || editor.state.doc.toString() === value) return;
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } });
  }, [value]);

  useEffect(() => {
    const editor = view.current;
    if (!editor || errorPosition === undefined) return;
    const position = Math.max(0, Math.min(errorPosition, editor.state.doc.length));
    editor.dispatch({ selection: { anchor: position }, effects: EditorView.scrollIntoView(position, { y: "center" }) });
    editor.focus();
  }, [errorPosition]);

  return <div className={`code-editor${dark ? " code-editor-dark" : ""}`} ref={host} />;
}

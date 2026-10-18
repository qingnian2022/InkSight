import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, drawSelection, keymap, placeholder } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { defaultHighlightStyle, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { markDirty, saveActive, state } from "../store";
import { formatCommands, syncEditorFlags } from "./viewRef";
import { typoraRendering } from "./typora";

const appKeymap = keymap.of([
  {
    key: "Mod-s",
    preventDefault: true,
    run: () => {
      void saveActive();
      return true;
    },
  },
  { key: "Mod-b", preventDefault: true, run: formatCommands.bold },
  { key: "Mod-i", preventDefault: true, run: formatCommands.italic },
  { key: "Mod-Shift-s", preventDefault: true, run: formatCommands.strike },
  { key: "Mod-e", preventDefault: true, run: formatCommands.code },
  { key: "Mod-k", preventDefault: true, run: formatCommands.link },
  indentWithTab,
]);

const syncListener = EditorView.updateListener.of((update) => {
  if (update.docChanged && state.activePath) {
    markDirty(state.activePath, update.state.doc.toString());
  }
  if (update.docChanged || update.selectionSet) {
    syncEditorFlags(update.state);
    const head = update.state.selection.main.head;
    const line = update.state.doc.lineAt(head);
    state.cursor = { line: line.number, col: head - line.from + 1 };
  }
});

export const editableCompartment = new Compartment();

export function createEditorState(doc: string): EditorState {
  return EditorState.create({
    doc,
    extensions: [
      history(),
      drawSelection(),
      EditorView.lineWrapping,
      indentOnInput(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      markdown({ base: markdownLanguage, addKeymap: true }),
      editableCompartment.of(EditorView.editable.of(!state.readonly)),
      typoraRendering,
      appKeymap,
      keymap.of([...defaultKeymap, ...historyKeymap]),
      placeholder("开始写作。用 # 加空格写标题，光标移开就会渲染。"),
      syncListener,
    ],
  });
}

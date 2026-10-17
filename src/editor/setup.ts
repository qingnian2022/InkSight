import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, drawSelection, keymap, placeholder } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { defaultHighlightStyle, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { markDirty, saveActive, state, updateCursor } from "../store";
import { formatBold, formatCode, formatItalic, formatStrike, insertLink } from "./commands";
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
  { key: "Mod-b", preventDefault: true, run: formatBold },
  { key: "Mod-i", preventDefault: true, run: formatItalic },
  { key: "Mod-Shift-s", preventDefault: true, run: formatStrike },
  { key: "Mod-e", preventDefault: true, run: formatCode },
  { key: "Mod-k", preventDefault: true, run: insertLink },
  indentWithTab,
]);

const syncListener = EditorView.updateListener.of((update) => {
  if (update.docChanged && state.activePath) {
    markDirty(state.activePath, update.state.doc.toString());
  }
  if (update.selectionSet || update.docChanged) {
    const head = update.state.selection.main.head;
    const line = update.state.doc.lineAt(head);
    updateCursor(line.number, head - line.from + 1);
  }
});

export const renderCompartment = new Compartment();

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
      renderCompartment.of(typoraRendering),
      appKeymap,
      keymap.of([...defaultKeymap, ...historyKeymap]),
      placeholder("开始写作。用 # 加空格写标题，用 ** 包住文字加粗。"),
      syncListener,
    ],
  });
}

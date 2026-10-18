import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";

/**
 * 富文本模式里代码块的 CodeMirror 主题。
 * 颜色全部走 CSS 变量（tokens.css 的 --syn-*），切深浅色时不用重建编辑器。
 */
const highlight = HighlightStyle.define([
  {
    tag: [tags.keyword, tags.operatorKeyword, tags.controlKeyword, tags.modifier],
    color: "var(--syn-keyword)",
  },
  {
    tag: [tags.string, tags.special(tags.string), tags.regexp],
    color: "var(--syn-string)",
  },
  {
    tag: [tags.number, tags.bool, tags.null, tags.atom],
    color: "var(--syn-number)",
  },
  {
    tag: [tags.comment, tags.lineComment, tags.blockComment],
    color: "var(--syn-comment)",
    fontStyle: "italic",
  },
  {
    tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
    color: "var(--syn-function)",
  },
  {
    tag: [tags.typeName, tags.className, tags.namespace, tags.tagName],
    color: "var(--syn-type)",
  },
  {
    tag: [tags.propertyName, tags.attributeName],
    color: "var(--text-primary)",
  },
  {
    tag: [tags.operator, tags.punctuation, tags.bracket],
    color: "var(--syn-punct)",
  },
  { tag: tags.variableName, color: "var(--text-primary)" },
  { tag: tags.link, color: "var(--syn-function)", textDecoration: "underline" },
]);

export const codeTheme = [
  EditorView.theme({
    "&": {
      backgroundColor: "transparent",
      color: "var(--text-primary)",
      fontSize: "13px",
    },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": {
      fontFamily: "var(--font-mono)",
      lineHeight: "1.65",
    },
    ".cm-content": { padding: "0", caretColor: "var(--accent)" },
    ".cm-line": { padding: "0 16px 0 2px" },
    ".cm-gutters": {
      backgroundColor: "transparent",
      border: "none",
      color: "var(--text-tertiary)",
      paddingLeft: "12px",
    },
    ".cm-lineNumbers .cm-gutterElement": {
      minWidth: "16px",
      padding: "0 2px 0 0",
      fontSize: "11.5px",
      opacity: "0.55",
    },
    // 折叠箭头在代码块里只会添乱，隐藏
    ".cm-foldGutter": { display: "none" },
    ".cm-activeLine": { backgroundColor: "transparent" },
    ".cm-activeLineGutter": {
      backgroundColor: "transparent",
      color: "var(--text-tertiary)",
      opacity: "0.8",
    },
    ".cm-cursor": {
      borderLeftColor: "var(--accent)",
      borderLeftWidth: "1.5px",
    },
    ".cm-selectionBackground, ::selection": {
      backgroundColor: "var(--accent-soft) !important",
    },
  }),
  syntaxHighlighting(highlight),
];

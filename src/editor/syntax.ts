import { HighlightStyle } from "@codemirror/language";
import { tags } from "@lezer/highlight";

/**
 * 代码块内的语法配色。
 * 颜色全部走 CSS 变量（见 tokens.css 的 --syn-*），切换深浅色时不用重建编辑器。
 */
export const syntaxHighlight = HighlightStyle.define([
  {
    tag: [tags.keyword, tags.operatorKeyword, tags.controlKeyword, tags.modifier],
    color: "var(--syn-keyword)",
  },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: "var(--syn-string)" },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: "var(--syn-number)" },
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
  { tag: [tags.propertyName, tags.attributeName], color: "var(--syn-function)" },
  { tag: [tags.operator, tags.punctuation, tags.bracket], color: "var(--syn-punct)" },
  {
    tag: [tags.definition(tags.variableName), tags.local(tags.variableName)],
    color: "var(--text-primary)",
  },
]);

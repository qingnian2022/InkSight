<script setup lang="ts">
import {
  cycleHeading,
  doRedo,
  doUndo,
  formatBold,
  formatCode,
  formatItalic,
  formatOl,
  formatQuote,
  formatStrike,
  formatTask,
  formatUl,
  insertCodeBlock,
  insertImage,
  insertLink,
  insertRule,
} from "../editor/commands";
import { removeActiveDoc, state, toggleTheme } from "../store";
import Icon from "./Icon.vue";
</script>

<template>
  <div class="toolbar" role="toolbar" aria-label="格式工具">
    <button class="tool-btn" title="撤销 Ctrl+Z" aria-label="撤销" @click="doUndo">
      <Icon name="undo" :size="15" />
    </button>
    <button class="tool-btn" title="重做 Ctrl+Shift+Z" aria-label="重做" @click="doRedo">
      <Icon name="redo" :size="15" />
    </button>

    <span class="tool-sep" />

    <button class="tool-btn" title="切换标题级别" aria-label="标题级别" @click="cycleHeading">
      <span class="glyph">H</span>
    </button>
    <button class="tool-btn" title="加粗 Ctrl+B" aria-label="加粗" @click="formatBold">
      <span class="glyph b">B</span>
    </button>
    <button class="tool-btn" title="斜体 Ctrl+I" aria-label="斜体" @click="formatItalic">
      <span class="glyph i">I</span>
    </button>
    <button class="tool-btn" title="删除线 Ctrl+Shift+S" aria-label="删除线" @click="formatStrike">
      <span class="glyph s">S</span>
    </button>
    <button class="tool-btn" title="行内代码 Ctrl+E" aria-label="行内代码" @click="formatCode">
      <span class="glyph m">&lt;/&gt;</span>
    </button>
    <button class="tool-btn" title="插入链接 Ctrl+K" aria-label="插入链接" @click="insertLink">
      <Icon name="link" :size="15" />
    </button>

    <span class="tool-sep" />

    <button class="tool-btn" title="无序列表" aria-label="无序列表" @click="formatUl">
      <Icon name="ul" :size="15" />
    </button>
    <button class="tool-btn" title="有序列表" aria-label="有序列表" @click="formatOl">
      <Icon name="ol" :size="15" />
    </button>
    <button class="tool-btn" title="任务列表" aria-label="任务列表" @click="formatTask">
      <Icon name="task" :size="15" />
    </button>
    <button class="tool-btn" title="引用" aria-label="引用" @click="formatQuote">
      <Icon name="quote" :size="15" />
    </button>
    <button class="tool-btn" title="代码块" aria-label="代码块" @click="insertCodeBlock">
      <Icon name="code" :size="15" />
    </button>
    <button class="tool-btn" title="分割线" aria-label="分割线" @click="insertRule">
      <Icon name="rule" :size="15" />
    </button>

    <span class="tool-sep opt" />

    <button class="tool-btn opt" title="插入图片（路径占位，P1 做粘贴落盘）" aria-label="插入图片" @click="insertImage">
      <Icon name="image" :size="15" />
    </button>

    <span class="toolbar-spacer" />

    <button
      class="tool-btn"
      :aria-pressed="state.outlineOpen"
      title="大纲 Ctrl+Shift+O"
      aria-label="大纲"
      @click="state.outlineOpen = !state.outlineOpen"
    >
      <Icon name="outline" :size="15" />
    </button>
    <button
      class="tool-btn"
      :aria-pressed="!state.sourceMode"
      title="即时渲染 / 纯源码"
      aria-label="切换即时渲染"
      @click="state.sourceMode = !state.sourceMode"
    >
      <Icon name="render" :size="15" />
    </button>
    <button class="tool-btn" title="切换浅色 / 深色" aria-label="切换主题" @click="toggleTheme">
      <Icon :name="state.theme === 'dark' ? 'sun' : 'moon'" :size="15" />
    </button>
    <button class="tool-btn" title="把当前文档移到 .trash" aria-label="移到回收站" @click="removeActiveDoc">
      <Icon name="trash" :size="15" />
    </button>
  </div>
</template>

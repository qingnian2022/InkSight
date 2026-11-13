<script setup lang="ts">
import { onMounted, ref } from "vue";
import {
  cancelEdit,
  categoryFilters,
  categoryTone,
  copySecret,
  editorCategories,
  formatUpdated,
  loadLocation,
  loadSecrets,
  removeSecret,
  saveEditing,
  secretsStore,
  selectSecret,
  selectedSecret,
  startCreate,
  startEdit,
  visibleSecrets,
} from "../secrets";
import Icon from "./Icon.vue";

const revealInEditor = ref(false);

onMounted(() => {
  void loadSecrets();
  void loadLocation();
});

function subtitleOf(item: { username: string; url: string }) {
  return item.username || item.url || "—";
}

const addingCategory = ref(false);
const newCategory = ref("");

function pickCategory(name: string) {
  secretsStore.editing.category = name;
  addingCategory.value = false;
}

function confirmCategory() {
  const name = newCategory.value.trim();
  if (name) secretsStore.editing.category = name;
  newCategory.value = "";
  addingCategory.value = false;
}

function closeEditor() {
  revealInEditor.value = false;
  addingCategory.value = false;
  cancelEdit();
}
</script>

<template>
  <section class="secrets-page" aria-label="凭据">
    <header class="secrets-head">
      <div class="secrets-title">
        <span>凭据</span>
        <span class="secrets-count">{{ secretsStore.items.length }}</span>
      </div>
      <div class="secrets-search">
        <Icon name="search" :size="12" />
        <input v-model="secretsStore.query" placeholder="搜索名称、账号、备注" />
      </div>
      <button class="secrets-new" @click="startCreate">
        <Icon name="plus" :size="11" />
        新建
      </button>
    </header>

    <div class="secrets-filters">
      <button
        v-for="filter in categoryFilters"
        :key="filter.name"
        class="pill"
        :class="{ on: secretsStore.filter === filter.name }"
        @click="secretsStore.filter = filter.name"
      >
        {{ filter.label }}
        <span class="pill-count">{{ filter.count }}</span>
      </button>
      <span class="secrets-spacer" />
      <span class="secrets-lock" :title="secretsStore.location">
        <Icon name="lock" :size="11" />
        本地加密
      </span>
    </div>

    <div class="secrets-body">
      <div class="secrets-list">
        <button
          v-for="item in visibleSecrets"
          :key="item.id"
          class="secret-row"
          :class="{ on: item.id === secretsStore.selectedId }"
          @click="selectSecret(item.id)"
        >
          <span class="secret-dot" :style="{ background: categoryTone(item.category).dot }" />
          <span class="secret-main">
            <span class="secret-line">
              <span class="secret-name">{{ item.name }}</span>
              <span class="secret-cat" :style="{ color: categoryTone(item.category).ink }">
                {{ item.category }}
              </span>
            </span>
            <span class="secret-sub">{{ subtitleOf(item) }}</span>
          </span>
        </button>

        <p v-if="!visibleSecrets.length && !secretsStore.loading" class="secrets-empty">
          {{ secretsStore.query ? "没有匹配的条目" : "还没有凭据，点右上角新建" }}
        </p>
      </div>

      <aside v-if="selectedSecret" class="secrets-detail">
        <div class="detail-head">
          <div>
            <div class="detail-name">{{ selectedSecret.name }}</div>
            <div class="detail-meta">更新于 {{ formatUpdated(selectedSecret.updated) }}</div>
          </div>
        </div>

        <div class="detail-tags">
          <span class="secret-cat" :style="{ color: categoryTone(selectedSecret.category).ink }">
            {{ selectedSecret.category }}
          </span>
          <span v-if="selectedSecret.url" class="detail-url">{{ selectedSecret.url }}</span>
        </div>

        <div v-if="selectedSecret.username" class="detail-field">
          <div class="detail-label">用户名 / 账号</div>
          <div class="detail-value">
            <span class="mono">{{ selectedSecret.username }}</span>
            <button class="copy-btn" title="复制" @click="copySecret(selectedSecret.username)">
              <Icon name="copy" :size="11" />
            </button>
          </div>
        </div>

        <div class="detail-field">
          <div class="detail-label">
            <span>{{ selectedSecret.category === "API Key" ? "密钥" : "密码" }}</span>
            <span class="detail-dim">{{ selectedSecret.secret.length }} 位</span>
          </div>
          <div class="detail-secret">
            <span class="mono" :class="{ masked: !secretsStore.revealed }">
              {{ secretsStore.revealed ? selectedSecret.secret : "•".repeat(Math.min(16, selectedSecret.secret.length || 8)) }}
            </span>
            <button
              class="copy-btn"
              :title="secretsStore.revealed ? '隐藏' : '显示'"
              @click="secretsStore.revealed = !secretsStore.revealed"
            >
              <Icon name="eye" :size="12" />
            </button>
            <button class="copy-btn" title="复制" @click="copySecret(selectedSecret.secret)">
              <Icon name="copy" :size="11" />
            </button>
          </div>
        </div>

        <div v-if="selectedSecret.note" class="detail-field">
          <div class="detail-label">备注</div>
          <div class="detail-note">{{ selectedSecret.note }}</div>
        </div>

        <div class="detail-actions">
          <button class="primary-btn" @click="copySecret(selectedSecret.secret)">
            <Icon name="copy" :size="11" />
            复制{{ selectedSecret.category === "API Key" ? "密钥" : "密码" }}
          </button>
          <div class="detail-links">
            <button @click="startEdit(selectedSecret)">编辑</button>
            <button class="danger" @click="removeSecret(selectedSecret)">删除</button>
          </div>
        </div>
      </aside>

      <aside v-else class="secrets-detail empty">
        <p>从左侧选择一条凭据查看详情</p>
        <span>数据加密存在安装目录的 <code>.secrets/</code> 里</span>
      </aside>
    </div>

    <div v-if="secretsStore.editingOpen" class="secrets-mask" @pointerdown.self="closeEditor">
      <form class="secrets-editor" @submit.prevent="saveEditing" @keydown.ctrl.enter.prevent="saveEditing">
        <header class="editor-head">
          <span>{{ secretsStore.editing.id ? "编辑凭据" : "新建凭据" }}</span>
          <button type="button" class="editor-close" @click="closeEditor">
            <Icon name="close" :size="13" />
          </button>
        </header>

        <label class="field">
          <span>名称</span>
          <input v-model="secretsStore.editing.name" placeholder="例如 GitHub / 阿里云 RAM" />
        </label>

        <div class="field">
          <span>分类</span>
          <div class="editor-cats">
            <button
              v-for="name in editorCategories"
              :key="name"
              type="button"
              class="pill"
              :class="{ on: secretsStore.editing.category === name }"
              @click="pickCategory(name)"
            >
              {{ name }}
            </button>

            <input
              v-if="addingCategory"
              v-model="newCategory"
              class="pill-input"
              placeholder="分类名"
              @keydown.enter.prevent="confirmCategory"
              @keydown.esc.prevent="addingCategory = false"
              @blur="confirmCategory"
            />
            <button v-else type="button" class="pill pill-add" @click="addingCategory = true">
              <Icon name="plus" :size="10" />
              新分类
            </button>

          </div>
        </div>

        <label class="field">
          <span>用户名 / 账号</span>
          <input v-model="secretsStore.editing.username" placeholder="选填" />
        </label>

        <label class="field">
          <span>密码 / 密钥</span>
          <div class="editor-secret">
            <input
              v-model="secretsStore.editing.secret"
              :type="revealInEditor ? 'text' : 'password'"
              placeholder="粘贴密码或 API Key"
            />
            <button type="button" class="copy-btn" @click="revealInEditor = !revealInEditor">
              <Icon name="eye" :size="12" />
            </button>
          </div>
        </label>

        <label class="field">
          <span>网址</span>
          <input v-model="secretsStore.editing.url" placeholder="选填" />
        </label>

        <label class="field">
          <span>备注</span>
          <textarea v-model="secretsStore.editing.note" rows="3" placeholder="选填" />
        </label>

        <footer class="editor-foot">
          <span class="editor-hint">加密后写入安装目录的 .secrets/</span>
          <span class="editor-buttons">
            <button type="button" class="ghost-btn" @click="closeEditor">取消</button>
            <button
              type="submit"
              class="primary-btn editor-save"
              :disabled="secretsStore.saving || !secretsStore.editing.name.trim()"
              :title="secretsStore.editing.name.trim() ? '保存 Ctrl+Enter' : '先填写名称'"
            >
              {{ secretsStore.saving ? "保存中…" : "保存" }}
            </button>
          </span>
        </footer>
      </form>
    </div>
  </section>
</template>

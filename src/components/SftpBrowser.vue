<script setup lang="ts">
import { open } from "@tauri-apps/plugin-dialog";
import { computed, onMounted, reactive, ref, watch } from "vue";
import {
  activeConn,
  beginRename,
  cancelRename,
  commitRename,
  connect,
  download,
  downloadTo,
  downloadWithPicker,
  enter,
  list,
  loadLocal,
  localEnter,
  localUp,
  sftpStore,
  up,
  type LocalEntry,
  type SftpEntry,
  type SftpProfile,
} from "../sftp";
import Icon from "./Icon.vue";

const form = reactive<SftpProfile>({
  id: "",
  name: "",
  host: "",
  port: 22,
  user: "",
  keyPath: "",
  password: "",
});

// 侧栏点「未连接」的配置时，把它的字段（含已保存的密码）填进表单
watch(
  () => sftpStore.draft,
  (draft) => {
    if (draft) Object.assign(form, draft);
  },
  { immediate: true },
);

const conn = computed(() => activeConn());
const showSecret = ref(false);

onMounted(() => {
  if (!sftpStore.localEntries.length) void loadLocal(sftpStore.localPath);
});

const crumbs = computed(() => {
  const parts = (sftpStore.path || "").split("/").filter(Boolean);
  let acc = "";
  return parts.map((part) => {
    acc += `/${part}`;
    return { name: part, path: acc };
  });
});

async function submit() {
  if (!form.host.trim() || sftpStore.loading) return;
  await connect({ ...form, id: form.id || form.host, name: form.name || form.host });
}

async function chooseKey() {
  const picked = await open({ multiple: false, title: "选择私钥文件" });
  if (typeof picked === "string") form.keyPath = picked;
}

function go(path: string) {
  void list(path);
}

function formatSize(bytes: number) {
  if (!bytes) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

function formatTime(seconds: number) {
  if (!seconds) return "—";
  const date = new Date(seconds * 1000);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes(),
  ).padStart(2, "0")}`;
}

function onRowClick(entry: SftpEntry) {
  sftpStore.selected = entry;
}

function onRowDouble(entry: SftpEntry) {
  if (entry.dir) enter(entry);
  else void download(entry);
}

/** 重命名输入框挂载后全选，和资源管理器的 F2 一致 */
function focusRename(el: unknown) {
  if (!(el instanceof HTMLInputElement)) return;
  el.focus();
  el.select();
}

function onRenameBlur(entry: SftpEntry, event: FocusEvent) {
  // 回车 / Esc 已经结束重命名时不再提交，否则 Esc 会把输入写回去
  if (sftpStore.renamingPath !== entry.path) return;
  void commitRename(entry, (event.target as HTMLInputElement).value);
}

/* ---------- 拖拽：远端 → 本地 ---------- */

/** 正在悬停的本地目录行（空串 = 面板本身） */
const hoverRow = ref("");
const hoverPane = ref(false);

function onDragStart(event: DragEvent, entry: SftpEntry) {
  if (!event.dataTransfer) return;
  // 只带路径，不带内容：真正的传输交给后端命令
  event.dataTransfer.setData("text/plain", entry.path);
  event.dataTransfer.effectAllowed = "copy";
  sftpStore.dragPath = entry.path;
}

function onDragEnd() {
  sftpStore.dragPath = "";
  hoverRow.value = "";
  hoverPane.value = false;
}

function onPaneDragOver(event: DragEvent) {
  if (!sftpStore.dragPath) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  hoverPane.value = true;
  hoverRow.value = "";
}

function onPaneDragLeave() {
  hoverPane.value = false;
}

function onRowDragOver(event: DragEvent, entry: LocalEntry) {
  if (!sftpStore.dragPath || !entry.dir) return;
  event.preventDefault();
  event.stopPropagation();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  hoverRow.value = entry.path;
  hoverPane.value = false;
}

function onDrop(event: DragEvent, dir: string) {
  event.preventDefault();
  event.stopPropagation();
  const remotePath = event.dataTransfer?.getData("text/plain") || sftpStore.dragPath;
  hoverRow.value = "";
  hoverPane.value = false;
  sftpStore.dragPath = "";
  if (!remotePath) return;
  // 停在「此电脑」盘符列表时没有具体目录，让用户选一次
  if (dir) void downloadTo(remotePath, dir);
  else void downloadWithPicker(remotePath);
}
</script>

<template>
  <section v-if="conn" class="sftp-pane" aria-label="远程文件">
    <div class="sftp-work">
      <!-- 左：本地 -->
      <section
        class="sftp-side"
        :class="{ 'drop-pane': hoverPane }"
        @dragover="onPaneDragOver"
        @dragleave="onPaneDragLeave"
        @drop="onDrop($event, sftpStore.localPath)"
      >
        <header class="sftp-side-bar">
          <button class="tool-btn" title="上一级" aria-label="本地上一级" @click="localUp">
            <Icon name="arrow-up" :size="15" />
          </button>
          <button
            class="tool-btn"
            title="刷新"
            aria-label="刷新本地"
            @click="loadLocal(sftpStore.localPath)"
          >
            <Icon name="refresh" :size="15" />
          </button>
          <span class="sftp-side-title" :title="sftpStore.localPath">
            {{ sftpStore.localPath || "此电脑" }}
          </span>
        </header>

        <div class="sftp-th">
          <span class="c-name">名称</span>
          <span class="c-size">大小</span>
          <span class="c-time">修改时间</span>
        </div>

        <div class="sftp-rows">
          <div
            v-for="entry in sftpStore.localEntries"
            :key="entry.path"
            class="sftp-row"
            :class="{
              on: sftpStore.localSelected?.path === entry.path,
              'drop-row': hoverRow === entry.path,
            }"
            role="button"
            tabindex="0"
            @click="sftpStore.localSelected = entry"
            @dblclick="localEnter(entry)"
            @keydown.enter="localEnter(entry)"
            @dragover="onRowDragOver($event, entry)"
            @drop="onDrop($event, entry.dir ? entry.path : sftpStore.localPath)"
          >
            <span class="c-name">
              <Icon :name="entry.dir ? 'folder' : 'file'" :size="14" />
              <span class="sftp-name">{{ entry.name }}</span>
            </span>
            <span class="c-size">{{ entry.dir ? "" : formatSize(entry.size) }}</span>
            <span class="c-time">{{ formatTime(entry.modified) }}</span>
          </div>

          <p v-if="!sftpStore.localEntries.length" class="sftp-empty">目录为空</p>
        </div>

        <footer class="sftp-foot">
          {{ hoverPane ? "松手：下载到当前目录" : "从右侧把文件拖进来即可下载" }}
        </footer>
      </section>

      <!-- 右：远端 -->
      <section class="sftp-side">
        <header class="sftp-side-bar">
          <button class="tool-btn" title="上一级" aria-label="远端上一级" @click="up">
            <Icon name="arrow-up" :size="15" />
          </button>
          <button class="tool-btn" title="刷新" aria-label="刷新远端" @click="go(sftpStore.path)">
            <Icon name="refresh" :size="15" />
          </button>

          <nav class="sftp-crumbs" aria-label="远端路径">
            <button class="crumb" title="根目录" @click="go('/')">/</button>
            <template v-for="crumb in crumbs" :key="crumb.path">
              <span class="crumb-sep">/</span>
              <button class="crumb" :title="crumb.path" @click="go(crumb.path)">
                {{ crumb.name }}
              </button>
            </template>
          </nav>
        </header>

        <div class="sftp-th">
          <span class="c-name">名称</span>
          <span class="c-size">大小</span>
          <span class="c-time">修改时间</span>
        </div>

        <div class="sftp-rows">
          <div
            v-for="entry in sftpStore.entries"
            :key="entry.path"
            class="sftp-row"
            :class="{ on: sftpStore.selected?.path === entry.path }"
            role="button"
            tabindex="0"
            :data-entry-path="entry.path"
            :data-entry-dir="entry.dir ? '1' : '0'"
            :draggable="sftpStore.renamingPath !== entry.path"
            @click="onRowClick(entry)"
            @dblclick="onRowDouble(entry)"
            @keydown.enter="onRowDouble(entry)"
            @keydown.f2.prevent="beginRename(entry.path)"
            @dragstart="onDragStart($event, entry)"
            @dragend="onDragEnd"
          >
            <span class="c-name">
              <Icon :name="entry.dir ? 'folder' : 'file'" :size="14" />
              <input
                v-if="sftpStore.renamingPath === entry.path"
                :ref="focusRename"
                class="term-rename"
                :value="entry.name"
                @click.stop
                @dblclick.stop
                @keydown.enter.prevent="commitRename(entry, ($event.target as HTMLInputElement).value)"
                @keydown.esc.prevent="cancelRename"
                @blur="onRenameBlur(entry, $event)"
              />
              <span v-else class="sftp-name">{{ entry.name }}</span>
            </span>
            <span class="c-size">{{ entry.dir ? "" : formatSize(entry.size) }}</span>
            <span class="c-time">{{ formatTime(entry.modified) }}</span>
          </div>

          <p v-if="!sftpStore.entries.length && !sftpStore.loading" class="sftp-empty">空目录</p>
          <p v-if="sftpStore.loading" class="sftp-empty">读取中…</p>
        </div>

        <footer class="sftp-foot">
          <span v-if="sftpStore.error" class="err">{{ sftpStore.error }}</span>
          <span v-else-if="sftpStore.busy">下载中…</span>
          <span v-else>{{ sftpStore.entries.length }} 项 · 拖到左侧下载</span>
        </footer>
      </section>
    </div>
  </section>

  <section v-else class="sftp-connect" aria-label="新建 SFTP 连接">
    <form class="sftp-card" @submit.prevent="submit">
      <header class="sftp-card-head">
        <span class="sftp-badge"><Icon name="server" :size="17" /></span>
        <div class="sftp-card-intro">
          <h2>新建 SFTP 连接</h2>
          <p>连上后可浏览远端目录、拖拽下载；保存过的连接下次点一下就能连。</p>
        </div>
      </header>

      <div class="sftp-fields">
        <label class="field">
          <span>名称</span>
          <input v-model="form.name" placeholder="可留空，默认用主机名" />
        </label>

        <div class="sftp-row2">
          <label class="field grow">
            <span>主机</span>
            <input v-model="form.host" placeholder="192.168.1.10 或 example.com" />
          </label>
          <label class="field port">
            <span>端口</span>
            <input v-model.number="form.port" type="number" min="1" max="65535" />
          </label>
        </div>

        <label class="field">
          <span>用户名</span>
          <input v-model="form.user" placeholder="root" autocomplete="off" />
        </label>

        <label class="field">
          <span>密码</span>
          <div class="sftp-secret">
            <input
              v-model="form.password"
              :type="showSecret ? 'text' : 'password'"
              placeholder="留空则用私钥"
            />
            <button
              type="button"
              class="sftp-eye"
              :title="showSecret ? '隐藏密码' : '显示密码'"
              :aria-label="showSecret ? '隐藏密码' : '显示密码'"
              @click="showSecret = !showSecret"
            >
              <Icon name="eye" :size="14" />
            </button>
          </div>
        </label>

        <label class="field">
          <span>私钥（可选，填了就优先用密钥认证）</span>
          <div class="sftp-key">
            <input v-model="form.keyPath" placeholder="留空则用密码" />
            <button type="button" class="sftp-browse" @click="chooseKey">选择…</button>
          </div>
        </label>
      </div>

      <footer class="sftp-card-foot">
        <p class="sftp-note">
          连接信息与密码以明文保存在应用数据目录（<code>.sftp.json</code>），只适合个人机器；主机指纹首次连接直接信任。
        </p>
        <p v-if="sftpStore.error" class="err sftp-error">{{ sftpStore.error }}</p>
        <button
          type="submit"
          class="sftp-submit"
          :disabled="sftpStore.loading || !form.host.trim()"
        >
          <span v-if="sftpStore.loading" class="sftp-spin" aria-hidden="true" />
          {{ sftpStore.loading ? "连接中…" : "连接" }}
        </button>
      </footer>
    </form>
  </section>
</template>

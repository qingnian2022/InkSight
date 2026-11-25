<script setup lang="ts">
import { open } from "@tauri-apps/plugin-dialog";
import { computed, nextTick, onMounted, reactive, ref, watch } from "vue";
import {
  activeConn,
  beginRename,
  cancelCreateFolder,
  cancelTransfer,
  commitCreateFolder,
  cancelRename,
  commitRename,
  connect,
  clearFinishedTransfers,
  download,
  downloadMany,
  downloadManyWithPicker,
  enter,
  list,
  loadLocal,
  localEnter,
  localUp,
  openLocalPreferred,
  sftpStore,
  up,
  type LocalEntry,
  type SftpEntry,
  type SftpProfile,
  type TransferItem,
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
  if (!sftpStore.localEntries.length) void openLocalPreferred();
});

const crumbs = computed(() => {
  const parts = (sftpStore.path || "").split("/").filter(Boolean);
  let acc = "";
  return parts.map((part) => {
    acc += `/${part}`;
    return { name: part, path: acc };
  });
});

/** 端口只用文本框：数字类型的上下箭头在小尺寸下很挤，还容易被误点 */
function onPortInput(event: Event) {
  const el = event.target as HTMLInputElement;
  const digits = el.value.replace(/\D/g, "").slice(0, 5);
  if (el.value !== digits) el.value = digits;
  form.port = digits ? Math.min(65535, Number(digits)) : 0;
}

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

/** 进度的 0 要显示成 0 B，列表里的 formatSize 对 0 返回空串 */
function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return (value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)) + " " + units[unit];
}

function formatTime(seconds: number) {
  if (!seconds) return "—";
  const date = new Date(seconds * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate()) +
    " " + pad(date.getHours()) + ":" + pad(date.getMinutes());
}

/**
 * 按下时决定选中：带修饰键立即生效；普通按下只补选未选中项。
 * 普通点击「收拢选区」放到 click 里做 —— 拖拽会抑制 click，
 * 这样先选三行再拖其中一行，不会在 mousedown 时把另外两行丢掉。
 */
function onRowPress(entry: SftpEntry, event: MouseEvent) {
  if (event.button !== 0) return;
  const all = sftpStore.entries.map((item) => item.path);

  if (event.shiftKey && sftpStore.selected) {
    const from = all.indexOf(sftpStore.selected.path);
    const to = all.indexOf(entry.path);
    if (from >= 0 && to >= 0) {
      const lo = Math.min(from, to);
      const hi = Math.max(from, to);
      sftpStore.selectedPaths = all.slice(lo, hi + 1);
      sftpStore.selected = entry;
      return;
    }
  }

  if (event.ctrlKey || event.metaKey) {
    const on = sftpStore.selectedPaths.includes(entry.path);
    sftpStore.selectedPaths = on
      ? sftpStore.selectedPaths.filter((path) => path !== entry.path)
      : [...sftpStore.selectedPaths, entry.path];
    // 取消的正好是锚点：把锚点交给剩下的最后一项，下次 Shift 才从对的地方起算
    const remaining = sftpStore.selectedPaths[sftpStore.selectedPaths.length - 1];
    sftpStore.selected = on
      ? sftpStore.entries.find((item) => item.path === remaining) ?? null
      : entry;
    return;
  }

  if (!sftpStore.selectedPaths.includes(entry.path)) {
    sftpStore.selectedPaths = [entry.path];
  }
  sftpStore.selected = entry;
}

/* 本地栏：规则与远端一致 */
function onLocalPress(entry: LocalEntry, event: MouseEvent) {
  if (event.button !== 0) return;
  const all = sftpStore.localEntries.map((item) => item.path);

  if (event.shiftKey && sftpStore.localSelected) {
    const from = all.indexOf(sftpStore.localSelected.path);
    const to = all.indexOf(entry.path);
    if (from >= 0 && to >= 0) {
      const lo = Math.min(from, to);
      const hi = Math.max(from, to);
      sftpStore.localSelectedPaths = all.slice(lo, hi + 1);
      sftpStore.localSelected = entry;
      return;
    }
  }

  if (event.ctrlKey || event.metaKey) {
    const on = sftpStore.localSelectedPaths.includes(entry.path);
    sftpStore.localSelectedPaths = on
      ? sftpStore.localSelectedPaths.filter((path) => path !== entry.path)
      : [...sftpStore.localSelectedPaths, entry.path];
    const remaining = sftpStore.localSelectedPaths[sftpStore.localSelectedPaths.length - 1];
    sftpStore.localSelected = on
      ? sftpStore.localEntries.find((item) => item.path === remaining) ?? null
      : entry;
    return;
  }

  if (!sftpStore.localSelectedPaths.includes(entry.path)) {
    sftpStore.localSelectedPaths = [entry.path];
  }
  sftpStore.localSelected = entry;
}

function isLocalSelected(entry: LocalEntry) {
  return sftpStore.localSelectedPaths.includes(entry.path);
}

function isSelected(entry: SftpEntry) {
  return sftpStore.selectedPaths.includes(entry.path);
}

function onRowDouble(entry: SftpEntry) {
  if (entry.dir) enter(entry);
  else void download(entry);
}

/** 重命名 / 新建文件夹输入框：函数式 ref 每次都跑，已聚焦就别再 select */
const createInput = ref<HTMLInputElement | null>(null);
let createStartedAt = 0;

// 右键菜单关闭时会把焦点还给原来的元素，抢走输入框的焦点：
// 等一帧再聚焦，并给刚出现的输入框 300ms 的「防误提交」窗口
watch(
  () => sftpStore.creating,
  async (kind) => {
    if (!kind) return;
    createStartedAt = Date.now();
    await nextTick();
    requestAnimationFrame(() => {
      createInput.value?.focus();
      createInput.value?.select();
    });
  },
);

function onCreateBlur() {
  if (Date.now() - createStartedAt < 300) {
    createInput.value?.focus();
    return;
  }
  void commitCreateFolder();
}

function focusRename(el: unknown) {
  if (!(el instanceof HTMLInputElement)) return;
  if (document.activeElement === el) return;
  el.focus();
  el.select();
}

function onRenameBlur(entry: SftpEntry, event: FocusEvent) {
  if (sftpStore.renamingPath !== entry.path) return;
  void commitRename(entry, (event.target as HTMLInputElement).value);
}

/* ---------- 传输面板 ---------- */

const activeTransfers = computed(
  () => sftpStore.transfers.filter((t) => t.status === "queued" || t.status === "running"),
);
/** 正在传的排最前，其次排队（先来先走），已结束的按时间倒序 */
const visibleTransfers = computed(() => {
  const rank = (item: TransferItem) =>
    item.status === "running" ? 0 : item.status === "queued" ? 1 : 2;
  return [...sftpStore.transfers].sort((a, b) => {
    const delta = rank(a) - rank(b);
    if (delta !== 0) return delta;
    return rank(a) === 1 ? a.id - b.id : b.id - a.id;
  });
});

const hasFinished = computed(
  () => sftpStore.transfers.some((t) => t.status !== "queued" && t.status !== "running"),
);

function transferText(item: TransferItem) {
  if (item.status === "queued") return "排队中";
  if (item.status === "running") {
    if (!item.total) return "下载中 " + formatBytes(item.done);
    const pct = Math.min(100, Math.round((item.done / item.total) * 100));
    return pct + "% · " + formatBytes(item.done) + " / " + formatBytes(item.total);
  }
  if (item.status === "done") return "已完成";
  if (item.status === "canceled") return "已取消";
  return "失败";
}

function transferPercentOf(item: TransferItem) {
  if (!item.total) return 0;
  return Math.min(100, Math.round((item.done / item.total) * 100));
}

/* ---------- 拖拽：远端 → 本地 ---------- */

const hoverRow = ref("");
const hoverPane = ref(false);

function onDragStart(event: DragEvent, entry: SftpEntry) {
  if (!event.dataTransfer) return;
  // 拖的是「选中集合」里的任意一项，就整组带走；否则只带这一项
  const paths = sftpStore.selectedPaths.includes(entry.path)
    ? [...sftpStore.selectedPaths]
    : [entry.path];
  sftpStore.dragPaths = paths;
  event.dataTransfer.setData("text/plain", paths.join("\n"));
  event.dataTransfer.effectAllowed = "copy";
}

function onDragEnd() {
  sftpStore.dragPaths = [];
  hoverRow.value = "";
  hoverPane.value = false;
}

function onPaneDragOver(event: DragEvent) {
  if (!sftpStore.dragPaths.length) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  hoverPane.value = true;
  hoverRow.value = "";
}

function onPaneDragLeave() {
  hoverPane.value = false;
}

function onRowDragOver(event: DragEvent, entry: LocalEntry) {
  if (!sftpStore.dragPaths.length || !entry.dir) return;
  event.preventDefault();
  event.stopPropagation();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  hoverRow.value = entry.path;
  hoverPane.value = false;
}

function onDrop(event: DragEvent, dir: string) {
  event.preventDefault();
  event.stopPropagation();
  const raw = event.dataTransfer?.getData("text/plain") ?? "";
  const paths = (sftpStore.dragPaths.length ? sftpStore.dragPaths : raw.split("\n"))
    .map((path) => path.trim())
    .filter(Boolean);
  hoverRow.value = "";
  hoverPane.value = false;
  sftpStore.dragPaths = [];
  if (!paths.length) return;
  // 停在「此电脑」盘符列表时没有具体目录，让用户选一次
  if (dir) downloadMany(paths, dir);
  else void downloadManyWithPicker(paths);
}
</script>

<template>
  <section v-if="conn" class="sftp-pane" aria-label="远程文件">
    <div class="sftp-work">
      <!-- 左：本地 -->
      <section
        class="sftp-side"
        data-pane="local"
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
          <div v-if="sftpStore.creating === 'local'" class="sftp-row creating">
            <span class="c-name">
              <Icon name="folder" :size="14" />
              <input
                ref="createInput"
                v-model="sftpStore.newFolder"
                class="term-rename"
                placeholder="新建文件夹"
                @keydown.enter.prevent="commitCreateFolder"
                @keydown.esc.prevent="cancelCreateFolder"
                @blur="onCreateBlur"
              />
            </span>
          </div>
          <div
            v-for="entry in sftpStore.localEntries"
            :key="entry.path"
            class="sftp-row"
            :class="{
              on: isLocalSelected(entry),
              'drop-row': hoverRow === entry.path,
            }"
            role="button"
            tabindex="0"
            :data-local-path="entry.path"
            :data-local-dir="entry.dir ? '1' : '0'"
            @mousedown.left="onLocalPress(entry, $event)"
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
          <span v-if="sftpStore.localSelectedPaths.length > 1">
            已选 {{ sftpStore.localSelectedPaths.length }} 项 · 右键可删除
          </span>
          <span v-else>
            {{ hoverPane ? "松手：下载到当前目录" : "从右侧把文件拖进来即可下载" }}
          </span>
        </footer>
      </section>

      <!-- 右：远端 -->
      <section class="sftp-side" data-pane="remote">
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
          <div v-if="sftpStore.creating === 'remote'" class="sftp-row creating">
            <span class="c-name">
              <Icon name="folder" :size="14" />
              <input
                ref="createInput"
                v-model="sftpStore.newFolder"
                class="term-rename"
                placeholder="新建文件夹"
                @keydown.enter.prevent="commitCreateFolder"
                @keydown.esc.prevent="cancelCreateFolder"
                @blur="onCreateBlur"
              />
            </span>
          </div>
          <div
            v-for="entry in sftpStore.entries"
            :key="entry.path"
            class="sftp-row"
            :class="{ on: isSelected(entry) }"
            role="button"
            tabindex="0"
            :data-entry-path="entry.path"
            :data-entry-dir="entry.dir ? '1' : '0'"
            :draggable="sftpStore.renamingPath !== entry.path"
            @mousedown.left="onRowPress(entry, $event)"
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

        <div v-if="sftpStore.transfers.length" class="sftp-transfers">
          <div class="sftp-transfers-head">
            <span>传输 {{ activeTransfers.length }} / {{ sftpStore.transfers.length }}</span>
            <button v-if="hasFinished" class="sftp-link" @click="clearFinishedTransfers">清除已完成</button>
          </div>
          <div
            v-for="item in visibleTransfers"
            :key="item.id"
            class="sftp-transfer"
            :class="item.status"
          >
            <span class="sftp-transfer-name" :title="item.remotePath">{{ item.name }}</span>
            <span class="sftp-transfer-state">{{ transferText(item) }}</span>
            <span v-if="item.status === 'running' && item.total" class="sftp-transfer-bar">
              <i :style="{ width: transferPercentOf(item) + '%' }" />
            </span>
            <button
              v-if="item.status === 'queued' || item.status === 'running'"
              class="sftp-cancel"
              @click="cancelTransfer(item.id)"
            >
              取消
            </button>
          </div>
        </div>

        <footer class="sftp-foot">
          <span v-if="sftpStore.error" class="err">{{ sftpStore.error }}</span>
          <span v-else>
            {{ sftpStore.entries.length }} 项
            <template v-if="sftpStore.selectedPaths.length > 1">
              · 已选 {{ sftpStore.selectedPaths.length }} 项
            </template>
            · 拖到左侧下载
          </span>
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
            <input
              :value="form.port || ''"
              type="text"
              inputmode="numeric"
              autocomplete="off"
              placeholder="22"
              @input="onPortInput"
            />
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

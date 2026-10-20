# 方案：托盘图标 + 关闭即最小化到托盘

> 状态：**已实施（2026-10-20）**。预览：`docs/preview-tray.html`
> 形态：点窗口 ✕ 不退出，应用缩到系统托盘继续驻留（像语雀/微信桌面版）；托盘菜单可唤回窗口或真正退出。

---

## 1. 行为设计

| 操作 | 行为 |
|---|---|
| 点窗口 ✕ | 拦截关闭 → 隐藏窗口，进程驻留托盘；首次触发弹一次提示「md-rust 已最小化到托盘」（之后不再打扰） |
| 单击托盘图标 | 切换主窗口 显示 / 隐藏 |
| 双击托盘图标 | 显示主窗口并聚焦 |
| 托盘右键菜单 | 「打开 md-rust」「新建文档」「退出」 |
| 「退出」 | 真正退出：保存未落盘改动（前端 `flush` 不涉及——隐藏前已自动保存），`app.exit(0)` 整个进程结束 |

未保存风险：自动保存开着（默认）时停顿 0.8s 已写盘；关自动保存的用户在点 ✕ 前本就要自己负责保存，与现状一致，不额外拦截。

## 2. 技术实现（Tauri 2 原生托盘，纯 Rust 侧，前端零改动）

**Cargo.toml** — 开启 tauri 的托盘 feature：
```toml
tauri = { version = "2", features = ["tray-icon", "image-png"] }
```

**lib.rs** 核心改动（全部在 `run()` 里）：

```rust
// 1) 拦截 ✕：不退出，隐藏窗口
.on_window_event(|window, event| {
    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        window.hide().unwrap();
        api.prevent_close();
        // 首次隐藏时发事件给前端弹一次性提示（用 localStorage 记忆已提示过）
    }
})

// 2) setup 里建托盘
.setup(|app| {
    let toggle = MenuItem::with_id(app, "toggle", "打开 md-rust", true, None::<&str>)?;
    let new_doc = MenuItem::with_id(app, "new", "新建文档", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&toggle, &new_doc, &quit])?;

    TrayIconBuilder::with_id("main")
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .show_menu_on_left_click(false)   // 左键留给「切换窗口」
        .on_menu_event(|app, event| match event.id.as_ref() {
            "toggle" => show_main(app),
            "new"    => { show_main(app); /* emit "new-doc" 给前端 */ }
            "quit"   => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            // 双击 → 显示窗口
            if let TrayIconEvent::DoubleClick { .. } = event { show_main(tray.app_handle()); }
        })
        .build(app)?;
    Ok(())
})
```

- `show_main(app)`：`get_webview_window("main")` → `show()` + `unminimize()` + `set_focus()`；
- 「新建文档」：`emit("tray://new-doc")`，前端 `App.vue` 监听后调 `newDoc()`（约 3 行）；
- 托盘图标直接复用 `icons/icon.ico`（`default_window_icon`），无需新资源。

**capabilities/default.json**：托盘建在 Rust 侧，**不需要新增权限**。

## 3. 可选增强（建议一起做）

| 项 | 说明 |
|---|---|
| 单实例锁（**推荐**） | `tauri-plugin-single-instance`：托盘驻留后很容易忘掉已开着 → 二次启动时唤醒已有窗口而不是再开一个进程。加 1 个依赖 + 6 行 |
| 关闭确认设置项 | 设置里加「关闭时退出程序」开关（默认关 = 最小化到托盘），尊重习惯不同的用户。存 localStorage，通过事件传给 Rust 或改由前端拦截 |
| 关闭气泡提示 | Windows 托盘 tooltip「md-rust - 我的知识库」；首hide时 `notify` 一次 |

MVP 范围：托盘 + 关闭最小化 + 双击唤回 + 退出菜单 + tooltip；单实例建议同批加上（否则托盘场景下多开几乎是必然）。

## 4. 边界与风险

| 风险 | 处理 |
|---|---|
| 用户找不到退出口 | 托盘菜单「退出」+ 首次最小化提示文案写明「右键托盘图标可退出」 |
| 隐藏后 Rust 重编译（dev 模式） | `tauri dev` 热重载重启 exe 时旧托盘消失属正常，release 无此问题 |
| 多开导致数据竞争 | 单实例插件兜底 |
| 关机/注销时进程驻留 | Windows 关机对托盘进程正常发 WM_ENDSESSION，进程会被结束，md 文件已实时落盘无丢失风险 |
| 图标风格 | 沿用现有应用图标，不新画 |

## 5. 实施步骤

1. `Cargo.toml` 开 `tray-icon` + `image-png` feature
2. `lib.rs`：CloseRequested 拦截 → 托盘构建 → 菜单事件 → 双击事件
3. `App.vue` 监听 `tray://new-doc`（3 行）+ 首次最小化提示
4. （同批）`tauri-plugin-single-instance` 单实例锁
5. 验证：✕ 隐藏、单击切换、双击唤回、菜单退出、退出后进程消失

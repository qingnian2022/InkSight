//! 托盘常驻与窗口唤回：托盘菜单（打开 / 新建文档 / 退出）、双击图标、
//! 单实例二次启动，统一走 `show_main`。

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager};

/// 显示并聚焦主窗口（托盘菜单 / 双击图标 / 单实例二次启动共用）。
pub fn show_main(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

/// 应用 setup 阶段初始化托盘图标与菜单。
pub fn setup(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let toggle = MenuItem::with_id(app, "toggle", "打开 Inksight", true, None::<&str>)?;
    let new_doc = MenuItem::with_id(app, "new", "新建文档", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&toggle, &new_doc, &quit])?;

    TrayIconBuilder::with_id("main")
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("Inksight — 我的知识库")
        .menu(&menu)
        .show_menu_on_left_click(false) // 左键留给「切换窗口」
        .on_menu_event(|app, event| match event.id.as_ref() {
            "toggle" => show_main(app),
            "new" => {
                show_main(app);
                let _ = app.emit("tray://new-doc", ());
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::DoubleClick { .. } = event {
                show_main(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

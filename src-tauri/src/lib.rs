//! md-rust（见字如面）Tauri 后端入口。
//!
//! 代码按职责拆分：
//! - `app_paths`  应用级路径（数据目录 / 打开文件夹 / 版本信息）
//! - `vault`      知识库目录扫描（含置顶虚拟文件夹）
//! - `pins`       置顶列表持久化（.md-rust.json）
//! - `doc`        文档读写（原子写）
//! - `node`       节点操作（新建 / 复制 / 重命名 / 回收站）
//! - `asset`      图片导入
//! - `archive`    导入 / 导出（zip）
//! - `git_sync`   git 多机同步
//! - `tray`       托盘常驻与窗口唤回
//! - `util`       共享的文件 / 命名工具

mod app_paths;
mod archive;
mod asset;
mod doc;
mod git_sync;
mod node;
mod pins;
mod template;
mod tray;
mod util;
mod vault;

use tauri::Emitter;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // 单实例锁：托盘常驻后二次启动 → 唤回已有窗口，不再多开（必须是第一个插件）
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            tray::show_main(app);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        // 点 ✕ 不退出：隐藏窗口、进程驻留托盘；真正退出走托盘菜单「退出」
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.emit("tray://minimized", ());
                    let _ = window.hide();
                }
            }
        })
        .setup(|app| tray::setup(app))
        .invoke_handler(tauri::generate_handler![
            vault::vault_scan,
            doc::doc_read,
            doc::doc_write,
            node::doc_create,
            node::dir_create,
            node::node_copy,
            node::node_rename,
            node::node_trash,
            asset::asset_import,
            app_paths::app_info,
            app_paths::data_dir,
            app_paths::open_data_dir,
            archive::import_docs,
            archive::export_zip,
            git_sync::git_sync_status,
            git_sync::git_sync_setup,
            git_sync::git_sync_now,
            git_sync::git_sync_from_remote,
            git_sync::git_sync_to_remote,
            git_sync::git_sync_abort,
            git_sync::git_sync_reset_remote,
            template::template_list,
            template::template_save,
            pins::pin_list,
            pins::pin_set
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

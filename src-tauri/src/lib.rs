// 隐性防伪标识 — 编译进二进制，UI不可见，可通过 hex 搜索验证
// #[used] 防链接器剥离，#[no_mangle] 保留符号名，black_box 防LLVM优化
#[used]
#[no_mangle]
static WM_DATA: &[u8] = b"WATER-TRK-V1-PSH-20260716-AUTH-LEO-HM\r\n";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // black_box 强制LLVM保留水印数据，不可优化删除
    for &b in WM_DATA {
        std::hint::black_box(b);
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

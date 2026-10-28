use serde::Serialize;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use tauri::Manager;

const DATA_FILE: &str = "data.json";

fn data_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(DATA_FILE))
}

/// 读数据文件；还没有就返回 None。
/// 每天第一次读到能解析的数据时顺便备份一份（today 由界面按本地日期传来，格式 YYYY-MM-DD），备份失败不影响启动
#[tauri::command]
fn read_data(app: tauri::AppHandle, today: Option<String>) -> Result<Option<String>, String> {
    let path = data_path(&app)?;
    match fs::read_to_string(&path) {
        // 用记事本等工具改过的文件开头可能带 BOM
        Ok(text) => {
            let text = text.trim_start_matches('\u{feff}').to_string();
            if let Some(day) = today {
                if serde_json::from_str::<serde_json::Value>(&text).is_ok() {
                    let _ = daily_backup(&path, &backup_dir(&app)?, &day, BACKUP_KEEP);
                }
            }
            Ok(Some(text))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

const BACKUP_KEEP: usize = 7;

fn backup_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("backups"))
}

/// 复制成 backups/data-YYYY-MM-DD.json（当天已有就不再复制），只留最近 keep 份。用复制不用改名：有的安全软件会拦改名
fn daily_backup(data: &Path, dir: &Path, today: &str, keep: usize) -> std::io::Result<()> {
    let ok_day = today.len() == 10
        && today.char_indices().all(|(i, c)| if i == 4 || i == 7 { c == '-' } else { c.is_ascii_digit() });
    if !ok_day {
        return Ok(());
    }
    fs::create_dir_all(dir)?;
    let target = dir.join(format!("data-{today}.json"));
    if !target.exists() {
        fs::copy(data, &target)?;
    }
    let mut old: Vec<PathBuf> = fs::read_dir(dir)?
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            let n = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
            n.starts_with("data-") && n.ends_with(".json")
        })
        .collect();
    old.sort(); // 文件名里是日期，按名字排就是按日期排
    let extra = old.len().saturating_sub(keep);
    for p in &old[..extra] {
        let _ = fs::remove_file(p);
    }
    Ok(())
}

/// 在资源管理器里打开备份文件夹
#[tauri::command]
fn open_backups(app: tauri::AppHandle) -> Result<(), String> {
    let dir = backup_dir(&app)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    // 写全路径，不靠 PATH 去找 explorer
    let windir = std::env::var("WINDIR").unwrap_or_else(|_| "C:/Windows".into());
    std::process::Command::new(Path::new(&windir).join("explorer.exe")).arg(&dir).spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// 先写临时文件再改名，写到一半断电也不会把旧数据弄坏。
/// 杀毒软件可能刚写完就短暂锁住文件，改名失败就稍等重试；实在不行直接覆盖写，保证不丢数据。
#[tauri::command]
fn write_data(app: tauri::AppHandle, text: String) -> Result<(), String> {
    let path = data_path(&app)?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, &text).map_err(|e| e.to_string())?;
    for _ in 0..10 {
        if fs::rename(&tmp, &path).is_ok() {
            return Ok(());
        }
        std::thread::sleep(std::time::Duration::from_millis(30));
    }
    fs::write(&path, &text).map_err(|e| e.to_string())?;
    let _ = fs::remove_file(&tmp);
    Ok(())
}

/// 数据文件读不懂时，把它改名留作备份（data.broken-时间.json），返回备份文件名
#[tauri::command]
fn backup_broken_data(app: tauri::AppHandle) -> Result<String, String> {
    let path = data_path(&app)?;
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let name = format!("data.broken-{secs}.json");
    fs::rename(&path, path.with_file_name(&name))
        .or_else(|_| fs::copy(&path, path.with_file_name(&name)).map(|_| ()))
        .map_err(|e| e.to_string())?;
    Ok(name)
}

/// 评分文件的导入导出只碰 .json 和 .html 文件
fn check_json(path: &str) -> Result<(), String> {
    let ok = Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("json") || e.eq_ignore_ascii_case("html"));
    if ok { Ok(()) } else { Err("只支持 .json 或 .html 文件".into()) }
}

#[tauri::command]
fn read_json_file(path: String) -> Result<String, String> {
    check_json(&path)?;
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&bytes).trim_start_matches('\u{feff}').to_string())
}

#[tauri::command]
fn write_json_file(path: String, text: String) -> Result<(), String> {
    check_json(&path)?;
    fs::write(&path, text).map_err(|e| e.to_string())
}

/// 扫描到的一个游戏文件夹
#[derive(Serialize)]
struct Found {
    /// 放启动程序的文件夹
    dir: String,
    /// 显示用的名字：names 里第一个不是通用词的（都是通用词就用文件夹名）
    name: String,
    /// 名字的全部候选：文件夹名、外层只装着它的包装文件夹名（由里到外）、启动程序名、引擎文件里写的标题。界面拿它们比对作品名
    names: Vec<String>,
    /// 文件夹名（或里面两层内的文件、文件夹名）里找到的 RJ 号
    rj: Option<String>,
    /// 可执行文件，最可能是启动程序的排在最前
    exes: Vec<String>,
    /// exe 就在文件夹里或下一层（判断外层是不是分类文件夹用）
    #[serde(skip)]
    shallow: bool,
}

/// 在文字里找 RJ 号：RJ 后面跟 6 位或 8 位数字
fn find_rj(text: &str) -> Option<String> {
    let up = text.to_ascii_uppercase();
    let b = up.as_bytes();
    let mut i = 0;
    while i + 8 <= b.len() {
        if &b[i..i + 2] == b"RJ" && (i == 0 || !b[i - 1].is_ascii_alphanumeric()) {
            let digits = b[i + 2..].iter().take_while(|c| c.is_ascii_digit()).count();
            if digits == 6 || digits == 8 {
                return Some(up[i..i + 2 + digits].to_string());
            }
        }
        i += 1;
    }
    None
}

/// 明显不是游戏本体的 exe
fn is_helper_exe(name: &str) -> bool {
    const SKIP: [&str; 14] = [
        "unins", "setup", "install", "config", "crash", "notification_helper", "vcredist",
        "dxsetup", "dxwebsetup", "leproc", "redist", "updater", "uninstall", "7z",
    ];
    let n = name.to_ascii_lowercase();
    SKIP.iter().any(|s| n.contains(s))
}

/// 没有辨识度的名字：引擎、架构的通用文件夹名，版本号或纯数字，太短的（和前端 generic 一致）
fn is_generic(name: &str) -> bool {
    const WORDS: [&str; 12] = ["game", "www", "pc", "data", "bin", "x64", "x86", "rpgmv-game", "nwjs", "nw", "nwjc", "mtool_game"];
    let n = name.trim().to_lowercase();
    let ver = n.strip_prefix("ver").or_else(|| n.strip_prefix('v')).unwrap_or(&n);
    let version_like = ver.chars().any(|c| c.is_ascii_digit()) && ver.chars().all(|c| c.is_ascii_digit() || c == '.');
    n.chars().count() < 2 || WORDS.contains(&n.as_str()) || version_like
}

fn is_exe(name: &str) -> bool {
    name.to_ascii_lowercase().ends_with(".exe")
}

/// 往下最多 depth 层收集 exe 和 RJ 号
fn walk(dir: &Path, depth: u32, exes: &mut Vec<(PathBuf, u64)>, rj: &mut Option<String>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for e in entries.flatten() {
        let p = e.path();
        let name = e.file_name().to_string_lossy().to_string();
        if rj.is_none() {
            *rj = find_rj(&name);
        }
        let Ok(meta) = e.metadata() else { continue };
        if meta.is_dir() {
            if depth > 0 {
                walk(&p, depth - 1, exes, rj);
            }
        } else if is_exe(&name) && !is_helper_exe(&name) {
            exes.push((p, meta.len()));
        }
    }
}

/// 只装着一个子文件夹、自己没有 exe 的文件夹是包装层（1546/1546/Game.exe 这种）：返回里面那个子文件夹
fn sole_subdir(dir: &Path) -> Option<PathBuf> {
    let mut sub = None;
    for e in fs::read_dir(dir).ok()?.flatten() {
        let Ok(t) = e.file_type() else { continue };
        if t.is_dir() {
            if sub.is_some() {
                return None;
            }
            sub = Some(e.path());
        } else if is_exe(&e.file_name().to_string_lossy()) {
            return None;
        }
    }
    sub
}

/// 给 exe 排序：Game.exe 最先，其次名字出现在文件夹名里的，再按文件大小
fn rank_exes(folder_name: &str, mut exes: Vec<(PathBuf, u64)>) -> Vec<String> {
    let folder = folder_name.to_lowercase();
    let score = |p: &PathBuf| -> u8 {
        let stem = p.file_stem().map(|s| s.to_string_lossy().to_lowercase()).unwrap_or_default();
        if stem == "game" { 0 } else if !stem.is_empty() && folder.contains(&stem) { 1 } else { 2 }
    };
    exes.sort_by(|a, b| score(&a.0).cmp(&score(&b.0)).then(b.1.cmp(&a.1)));
    exes.into_iter().map(|(p, _)| p.to_string_lossy().to_string()).collect()
}

// —— 引擎文件里写的标题：只读游戏文件夹里下面这几个固定名字的文件，每个最多 64 KB，只读不写 ——

const TITLE_MAX: u64 = 64 * 1024;

/// 读成文字：UTF-8（可带 BOM）、UTF-16 LE（带 BOM），都不是就按 cp932（Shift-JIS）解；读不了返回 None
fn read_text(path: &Path) -> Option<String> {
    let mut bytes = Vec::new();
    fs::File::open(path).ok()?.take(TITLE_MAX).read_to_end(&mut bytes).ok()?;
    if let Some(b) = bytes.strip_prefix(&[0xff, 0xfe]) {
        return Some(encoding_rs::UTF_16LE.decode_without_bom_handling(b).0.into_owned());
    }
    let b = bytes.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(&bytes);
    Some(match std::str::from_utf8(b) {
        Ok(s) => s.to_string(),
        Err(_) => encoding_rs::SHIFT_JIS.decode_without_bom_handling(b).0.into_owned(),
    })
}

/// 标题去掉首尾空白；太长、太短或通用词的不要
fn clean_title(s: &str) -> Option<String> {
    let t = s.trim();
    (!is_generic(t) && t.chars().count() <= 200).then(|| t.to_string())
}

/// 一行里第一对引号中间的文字
fn quoted(line: &str) -> Option<String> {
    let start = line.find(['"', '\''])?;
    let q = line.as_bytes()[start] as char;
    let body = &line[start + 1..];
    clean_title(&body[..body.find(q)?])
}

/// Game.ini 的 Title=（RPG Maker XP/VX/VX Ace，WOLF RPG Editor 有写的话也是这个）
fn ini_title(text: &str) -> Option<String> {
    text.lines().map(str::trim).find_map(|l| {
        let (k, v) = l.split_once('=')?;
        k.trim().eq_ignore_ascii_case("title").then(|| clean_title(v)).flatten()
    })
}

/// package.json：window.title，其次 productName，再次 name（RPG Maker MV/MZ、Electron）
fn package_title(text: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(text).ok()?;
    [&v["window"]["title"], &v["productName"], &v["name"]].into_iter().find_map(|x| x.as_str().and_then(clean_title))
}

/// Ren'Py 的 game/options.rpy：define config.name = "…"（也可能写成 _("…")）
fn renpy_title(text: &str) -> Option<String> {
    text.lines().map(str::trim).find_map(|l| l.starts_with("define config.name").then(|| quoted(l)).flatten())
}

/// KiriKiri / TyranoScript 的 Config.tjs：;System.title = "…" 或 title = "…"
fn tjs_title(text: &str) -> Option<String> {
    text.lines().map(|l| l.trim().trim_start_matches(';')).find_map(|l| {
        let rest = l.strip_prefix("System.title").or_else(|| l.strip_prefix("title"));
        rest.is_some_and(|r| r.trim_start().starts_with('=')).then(|| quoted(l)).flatten()
    })
}

/// Unity：<名字>_Data/app.info 的第二行是产品名
fn unity_title(dir: &Path) -> Option<String> {
    let data = fs::read_dir(dir).ok()?.flatten().find(|e| {
        e.file_type().is_ok_and(|t| t.is_dir()) && e.file_name().to_string_lossy().to_ascii_lowercase().ends_with("_data")
    })?;
    read_text(&data.path().join("app.info"))?.lines().nth(1).and_then(clean_title)
}

/// 游戏文件夹里各引擎写标题的地方，都认得的话可能有好几个
fn engine_titles(dir: &Path) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut add = |t: Option<String>| {
        if let Some(t) = t {
            if !out.contains(&t) {
                out.push(t);
            }
        }
    };
    add(read_text(&dir.join("Game.ini")).and_then(|t| ini_title(&t)));
    for rel in ["package.json", "www/package.json", "resources/app/package.json"] {
        add(read_text(&dir.join(rel)).and_then(|t| package_title(&t)));
    }
    add(unity_title(dir));
    add(read_text(&dir.join("game/options.rpy")).and_then(|t| renpy_title(&t)));
    for rel in ["data/system/Config.tjs", "system/Config.tjs"] {
        add(read_text(&dir.join(rel)).and_then(|t| tjs_title(&t)));
    }
    out
}

/// 包装层最多往里走几层
const WRAP_MAX: usize = 5;

/// 扫描游戏文件夹：每个子文件夹算一部作品。
/// 只装着一个子文件夹、自己没有 exe 的是包装层，往里走，里面那个才算作品（外层的名字留作名字候选）。
/// 子文件夹自己这层没有 exe 的，先当成分类文件夹往下看一层；下面找不到几部游戏，才把它当一部作品。
#[tauri::command]
fn scan_roots(roots: Vec<String>) -> Vec<Found> {
    let mut out = Vec::new();
    for root in roots {
        scan_dir(Path::new(&root), 1, &mut out);
    }
    out
}

fn scan_dir(dir: &Path, nest: u32, out: &mut Vec<Found>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for e in entries.flatten() {
        let p = e.path();
        if p.is_dir() {
            scan_game(p, nest, out);
        }
    }
}

fn file_name(p: &Path) -> String {
    p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default()
}

fn scan_game(mut p: PathBuf, nest: u32, out: &mut Vec<Found>) {
    let mut wrappers = Vec::new(); // 由外到里
    while wrappers.len() < WRAP_MAX {
        let Some(inner) = sole_subdir(&p) else { break };
        wrappers.push(file_name(&p));
        p = inner;
    }
    let name = file_name(&p);
    let mut exes = Vec::new();
    let mut rj = wrappers.iter().chain(std::iter::once(&name)).find_map(|n| find_rj(n));
    walk(&p, 1, &mut exes, &mut rj);
    let shallow = !exes.is_empty();
    let direct = exes.iter().any(|(e, _)| e.parent() == Some(p.as_path()));
    if !direct && nest > 0 {
        // 自己这层没有 exe 的先往下看一层：下面找到几部，或者（自己下一层也没有 exe）找到一部而且它的 exe 就在表层，才算分类文件夹
        let mut inner = Vec::new();
        scan_dir(&p, nest - 1, &mut inner);
        if inner.len() > 1 || (!shallow && inner.first().is_some_and(|f| f.shallow)) {
            out.extend(inner);
            return;
        }
    }
    if !shallow {
        walk(&p, 4, &mut exes, &mut rj);
    }
    if exes.is_empty() {
        return;
    }
    let mut names = vec![name.clone()];
    names.extend(wrappers.into_iter().rev());
    let exes = rank_exes(&names.join(" "), exes);
    names.push(Path::new(&exes[0]).file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default());
    names.extend(engine_titles(&p));
    let mut seen: Vec<String> = Vec::new();
    names.retain(|n| !n.is_empty() && !seen.contains(n) && { seen.push(n.clone()); true });
    let display = names.iter().find(|n| !is_generic(n)).cloned().unwrap_or(name);
    out.push(Found { dir: p.to_string_lossy().to_string(), name: display, names, rj, exes, shallow });
}

/// 启动游戏：工作目录设成 exe 所在的文件夹，很多游戏靠它找素材
#[tauri::command]
fn launch(exe: String, dir: String, mtool: bool) -> Result<bool, String> {
    let path = Path::new(&exe);
    if !path.is_file() {
        return Err("找不到启动程序，可能被移动或删掉了".into());
    }
    let parent = path.parent().ok_or("启动程序路径不对")?;
    // 打开了「识别 MTool」的，启动程序旁边或作品文件夹里有 MTool 生成的启动器就用它
    let bat = if mtool { find_mtool(parent).or_else(|| find_mtool(Path::new(&dir))) } else { None };
    let target = bat.as_deref().unwrap_or(path);
    let mut cmd = std::process::Command::new(target);
    cmd.current_dir(target.parent().unwrap_or(parent));
    if is_bat(target) {
        // .bat 不弹黑色命令行窗口
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    cmd.spawn().map(|_| bat.is_some()).map_err(|e| e.to_string())
}

fn is_bat(p: &Path) -> bool {
    p.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("bat"))
}

/// MTool 拖入游戏后会在游戏文件夹里生成「与工具一同启动.bat」
fn find_mtool(dir: &Path) -> Option<PathBuf> {
    fs::read_dir(dir).ok()?.flatten().map(|e| e.path()).find(|p| {
        let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("").to_lowercase();
        p.is_file() && is_bat(p) && (name.contains("与工具一同启动") || name.contains("mtool"))
    })
}

/// 导入的数据包解压在这里：catalog.json + covers/
fn pack_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("pack"))
}

/// 读已导入数据包的作品目录；没导入过返回 None。同时返回数据包所在文件夹，界面用它拼封面路径
#[tauri::command]
fn read_pack(app: tauri::AppHandle) -> Result<Option<(String, String)>, String> {
    let dir = pack_dir(&app)?;
    match fs::read_to_string(dir.join("catalog.json")) {
        Ok(text) => Ok(Some((text, dir.to_string_lossy().to_string()))),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

const IMAGE_EXTS: [&str; 4] = ["jpg", "jpeg", "png", "webp"];

/// 数据包里只认 catalog.json 和 covers/ 下的图片，别的文件一概不解压
fn pack_entry_target(name: &str) -> Option<String> {
    let name = name.replace('\\', "/");
    if name == "catalog.json" {
        return Some(name);
    }
    let file = name.strip_prefix("covers/")?;
    let ext = Path::new(file).extension()?.to_str()?.to_ascii_lowercase();
    (safe_file_name(file) && IMAGE_EXTS.contains(&ext.as_str())).then(|| format!("covers/{file}"))
}

/// 封面文件名只放行字母、数字和 ._-；不能以 . 开头、以 . 或空格结尾，也不能是 Windows 的保留名（CON、NUL、COM1 这些，带不带扩展名都不行）
fn safe_file_name(file: &str) -> bool {
    let chars_ok = !file.is_empty() && file.chars().all(|c| c.is_ascii_alphanumeric() || "._-".contains(c));
    let base = file.split('.').next().unwrap_or("").to_ascii_uppercase();
    let reserved = ["CON", "PRN", "AUX", "NUL"].contains(&base.as_str())
        || ((base.starts_with("COM") || base.starts_with("LPT")) && base.len() == 4 && matches!(base.as_bytes()[3], b'1'..=b'9'));
    chars_ok && !file.starts_with('.') && !file.ends_with('.') && !file.ends_with(' ') && !reserved
}

/// 数据包的上限：按实际解压出的字节算，不信 zip 头里写的大小
struct PackLimits {
    total: u64,
    entries: usize,
    file: u64,
}
const PACK_LIMITS: PackLimits = PackLimits { total: 1 << 30, entries: 20_000, file: 50 << 20 };
/// 软件能读的作品目录版本（和前端 CATALOG_VERSION 一致）
const CATALOG_VERSION: u64 = 2;

/// 从 r 里最多读 limit 字节写到 out；多出来就报错
fn copy_limited(r: impl Read, limit: u64, out: &mut impl Write) -> Result<u64, ()> {
    let n = std::io::copy(&mut r.take(limit + 1), out).map_err(|_| ())?;
    if n > limit { Err(()) } else { Ok(n) }
}

/// 检查作品目录：格式对、版本软件认得、日期不比软件自带的旧
fn check_catalog(text: &str, min_updated: &str) -> Result<(), String> {
    let v: serde_json::Value = serde_json::from_str(text).map_err(|_| "数据包里的作品目录读不懂".to_string())?;
    let Some(games) = v["games"].as_array() else {
        return Err("数据包里的作品目录格式不对".into());
    };
    // 每部作品都要有编号；封面路径要么不写，要么是 covers/ 下合规的图片名
    for g in games {
        let Some(id) = g["id"].as_str().filter(|s| !s.trim().is_empty()) else {
            return Err("数据包里有作品缺少编号（id），没有导入".into());
        };
        match &g["cover"] {
            serde_json::Value::Null => {}
            serde_json::Value::String(c) if c.is_empty() || pack_entry_target(c).as_deref() == Some(c.as_str()) => {}
            _ => return Err(format!("数据包里作品 {id} 的封面路径不对，没有导入")),
        }
    }
    if v["version"].as_u64().unwrap_or(0) > CATALOG_VERSION {
        return Err("这个数据包要新版本的软件才能用".into());
    }
    let updated = v["updated"].as_str().unwrap_or("");
    if updated < min_updated {
        return Err(format!("这个数据包的资料（{updated}）比软件自带的（{min_updated}）旧，没有导入"));
    }
    Ok(())
}

/// 解压到 tmp：先读 catalog.json 检查，合格了才解压；只取认识的条目，超过上限就整包拒绝
fn extract_pack(zip_path: &Path, tmp: &Path, min_updated: &str, lim: &PackLimits) -> Result<String, String> {
    let file = fs::File::open(zip_path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipArchive::new(file).map_err(|_| "不是有效的数据包（.zip）".to_string())?;
    if zip.len() > lim.entries {
        return Err(format!("数据包里的文件太多（超过 {} 个）", lim.entries));
    }
    let too_big = || format!("数据包里有文件太大（超过 {} MB）", lim.file >> 20);
    // 名字读不出来（编码坏了）的条目直接跳过
    let name = zip
        .file_names()
        .filter_map(Result::ok)
        .find(|n| pack_entry_target(n).as_deref() == Some("catalog.json"))
        .map(|n| n.to_string())
        .ok_or("数据包里没有作品目录（catalog.json）")?;
    let mut bytes = Vec::new();
    copy_limited(zip.by_name(&name).map_err(|e| e.to_string())?, lim.file, &mut bytes).map_err(|_| too_big())?;
    let catalog = String::from_utf8_lossy(&bytes).trim_start_matches('\u{feff}').to_string();
    check_catalog(&catalog, min_updated)?;

    let _ = fs::remove_dir_all(tmp);
    fs::create_dir_all(tmp.join("covers")).map_err(|e| e.to_string())?;
    let mut total = 0u64;
    for i in 0..zip.len() {
        let entry = zip.by_index(i).map_err(|e| e.to_string())?;
        let Some(rel) = entry.name().ok().and_then(|n| pack_entry_target(&n)) else { continue };
        let mut out = fs::File::create(tmp.join(&rel)).map_err(|e| e.to_string())?;
        let room = lim.file.min(lim.total - total);
        total += copy_limited(entry, room, &mut out).map_err(|_| {
            if room < lim.file { format!("数据包解压后太大（超过 {} MB）", lim.total >> 20) } else { too_big() }
        })?;
    }
    Ok(catalog)
}

/// 导入数据包（.zip）：先解压到临时文件夹检查，全部合格才整个换掉旧的；不合格时旧包不动。
/// min_updated 是软件自带资料的日期，比它旧的包不收
#[tauri::command]
fn import_pack(app: tauri::AppHandle, path: String, min_updated: String) -> Result<String, String> {
    let dir = pack_dir(&app)?;
    let tmp = dir.with_file_name("pack.new");
    let catalog = match extract_pack(Path::new(&path), &tmp, &min_updated, &PACK_LIMITS) {
        Ok(c) => c,
        Err(e) => {
            let _ = fs::remove_dir_all(&tmp);
            return Err(e);
        }
    };
    swap_in(&tmp, &dir).map_err(|e| format!("换上新数据包失败，旧的还在：{e}"))?;
    // 启动时还没有 pack 文件夹的话，封面路径不在资源协议的范围里；第一次导入后补上，不用重启就能显示封面
    let _ = app.asset_protocol_scope().allow_directory(&dir, true);
    Ok(catalog)
}

/// 梯度表导出图片用：读数据包里的一张封面交给界面画进图片。只读 pack/covers 下的图片，名字检查和解压时一样
#[tauri::command]
fn read_pack_cover(app: tauri::AppHandle, name: String) -> Result<tauri::ipc::Response, String> {
    let rel = pack_entry_target(&format!("covers/{name}")).ok_or("封面文件名不对")?;
    let path = pack_dir(&app)?.join(rel);
    let len = fs::metadata(&path).map_err(|e| e.to_string())?.len();
    if len > PACK_LIMITS.file {
        return Err("封面文件太大".into());
    }
    fs::read(&path).map(tauri::ipc::Response::new).map_err(|e| e.to_string())
}

const PNG_SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', b'\r', b'\n', 0x1a, b'\n'];

/// 只写 .png 文件，内容也得是 PNG
fn check_png(path: &str, bytes: &[u8]) -> Result<(), String> {
    let ext_ok = Path::new(path).extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("png"));
    if !ext_ok {
        return Err("只能保存成 .png 文件".into());
    }
    if !bytes.starts_with(&PNG_SIGNATURE) {
        return Err("图片数据不对".into());
    }
    Ok(())
}

/// 把 %E4%B8%AD 这种写法还原（保存路径放在请求头里传过来，请求头只能是 ASCII）
fn percent_decode(s: &str) -> Option<String> {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            let hex = std::str::from_utf8(b.get(i + 1..i + 3)?).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// 保存梯度表图片：图片字节直接放在请求体里（不转 JSON），路径放在请求头 path 里
#[tauri::command]
fn write_png(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("图片数据不对".into());
    };
    let path = request
        .headers()
        .get("path")
        .and_then(|v| v.to_str().ok())
        .and_then(percent_decode)
        .ok_or("保存位置不对")?;
    check_png(&path, bytes)?;
    fs::write(&path, bytes).map_err(|e| e.to_string())
}

/// 用 tmp 换掉 dir：旧的先挪到 .old，新的放好了再删旧的；新的放不好就把旧的挪回去。
/// 有的安全软件会拦截改名，改不了就复制
fn swap_in(tmp: &Path, dir: &Path) -> std::io::Result<()> {
    let move_dir = |from: &Path, to: &Path| -> std::io::Result<()> {
        if fs::rename(from, to).is_ok() {
            return Ok(());
        }
        copy_dir(from, to)?;
        fs::remove_dir_all(from)
    };
    let old = dir.with_extension("old");
    let _ = fs::remove_dir_all(&old);
    let had_old = dir.exists();
    if had_old {
        move_dir(dir, &old)?;
    }
    match move_dir(tmp, dir) {
        Ok(()) => {
            let _ = fs::remove_dir_all(&old);
            Ok(())
        }
        Err(e) => {
            let _ = fs::remove_dir_all(dir);
            if had_old {
                let _ = move_dir(&old, dir);
            }
            Err(e)
        }
    }
}

/// 复制整个文件夹（数据包只有一层子文件夹 covers/）
fn copy_dir(from: &Path, to: &Path) -> std::io::Result<()> {
    fs::create_dir_all(to)?;
    for e in fs::read_dir(from)?.flatten() {
        let target = to.join(e.file_name());
        if e.file_type()?.is_dir() {
            copy_dir(&e.path(), &target)?;
        } else {
            fs::copy(e.path(), target)?;
        }
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // 只允许开一个窗口：再打开时新的进程直接退出，把原来的窗口拿到前面（这个插件要最先注册）
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            read_data,
            open_backups,
            write_data,
            backup_broken_data,
            read_json_file,
            write_json_file,
            scan_roots,
            launch,
            read_pack,
            import_pack,
            read_pack_cover,
            write_png
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rj_codes() {
        assert_eq!(find_rj("[RJ000000] 样例"), Some("RJ000000".into()));
        assert_eq!(find_rj("rj00000000_サンプル"), Some("RJ00000000".into()));
        assert_eq!(find_rj("RJ1234567"), None);
        assert_eq!(find_rj("XRJ000000"), None);
        assert_eq!(find_rj("Velmorin"), None);
    }

    #[test]
    fn scan_layout() {
        let root = std::env::temp_dir().join(format!("beatrice-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let put = |rel: &str, body: &[u8]| {
            let p = root.join(rel);
            fs::create_dir_all(p.parent().unwrap()).unwrap();
            fs::write(p, body).unwrap();
        };
        let touch = |rel: &str| put(rel, b"x");
        touch("[RJ000000] a/Game.exe");
        touch("[RJ000000] a/unins000.exe");
        touch("RPG/Velmorin/www/Game.exe"); // 分类文件夹下只有一部：一路都是包装层
        touch("Deep/v1/bin/x64/run.exe"); // 没有分类、exe 藏得深：包装层都是通用词，显示最外面的名字
        touch("Empty/readme.txt");
        touch("1546/1546/Game.exe"); // 同名包装层
        touch("2502-1207/蝴蝶公主/Game.exe"); // 编号文件夹包着正名
        touch("4440/Kinjo no Hitozuma.exe"); // 文件夹是编号，exe 名才是名字
        touch("Cat/Alpha/Alpha/Game.exe"); // 分类文件夹里有两部，其中一部带包装层
        touch("Cat/Beta/Game.exe");
        touch("Cat/notes.txt");
        // 引擎文件里的标题
        touch("Ace/Game.exe");
        put("Ace/Game.ini", &[b"[Game]\r\nRTP=RPGVXAce\r\nTitle=".to_vec(), vec![144, 185, 130, 200, 130, 233, 140, 149], b"\r\n".to_vec()].concat()); // Shift-JIS 聖なる剣
        touch("MV/Game.exe");
        put("MV/www/package.json", r#"{"name": "", "main": "index.html", "window": {"title": "魔法少女"}}"#.as_bytes());
        touch("Ren/Ren.exe");
        put("Ren/game/options.rpy", "\u{feff}## 说明\ndefine config.name = _(\"Renpy Title\")\n".as_bytes());
        touch("Kr/kr.exe");
        put("Kr/data/system/Config.tjs", b"// comment\n;System.title = \"Kiri Title\";\n");
        touch("Uni/Uni.exe");
        put("Uni/Uni_Data/app.info", b"Some Company\nUnity Title\n");
        touch("El/El.exe");
        put("El/resources/app/package.json", br#"{"name": "el", "productName": "Electron Title"}"#);
        touch("Wolf/Game.exe");
        put("Wolf/Game.ini", b"[Config]\nTitle=game\n"); // 通用词的标题不要

        let found = scan_roots(vec![root.to_string_lossy().to_string()]);
        let by: std::collections::HashMap<&str, &Found> = found.iter().map(|f| (f.name.as_str(), f)).collect();
        let mut names: Vec<_> = by.keys().copied().collect();
        names.sort();
        assert_eq!(names, ["1546", "Ace", "Alpha", "Beta", "Deep", "El", "Kinjo no Hitozuma", "Kr", "MV", "Ren", "Uni", "Velmorin", "Wolf", "[RJ000000] a", "蝴蝶公主"]);
        assert_eq!(by["[RJ000000] a"].rj.as_deref(), Some("RJ000000"));
        assert_eq!(by["[RJ000000] a"].exes.len(), 1);
        let dir_of = |f: &Found| f.dir.strip_prefix(&*root.to_string_lossy()).unwrap().replace('\\', "/");
        assert_eq!(dir_of(by["Velmorin"]), "/RPG/Velmorin/www");
        assert_eq!(by["Velmorin"].names, ["www", "Velmorin", "RPG", "Game"]);
        assert_eq!(dir_of(by["1546"]), "/1546/1546");
        assert_eq!(by["1546"].names, ["1546", "Game"]);
        assert_eq!(by["蝴蝶公主"].names, ["蝴蝶公主", "2502-1207", "Game"]);
        assert_eq!(dir_of(by["蝴蝶公主"]), "/2502-1207/蝴蝶公主");
        assert_eq!(by["Kinjo no Hitozuma"].names, ["4440", "Kinjo no Hitozuma"]);
        assert_eq!(dir_of(by["Deep"]), "/Deep/v1/bin/x64");
        assert_eq!(dir_of(by["Alpha"]), "/Cat/Alpha/Alpha");
        assert_eq!(by["Ace"].names.last().map(String::as_str), Some("聖なる剣"));
        assert_eq!(by["MV"].names.last().map(String::as_str), Some("魔法少女"));
        assert_eq!(by["Ren"].names.last().map(String::as_str), Some("Renpy Title"));
        assert_eq!(by["Kr"].names.last().map(String::as_str), Some("Kiri Title"));
        assert_eq!(by["Uni"].names.last().map(String::as_str), Some("Unity Title"));
        assert_eq!(by["El"].names.last().map(String::as_str), Some("Electron Title"));
        assert_eq!(by["Wolf"].names, ["Wolf", "Game"]);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn generic_names_and_titles() {
        for g in ["Game", "www", "x64", "v1.0", "ver1.2", "1546", "2.25", "a", ""] {
            assert!(is_generic(g), "{g}");
        }
        for ok in ["Velmorin", "R-3189", "蝴蝶公主", "ab"] {
            assert!(!is_generic(ok), "{ok}");
        }
        assert_eq!(ini_title("[Game]\nLibrary=x.dll\ntitle = My Game \n").as_deref(), Some("My Game"));
        assert_eq!(ini_title("[Game]\nLibrary=x.dll\n"), None);
        assert_eq!(package_title(r#"{"name":"rpgmv-game","window":{"title":""}}"#), None);
        assert_eq!(package_title(r#"{"name":"Nice Name"}"#).as_deref(), Some("Nice Name"));
        assert_eq!(renpy_title("define config.name = 'Single'\n").as_deref(), Some("Single"));
        assert_eq!(tjs_title("title = \"T\";\n;System.title = \"Real\";\n").as_deref(), Some("Real"));
        assert_eq!(tjs_title("//;System.title = \"no\";\n"), None);
        // 文件太大只读前 64 KB；坏的 UTF-8 按 cp932 解
        let root = std::env::temp_dir().join(format!("beatrice-title-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("Game.ini"), [vec![b'x'; 70_000], b"\nTitle=late\n".to_vec()].concat()).unwrap();
        assert_eq!(ini_title(&read_text(&root.join("Game.ini")).unwrap()), None);
        fs::write(root.join("sj.txt"), [131, 94, 131, 67, 131, 103, 131, 139]).unwrap();
        assert_eq!(read_text(&root.join("sj.txt")).as_deref(), Some("タイトル"));
        fs::write(root.join("u16.txt"), [0xff, 0xfe, b'A', 0, b'B', 0]).unwrap();
        assert_eq!(read_text(&root.join("u16.txt")).as_deref(), Some("AB"));
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn mtool_bat() {
        let dir = std::env::temp_dir().join(format!("beatrice-mtool-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("Game.exe"), b"").unwrap();
        fs::write(dir.join("other.bat"), b"").unwrap();
        assert!(find_mtool(&dir).is_none());
        fs::write(dir.join("与工具一同启动.bat"), b"").unwrap();
        assert_eq!(find_mtool(&dir).unwrap().file_name().unwrap(), "与工具一同启动.bat");
        fs::remove_dir_all(&dir).ok();
    }

    /// 测试用：把 (名字, 内容) 写成一个不压缩的 zip
    fn make_zip(path: &Path, files: &[(&str, Vec<u8>)]) {
        let mut w = zip::ZipWriter::new(fs::File::create(path).unwrap());
        let opt = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
        for (name, body) in files {
            w.start_file(*name, opt).unwrap();
            w.write_all(body).unwrap();
        }
        w.finish().unwrap();
    }

    fn catalog(version: u32, updated: &str) -> Vec<u8> {
        format!(r#"{{"version":{version},"updated":"{updated}","source":"t","games":[]}}"#).into_bytes()
    }

    #[test]
    fn pack_checks_and_limits() {
        let root = std::env::temp_dir().join(format!("beatrice-pack-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let zip = root.join("p.zip");
        let tmp = root.join("pack.new");
        let lim = PackLimits { total: 300, entries: 4, file: 200 };
        let run = |files: &[(&str, Vec<u8>)]| {
            make_zip(&zip, files);
            extract_pack(&zip, &tmp, "2026-10-27", &lim)
        };

        // 合格的包：只解压认识的条目
        let ok = run(&[("catalog.json", catalog(2, "2026-10-28")), ("covers/a.jpg", vec![1; 100]), ("evil.exe", vec![0; 10])]);
        assert!(ok.is_ok(), "{ok:?}");
        assert!(tmp.join("covers/a.jpg").exists());
        assert!(!tmp.join("evil.exe").exists());
        fs::remove_dir_all(&tmp).unwrap();
        // 压缩过的（deflate）条目也能读
        let mut w = zip::ZipWriter::new(fs::File::create(&zip).unwrap());
        let deflated = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        w.start_file("catalog.json", deflated).unwrap();
        w.write_all(&catalog(2, "2026-10-28")).unwrap();
        w.start_file("covers/b.jpg", deflated).unwrap();
        w.write_all(&[7; 150]).unwrap();
        w.finish().unwrap();
        let ok = extract_pack(&zip, &tmp, "2026-10-27", &lim);
        assert!(ok.is_ok(), "{ok:?}");
        assert_eq!(fs::read(tmp.join("covers/b.jpg")).unwrap(), vec![7; 150]);
        fs::remove_dir_all(&tmp).unwrap();

        // 比自带资料旧、版本比软件新、没有目录：都拒绝，而且什么都没解压
        let old = run(&[("catalog.json", catalog(2, "2026-01-01")), ("covers/a.jpg", vec![1; 10])]);
        assert!(old.unwrap_err().contains("旧"));
        assert!(!tmp.exists());
        let newer = run(&[("catalog.json", catalog(3, "2026-10-28"))]);
        assert!(newer.unwrap_err().contains("新版本"));
        assert!(run(&[("covers/a.jpg", vec![1; 10])]).unwrap_err().contains("没有作品目录"));

        // 上限：条目数、单个文件、解压后总大小
        let many: Vec<(&str, Vec<u8>)> = vec![("catalog.json", catalog(2, "2026-10-28")), ("a", vec![]), ("b", vec![]), ("c", vec![]), ("d", vec![])];
        assert!(run(&many).unwrap_err().contains("太多"));
        let big = run(&[("catalog.json", catalog(2, "2026-10-28")), ("covers/a.jpg", vec![1; 201])]);
        assert!(big.unwrap_err().contains("文件太大"));
        let total = run(&[("catalog.json", catalog(2, "2026-10-28")), ("covers/a.jpg", vec![1; 150]), ("covers/b.jpg", vec![1; 150])]);
        assert!(total.unwrap_err().contains("解压后太大"));
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn backups_daily_keep_7() {
        let root = std::env::temp_dir().join(format!("beatrice-backup-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let data = root.join("data.json");
        let dir = root.join("backups");
        fs::write(&data, "{\"v\":1}").unwrap();
        for d in 1..=9 {
            daily_backup(&data, &dir, &format!("2026-10-{d:02}"), 7).unwrap();
        }
        // 同一天第二次不覆盖
        fs::write(&data, "{\"v\":2}").unwrap();
        daily_backup(&data, &dir, "2026-10-09", 7).unwrap();
        let mut names: Vec<String> = fs::read_dir(&dir).unwrap().flatten().map(|e| e.file_name().to_string_lossy().to_string()).collect();
        names.sort();
        assert_eq!(names.len(), 7);
        assert_eq!(names[0], "data-2026-10-03.json");
        assert_eq!(fs::read_to_string(dir.join("data-2026-10-09.json")).unwrap(), "{\"v\":1}");
        // 日期格式不对就不备份
        daily_backup(&data, &dir, "../../x", 7).unwrap();
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 7);
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn png_save_checks() {
        let png = [&PNG_SIGNATURE[..], b"rest"].concat();
        assert!(check_png("D:/a/梯度表.png", &png).is_ok());
        assert!(check_png("D:/a/x.PNG", &png).is_ok());
        assert!(check_png("D:/a/x.exe", &png).is_err());
        assert!(check_png("D:/a/x.png", b"MZ not png").is_err());
        assert_eq!(percent_decode("D%3A%5C%E9%BB%84%E6%B2%B9.png").as_deref(), Some("D:\\黄油.png"));
        assert_eq!(percent_decode("bad%zz"), None);
        assert_eq!(percent_decode("cut%E9"), None);
        // 读封面的名字检查：不能跳出 covers 文件夹
        assert!(pack_entry_target("covers/../data.json").is_none());
        assert!(pack_entry_target("covers/a/b.jpg").is_none());
    }

    #[test]
    fn cover_names_and_catalog_entries() {
        for ok in ["covers/RJ1.jpg", "covers/a_b-c.1.PNG"] {
            assert!(pack_entry_target(ok).is_some(), "{ok}");
        }
        for bad in ["covers/中文.jpg", "covers/a b.jpg", "covers/.x.jpg", "covers/CON.jpg", "covers/nul.png", "covers/com1.jpg",
            "covers/LPT9.webp", "covers/a.jpg.", "covers/a%2f.jpg", "covers/../x.jpg"] {
            assert!(pack_entry_target(bad).is_none(), "{bad}");
        }
        assert!(pack_entry_target("covers/COM10.jpg").is_some()); // 只有 COM1-9 是保留名
        let cat = |games: &str| format!(r#"{{"version":2,"updated":"2026-12-31","games":[{games}]}}"#);
        assert!(check_catalog(&cat(r#"{"id":"RJ1","cover":"covers/RJ1.jpg"},{"id":"RJ2"},{"id":"RJ3","cover":""}"#), "2026-01-01").is_ok());
        assert!(check_catalog(&cat(r#"{"id":"RJ1"},{"title":"没有编号"}"#), "2026-01-01").unwrap_err().contains("编号"));
        assert!(check_catalog(&cat(r#"{"id":"  "}"#), "2026-01-01").unwrap_err().contains("编号"));
        assert!(check_catalog(&cat(r#""不是对象""#), "2026-01-01").unwrap_err().contains("编号"));
        assert!(check_catalog(&cat(r#"{"id":"RJ1","cover":"covers/../../evil.jpg"}"#), "2026-01-01").unwrap_err().contains("封面"));
        assert!(check_catalog(&cat(r#"{"id":"RJ1","cover":7}"#), "2026-01-01").unwrap_err().contains("封面"));
    }

    #[test]
    fn swap_in_keeps_old_until_new_is_in_place() {
        let root = std::env::temp_dir().join(format!("beatrice-swap-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let (dir, tmp) = (root.join("pack"), root.join("pack.new"));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("catalog.json"), "old").unwrap();
        fs::create_dir_all(&tmp).unwrap();
        fs::write(tmp.join("catalog.json"), "new").unwrap();
        swap_in(&tmp, &dir).unwrap();
        assert_eq!(fs::read_to_string(dir.join("catalog.json")).unwrap(), "new");
        assert!(!tmp.exists());
        assert!(!root.join("pack.old").exists());
        // 新的不存在（放不进去）：旧的要回到原处
        let err = swap_in(&root.join("missing"), &dir);
        assert!(err.is_err());
        assert_eq!(fs::read_to_string(dir.join("catalog.json")).unwrap(), "new");
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn pack_entries() {
        assert_eq!(pack_entry_target("catalog.json").as_deref(), Some("catalog.json"));
        assert_eq!(pack_entry_target("covers/RJ1.jpg").as_deref(), Some("covers/RJ1.jpg"));
        assert_eq!(pack_entry_target("covers\\RJ1.PNG").as_deref(), Some("covers/RJ1.PNG"));
        assert_eq!(pack_entry_target("covers/../evil.jpg"), None);
        assert_eq!(pack_entry_target("../catalog.json"), None);
        assert_eq!(pack_entry_target("covers/a.exe"), None);
        assert_eq!(pack_entry_target("readme.txt"), None);
    }

    #[test]
    fn exe_order() {
        let exes = vec![
            (PathBuf::from("a/notes.exe"), 900),
            (PathBuf::from("a/Game.exe"), 10),
            (PathBuf::from("a/Velmorin.exe"), 50),
        ];
        let r = rank_exes("Velmorin v1.2", exes);
        assert!(r[0].ends_with("Game.exe"));
        assert!(r[1].ends_with("Velmorin.exe"));
    }
}

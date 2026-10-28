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
/// 根本不让改名的（见 NO_RENAME）不用等，直接覆盖写
#[tauri::command]
fn write_data(app: tauri::AppHandle, text: String) -> Result<(), String> {
    let path = data_path(&app)?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, &text).map_err(|e| e.to_string())?;
    for _ in 0..10 {
        match fs::rename(&tmp, &path) {
            Ok(()) => return Ok(()),
            Err(e) if e.raw_os_error() == Some(NO_RENAME) => break,
            Err(_) => std::thread::sleep(std::time::Duration::from_millis(30)),
        }
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
    /// 有包装层时：最外面那层包装文件夹（dir 在它里面，中间每层都只装着下一层）。界面只凭它把关联在包装层上的作品挪到 dir
    #[serde(skip_serializing_if = "Option::is_none")]
    top: Option<String>,
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

/// 符号链接、目录联接（junction）这类重解析点：扫描和读标题都不跟进去，免得读到游戏文件夹外面的东西。
/// 新版 Rust 把联接也算成 symlink，这里再看一下属性，旧行为也稳
fn is_link(meta: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
    meta.file_type().is_symlink() || meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
}

/// 目录项本身的信息（不跟随链接）；是链接或读不了的返回 None
fn plain_meta(e: &fs::DirEntry) -> Option<fs::Metadata> {
    e.metadata().ok().filter(|m| !is_link(m)) // DirEntry::metadata 本来就不跟随链接
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
        let Some(meta) = plain_meta(&e) else { continue };
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
        let Some(m) = plain_meta(&e) else { continue }; // 链接不算子文件夹，也不往里走
        if m.is_dir() {
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

/// 读游戏文件夹 dir 里的 rel（用 / 分隔）：路径上每一层都不能是链接，最后是个普通文件；
/// 打开时不跟随重解析点，打开后再看一次句柄，免得检查完被换成链接
fn read_title(dir: &Path, rel: &str) -> Option<String> {
    let mut p = dir.to_path_buf();
    for part in rel.split('/') {
        p.push(part);
        if is_link(&fs::symlink_metadata(&p).ok()?) {
            return None;
        }
    }
    read_text(&p)
}

/// 打开一个普通文件来读：不跟随重解析点，打开后再看一次句柄，免得检查完被换成链接；是链接、不是文件返回 None
fn open_plain(path: &Path) -> Option<fs::File> {
    use std::os::windows::fs::OpenOptionsExt;
    const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
    let file = fs::OpenOptions::new().read(true).custom_flags(FILE_FLAG_OPEN_REPARSE_POINT).open(path).ok()?;
    let meta = file.metadata().ok()?;
    (!is_link(&meta) && meta.is_file()).then_some(file)
}

/// 路径上每一级（从盘符往下）都不是链接；哪一级读不到也算不行
fn no_links(path: &Path) -> bool {
    path.ancestors().filter(|p| !p.as_os_str().is_empty()).all(|p| fs::symlink_metadata(p).is_ok_and(|m| !is_link(&m)))
}

/// 读成文字：UTF-8（可带 BOM）、UTF-16 LE（带 BOM），都不是就按 cp932（Shift-JIS）解；读不了、是链接返回 None
fn read_text(path: &Path) -> Option<String> {
    let file = open_plain(path)?;
    let mut bytes = Vec::new();
    file.take(TITLE_MAX).read_to_end(&mut bytes).ok()?;
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
        plain_meta(e).is_some_and(|m| m.is_dir()) && e.file_name().to_string_lossy().to_ascii_lowercase().ends_with("_data")
    })?;
    read_title(dir, &format!("{}/app.info", data.file_name().to_string_lossy()))?.lines().nth(1).and_then(clean_title)
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
    add(read_title(dir, "Game.ini").and_then(|t| ini_title(&t)));
    for rel in ["package.json", "www/package.json", "resources/app/package.json"] {
        add(read_title(dir, rel).and_then(|t| package_title(&t)));
    }
    add(unity_title(dir));
    add(read_title(dir, "game/options.rpy").and_then(|t| renpy_title(&t)));
    for rel in ["data/system/Config.tjs", "system/Config.tjs"] {
        add(read_title(dir, rel).and_then(|t| tjs_title(&t)));
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
    // 游戏文件夹（自己选的）本身可以是链接，里面的链接一律不跟
    for e in entries.flatten() {
        if plain_meta(&e).is_some_and(|m| m.is_dir()) {
            scan_game(e.path(), nest, out);
        }
    }
}

fn file_name(p: &Path) -> String {
    p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default()
}

fn scan_game(mut p: PathBuf, nest: u32, out: &mut Vec<Found>) {
    let outer = p.clone();
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
    let top = (outer != p).then(|| outer.to_string_lossy().to_string());
    out.push(Found { dir: p.to_string_lossy().to_string(), name: display, names, rj, exes, top, shallow });
}

/// 退出后发给界面的事件：从启动到作业里的进程全部退出过了多少秒
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct GameExited {
    id: String,
    /// 启动时刻（Unix 毫秒）
    started_at: u64,
    seconds: u64,
}

/// 启动游戏：工作目录设成 exe 所在的文件夹，很多游戏靠它找素材。
/// 给了 le（设置里选的 LEProc.exe）就用 Locale Emulator 转区启动，这时不用 MTool；否则打开了「识别 MTool」而且有它生成的启动器就用启动器。
/// 返回用了哪种方式：""、"mtool"、"le"。
/// 启动的进程放进一个作业对象（它再启动的子进程也在里面），后台线程等它们全退出后发 game-exited 事件，界面拿来记游玩时长；
/// 游戏还开着时关掉软件，这一次就不记。除了等自己启动的进程退出，不看别的进程
#[tauri::command]
fn launch(app: tauri::AppHandle, id: String, exe: String, dir: String, mtool: bool, le: Option<String>) -> Result<String, String> {
    let path = Path::new(&exe);
    if !path.is_file() {
        return Err("找不到启动程序，可能被移动或删掉了".into());
    }
    let parent = path.parent().ok_or("启动程序路径不对")?;
    let le = le.as_deref().map(Path::new).map(check_le).transpose()?;
    // 先定下真正要启动的是哪个文件（MTool 启动器或自己选的），再看它是不是 .bat
    let mtool_bat = if mtool && le.is_none() { find_mtool(parent).or_else(|| find_mtool(Path::new(&dir))) } else { None };
    let target = mtool_bat.as_deref().unwrap_or(path);
    let bat = is_bat(target);
    let (how, line, cwd) = match le {
        Some(_) if bat => return Err("转区启动不支持 .bat 启动程序：请换成游戏的 exe，或关掉这部的转区启动".into()),
        Some(le) => ("le", launch_line(le, &["-run", &exe])?, parent),
        None if bat => (if mtool_bat.is_some() { "mtool" } else { "" }, bat_line(target)?, target.parent().unwrap_or(parent)),
        None => ("", launch_line(path, &[])?, parent),
    };
    if let Some(job) = job::spawn(&line, cwd, bat)? {
        let started = std::time::Instant::now();
        let started_at = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
        std::thread::spawn(move || match job.wait() {
            Ok(()) => {
                use tauri::Emitter;
                let _ = app.emit("game-exited", GameExited { id, started_at, seconds: started.elapsed().as_secs() });
            }
            // 没等到真正退出：这次不记，不编一个时长出来
            Err(e) => eprintln!("等游戏退出失败，这次不记时长：{e}"),
        });
    }
    Ok(how.into())
}

/// Locale Emulator 只认 LEProc.exe 这个文件名，而且文件得在
fn check_le(p: &Path) -> Result<&Path, String> {
    if !is_le_name(p) {
        return Err("Locale Emulator 的路径要指向 LEProc.exe，请到设置里重新选择".into());
    }
    if !p.is_file() {
        return Err("找不到 LEProc.exe，请到设置里重新选择".into());
    }
    Ok(p)
}

fn is_le_name(p: &Path) -> bool {
    p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.eq_ignore_ascii_case("LEProc.exe"))
}

/// 命令行：程序和每个参数都加引号（Windows 文件名里不会有引号，有的话不启动）
fn launch_line(program: &Path, args: &[&str]) -> Result<String, String> {
    let mut parts = vec![program.to_string_lossy().to_string()];
    parts.extend(args.iter().map(|a| a.to_string()));
    if parts.iter().any(|p| p.contains('"')) {
        return Err("路径里不能有引号".into());
    }
    Ok(parts.iter().map(|p| format!("\"{p}\"")).collect::<Vec<_>>().join(" "))
}

/// .bat 要交给 cmd.exe 跑。cmd 会在整行里展开 %变量%（加了引号也一样），开了延迟展开还有 !变量!，所以：
/// 工作目录设成 .bat 所在的文件夹（由 CreateProcess 设，不经过 cmd），命令行里只写 ".\文件名"，文件夹叫什么都不影响；
/// 文件名里有 cmd 会另作解释的字符（% ! ^ & 和引号）就不启动；/v:off 关掉延迟展开，/s /c ""…"" 让 cmd 只剥最外层引号。
/// 网络路径（\\server\share）cmd 不能当工作目录，也不启动。cmd 写全路径，不靠 PATH 去找
fn bat_line(bat: &Path) -> Result<String, String> {
    let name = bat.file_name().and_then(|n| n.to_str()).ok_or("启动程序路径不对")?;
    if name.contains(['%', '!', '^', '&', '"']) {
        return Err("批处理（.bat）的文件名里有 % ! ^ & 或引号，没法安全启动：请把文件改个名字".into());
    }
    if bat.to_string_lossy().starts_with(r"\\") {
        return Err("批处理（.bat）在网络路径上，没法启动：请换成游戏的 exe".into());
    }
    let windir = std::env::var("WINDIR").unwrap_or_else(|_| "C:/Windows".into());
    let cmd = Path::new(&windir).join("System32").join("cmd.exe");
    Ok(format!("{} /d /v:off /s /c \"\".\\{name}\"\"", launch_line(&cmd, &[])?))
}

/// 作业对象：把启动的游戏（和它再启动的进程）归到一起，等它们全部退出。只用来等退出，不限制、不结束它们，软件关了游戏照常开着
mod job {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use std::path::Path;
    use std::ptr::{null, null_mut};
    use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, HANDLE, INVALID_HANDLE_VALUE, WAIT_TIMEOUT};
    use windows_sys::Win32::System::IO::{CreateIoCompletionPort, GetQueuedCompletionStatus};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectAssociateCompletionPortInformation, JobObjectBasicAccountingInformation,
        QueryInformationJobObject, SetInformationJobObject, JOBOBJECT_ASSOCIATE_COMPLETION_PORT, JOBOBJECT_BASIC_ACCOUNTING_INFORMATION,
    };
    use windows_sys::Win32::System::SystemServices::JOB_OBJECT_MSG_ACTIVE_PROCESS_ZERO;
    use windows_sys::Win32::System::Threading::{CreateProcessW, ResumeThread, TerminateProcess, CREATE_NO_WINDOW, CREATE_SUSPENDED, PROCESS_INFORMATION, STARTUPINFOW};

    /// 完成端口每次最多等这么久，到点就自己数一下作业里还剩几个进程（通知不保证送达）
    const POLL_MS: u32 = 1000;

    pub struct Job {
        job: HANDLE,
        port: HANDLE,
    }
    // 句柄只是个数字，交给等待线程没问题
    unsafe impl Send for Job {}
    impl Drop for Job {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.job);
                CloseHandle(self.port);
            }
        }
    }

    fn wide(s: &OsStr) -> Vec<u16> {
        s.encode_wide().chain(std::iter::once(0)).collect()
    }

    /// 挂起状态创建进程，放进作业对象后再让它跑（这样它启动的子进程一定也在作业里）；作业关联一个完成端口，进程全退出时端口收到通知。
    /// 放不进作业（比如软件自己已经在不允许嵌套的作业里）就照常让游戏跑，只是这次不记时长，返回 None
    pub fn spawn(line: &str, cwd: &Path, no_window: bool) -> Result<Option<Job>, String> {
        unsafe {
            let job = CreateJobObjectW(null(), null());
            let port = CreateIoCompletionPort(INVALID_HANDLE_VALUE, null_mut(), 0, 1);
            let assoc = JOBOBJECT_ASSOCIATE_COMPLETION_PORT { CompletionKey: null_mut(), CompletionPort: port };
            let job_ok = !job.is_null()
                && !port.is_null()
                && SetInformationJobObject(job, JobObjectAssociateCompletionPortInformation, &assoc as *const _ as *const _, size_of::<JOBOBJECT_ASSOCIATE_COMPLETION_PORT>() as u32) != 0;
            let close_job = || {
                CloseHandle(job);
                CloseHandle(port);
            };
            let mut cmd = wide(OsStr::new(line));
            let cwd = wide(cwd.as_os_str());
            let mut si: STARTUPINFOW = std::mem::zeroed();
            si.cb = size_of::<STARTUPINFOW>() as u32;
            let mut pi: PROCESS_INFORMATION = std::mem::zeroed();
            let flags = CREATE_SUSPENDED | if no_window { CREATE_NO_WINDOW } else { 0 };
            if CreateProcessW(null(), cmd.as_mut_ptr(), null(), null(), 0, flags, null(), cwd.as_ptr(), &si, &mut pi) == 0 {
                let e = std::io::Error::last_os_error();
                close_job();
                return Err(e.to_string());
            }
            let in_job = job_ok && AssignProcessToJobObject(job, pi.hProcess) != 0;
            // 恢复失败的话进程会一直挂着：结束掉它，报错
            if ResumeThread(pi.hThread) == u32::MAX {
                let e = std::io::Error::last_os_error();
                TerminateProcess(pi.hProcess, 1);
                CloseHandle(pi.hThread);
                CloseHandle(pi.hProcess);
                close_job();
                return Err(format!("游戏进程没能开始运行：{e}"));
            }
            CloseHandle(pi.hThread);
            CloseHandle(pi.hProcess);
            if in_job {
                Ok(Some(Job { job, port }))
            } else {
                close_job();
                Ok(None)
            }
        }
    }

    impl Job {
        /// 等到作业里一个进程都不剩：收到 JOB_OBJECT_MSG_ACTIVE_PROCESS_ZERO，或者（通知丢了）自己数到 0。
        /// 端口或查询出错返回 Err：这时不知道游戏到底什么时候退出的
        pub fn wait(&self) -> Result<(), String> {
            unsafe {
                loop {
                    let (mut code, mut key, mut ov) = (0u32, 0usize, null_mut());
                    let ok = GetQueuedCompletionStatus(self.port, &mut code, &mut key, &mut ov, POLL_MS);
                    if ok != 0 && code == JOB_OBJECT_MSG_ACTIVE_PROCESS_ZERO {
                        return Ok(());
                    }
                    if ok == 0 && GetLastError() != WAIT_TIMEOUT {
                        return Err(format!("完成端口出错：{}", std::io::Error::last_os_error()));
                    }
                    if self.active()? == 0 {
                        return Ok(());
                    }
                }
            }
        }

        /// 这个作业里还在运行的进程数（只问自己的作业，不看别的进程）
        fn active(&self) -> Result<u32, String> {
            unsafe {
                let mut info: JOBOBJECT_BASIC_ACCOUNTING_INFORMATION = std::mem::zeroed();
                let size = size_of::<JOBOBJECT_BASIC_ACCOUNTING_INFORMATION>() as u32;
                if QueryInformationJobObject(self.job, JobObjectBasicAccountingInformation, &mut info as *mut _ as *mut _, size, null_mut()) == 0 {
                    return Err(format!("查不到作业里的进程数：{}", std::io::Error::last_os_error()));
                }
                Ok(info.ActiveProcesses)
            }
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        fn cmd_line(args: &str) -> String {
            let windir = std::env::var("WINDIR").unwrap_or_else(|_| "C:/Windows".into());
            format!("\"{}\" /d /c \"{args}\"", Path::new(&windir).join("System32").join("cmd.exe").display())
        }

        /// 完成通知丢了（这里先自己把它取走）：wait 到点数一下进程，照样正常返回
        #[test]
        fn wait_falls_back_to_counting() {
            let job = spawn(&cmd_line("exit"), &std::env::temp_dir(), true).unwrap().expect("进程应该能放进作业");
            unsafe {
                loop {
                    let (mut code, mut key, mut ov) = (0u32, 0usize, null_mut());
                    assert!(GetQueuedCompletionStatus(job.port, &mut code, &mut key, &mut ov, 10_000) != 0, "没等到通知");
                    if code == JOB_OBJECT_MSG_ACTIVE_PROCESS_ZERO {
                        break;
                    }
                }
            }
            let t = std::time::Instant::now();
            assert_eq!(job.wait(), Ok(()));
            assert!(t.elapsed() < std::time::Duration::from_secs(5));
        }

        /// 端口坏了：报监控失败，不当正常退出
        #[test]
        fn wait_reports_port_failure() {
            let mut job = spawn(&cmd_line("waitfor /t 2 BeatriceJobFail"), &std::env::temp_dir(), true).unwrap().expect("进程应该能放进作业");
            unsafe { CloseHandle(job.port) };
            job.port = null_mut();
            assert!(job.wait().is_err());
        }
    }
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

/// 检查作品目录：格式对、版本软件认得、资料不比软件自带的旧（先比日期 updated，同一天再比 revision，没写算 0）
fn check_catalog(text: &str, min_updated: &str, min_revision: u64) -> Result<(), String> {
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
    let revision = v["revision"].as_u64().unwrap_or(0);
    if (updated, revision) < (min_updated, min_revision) {
        let label = |d: &str, r: u64| if r > 0 { format!("{d} 修订 {r}") } else { d.to_string() };
        return Err(format!("这个数据包的资料（{}）比软件自带的（{}）旧，没有导入", label(updated, revision), label(min_updated, min_revision)));
    }
    Ok(())
}

/// 解压到 tmp：先读 catalog.json 检查，合格了才解压；只取认识的条目，超过上限就整包拒绝
fn extract_pack(zip_path: &Path, tmp: &Path, min_updated: &str, min_revision: u64, lim: &PackLimits) -> Result<String, String> {
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
    check_catalog(&catalog, min_updated, min_revision)?;

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
/// min_updated、min_revision 是软件自带资料的日期和 revision，比它旧的包不收（一样的收：包里可能有封面）
#[tauri::command]
fn import_pack(app: tauri::AppHandle, path: String, min_updated: String, min_revision: u64) -> Result<String, String> {
    let dir = pack_dir(&app)?;
    let tmp = dir.with_file_name("pack.new");
    let catalog = match extract_pack(Path::new(&path), &tmp, &min_updated, min_revision, &PACK_LIMITS) {
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

/// 我的游戏的封面放在 <app data>/custom-covers/<id>.<扩展名>
const CUSTOM_COVERS: &str = "custom-covers";
const CUSTOM_COVER_MAX: u64 = 10 << 20;

/// 我的游戏的 id：local- 加 1～40 个小写字母数字（和前端一致）
fn custom_id_ok(id: &str) -> bool {
    id.strip_prefix("local-").is_some_and(|r| (1..=40).contains(&r.len()) && r.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit()))
}

/// 看文件头认图片格式：只认 JPEG、PNG、WebP
fn image_ext(b: &[u8]) -> Option<&'static str> {
    if b.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("jpg")
    } else if b.starts_with(&PNG_SIGNATURE) {
        Some("png")
    } else if b.len() >= 12 && &b[..4] == b"RIFF" && &b[8..12] == b"WEBP" {
        Some("webp")
    } else {
        None
    }
}

fn custom_covers_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join(CUSTOM_COVERS))
}

/// 封面文件夹本身和它的上一级（软件的数据文件夹）都得是真的文件夹、不是链接，才往里写、删、读
fn plain_dir(dir: &Path) -> bool {
    [dir, dir.parent().unwrap_or(dir)].iter().all(|p| fs::symlink_metadata(p).is_ok_and(|m| m.is_dir() && !is_link(&m)))
}
const BAD_COVER_DIR: &str = "封面文件夹不对（是链接或读不了）";

/// 按规则起的封面文件名：<我的游戏 id>.jpg / png / webp
fn custom_cover_name(name: &str) -> bool {
    name.rsplit_once('.').is_some_and(|(id, ext)| custom_id_ok(id) && ["jpg", "png", "webp"].contains(&ext))
}

/// 读一个封面文件：不跟随链接，最多 10 MB
fn read_cover_file(path: &Path) -> Result<Vec<u8>, String> {
    let file = open_plain(path).ok_or("请选择一个图片文件")?;
    let mut bytes = Vec::new();
    file.take(CUSTOM_COVER_MAX + 1).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    if bytes.len() as u64 > CUSTOM_COVER_MAX {
        return Err("图片不能超过 10 MB".into());
    }
    Ok(bytes)
}

/// 给我的游戏换封面：只读用户这次选的那一个文件（路径上每一级都不能是链接，打开时也不跟随，最多 10 MB，文件头得是 jpg / png / webp），
/// 复制成 custom-covers/<id>.<扩展名>，返回文件名
#[tauri::command]
fn import_custom_cover(app: tauri::AppHandle, path: String, id: String) -> Result<String, String> {
    import_cover(&custom_covers_dir(&app)?, Path::new(&path), &id)
}

/// 先完整写进同一文件夹里的临时文件，再一步换上（同名的旧封面这时才被替换），失败时旧封面不动。
/// 换了扩展名的旧封面不在这里删：新文件名存进数据以后就没人用它了，下次启动时清掉
fn import_cover(dir: &Path, path: &Path, id: &str) -> Result<String, String> {
    if !custom_id_ok(id) {
        return Err("作品编号不对".into());
    }
    if !no_links(path) {
        return Err("图片的路径里有链接（符号链接或目录联接），请直接选原来的文件".into());
    }
    let bytes = read_cover_file(path)?;
    let ext = image_ext(&bytes).ok_or("只支持 jpg、png、webp 图片")?;
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    if !plain_dir(dir) {
        return Err(BAD_COVER_DIR.into());
    }
    let name = format!("{id}.{ext}");
    let tmp = dir.join(format!("{id}.tmp"));
    let _ = fs::remove_file(&tmp);
    let res = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&tmp)
        .and_then(|mut f| f.write_all(&bytes).and_then(|()| f.sync_all()))
        .and_then(|()| replace_file(&tmp, &dir.join(&name), &bytes));
    if let Err(e) = res {
        let _ = fs::remove_file(&tmp);
        return Err(e.to_string());
    }
    Ok(name)
}

/// 改名时的错误 17（「不能移到不同的磁盘驱动器」）：360 这类安全软件不让没签名的程序在 AppData 里改名，同一个文件夹里也不行
const NO_RENAME: i32 = 17;

/// 用写好的临时文件 tmp（内容是 bytes）换掉同一文件夹里的 path：一步换上，失败时旧文件不动。
/// 不让改名时只能直接写到 path 上（path 是链接就不写），写失败把旧内容写回去
fn replace_file(tmp: &Path, path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    match fs::rename(tmp, path) {
        Err(e) if e.raw_os_error() == Some(NO_RENAME) && fs::symlink_metadata(path).map_or(true, |m| !is_link(&m)) => {
            let _ = fs::remove_file(tmp);
            let old = fs::read(path).ok();
            fs::write(path, bytes).inspect_err(|_| {
                if let Some(o) = &old {
                    let _ = fs::write(path, o);
                }
            })
        }
        r => r,
    }
}

/// 启动时清理（只在成功读到数据以后）：custom-covers 里不在 keep 里的封面删掉（移除我的游戏时先留着封面，好撤销）。
/// 只动这个文件夹里按规则起名的普通文件；文件夹是链接就什么都不动
#[tauri::command]
fn prune_custom_covers(app: tauri::AppHandle, keep: Vec<String>) -> Result<(), String> {
    prune_covers(&custom_covers_dir(&app)?, &keep);
    Ok(())
}

fn prune_covers(dir: &Path, keep: &[String]) {
    if !plain_dir(dir) {
        return;
    }
    let Ok(rd) = fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        // 每删一个前再看一次文件夹，缩小检查完被换成链接的窗口
        if custom_cover_name(&name) && !keep.contains(&name) && plain_meta(&e).is_some_and(|m| m.is_file()) && plain_dir(dir) {
            let _ = fs::remove_file(e.path());
        }
    }
}

/// 梯度表导出图片用：读我的游戏的一张封面。只读 custom-covers 下按规则起名的图片，不跟随链接
#[tauri::command]
fn read_custom_cover(app: tauri::AppHandle, name: String) -> Result<tauri::ipc::Response, String> {
    read_custom_cover_in(&custom_covers_dir(&app)?, &name).map(tauri::ipc::Response::new)
}

fn read_custom_cover_in(dir: &Path, name: &str) -> Result<Vec<u8>, String> {
    if !custom_cover_name(name) {
        return Err("封面文件名不对".into());
    }
    if !plain_dir(dir) {
        return Err(BAD_COVER_DIR.into());
    }
    read_cover_file(&dir.join(name))
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
            read_custom_cover,
            import_custom_cover,
            prune_custom_covers,
            write_png
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn custom_covers() {
        assert!(custom_id_ok("local-abc123"));
        assert!(!custom_id_ok("local-"));
        assert!(!custom_id_ok("local-../x"));
        assert!(!custom_id_ok("local-ABC"));
        assert!(!custom_id_ok("RJ000000"));
        assert_eq!(image_ext(&[0xFF, 0xD8, 0xFF, 0xE0]), Some("jpg"));
        assert_eq!(image_ext(&PNG_SIGNATURE), Some("png"));
        assert_eq!(image_ext(b"RIFF\0\0\0\0WEBPVP8 "), Some("webp"));
        assert_eq!(image_ext(b"GIF89a"), None);
        assert_eq!(image_ext(b"MZ"), None);
    }

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

    #[test]
    fn launch_lines() {
        // 普通启动、转区启动的命令行：程序和参数都带引号
        assert_eq!(launch_line(Path::new(r"D:\Games\A B\Game.exe"), &[]).unwrap(), r#""D:\Games\A B\Game.exe""#);
        assert_eq!(
            launch_line(Path::new(r"D:\LE\LEProc.exe"), &["-run", r"D:\Games\A B\Game.exe"]).unwrap(),
            r#""D:\LE\LEProc.exe" "-run" "D:\Games\A B\Game.exe""#
        );
        assert!(launch_line(Path::new("D:\\x\\a\"b.exe"), &[]).is_err());
        // .bat 交给 cmd.exe：命令行里只有文件名（工作目录是它的文件夹），关掉延迟展开
        let bat = bat_line(Path::new(r"D:\Games\A %PATH% & B!\与工具一同启动.bat")).unwrap();
        assert!(bat.to_ascii_lowercase().contains(r"\system32\cmd.exe"), "{bat}");
        assert!(bat.ends_with(r#" /d /v:off /s /c "".\与工具一同启动.bat"""#), "{bat}");
        for bad in ["a%b.bat", "a!b.bat", "a^b.bat", "a&b.bat"] {
            assert!(bat_line(&Path::new(r"D:\Games").join(bad)).is_err(), "{bad}");
        }
        assert!(bat_line(Path::new(r"\\server\share\run.bat")).is_err());
        // Locale Emulator 只认 LEProc.exe
        assert!(is_le_name(Path::new(r"D:\LE\LEProc.exe")));
        assert!(is_le_name(Path::new(r"D:\LE\leproc.EXE")));
        assert!(!is_le_name(Path::new(r"D:\LE\LEGUI.exe")));
        assert!(!is_le_name(Path::new(r"D:\LE\LEProc.exe.bat")));
        assert!(check_le(Path::new(r"D:\nowhere\LEGUI.exe")).unwrap_err().contains("LEProc.exe"));
        assert!(check_le(Path::new(r"D:\nowhere\LEProc.exe")).unwrap_err().contains("找不到"));
    }

    /// 作业对象真的等到子进程的子进程退出：cmd 用 start /b 拉起一个 waitfor（等 1 秒超时退出）后自己先退出，wait 要等 waitfor 也退了才回来
    #[test]
    fn job_waits_for_grandchildren() {
        let line = bat_line(Path::new(r"C:\unused.bat")).unwrap();
        let cmd = line.split(" /d ").next().unwrap().to_string(); // "C:\Windows\System32\cmd.exe"
        let run = |args: &str| {
            let job = job::spawn(&format!("{cmd} /d /c \"{args}\""), &std::env::temp_dir(), true).unwrap().expect("进程应该能放进作业");
            let (tx, rx) = std::sync::mpsc::channel();
            let t = std::time::Instant::now();
            std::thread::spawn(move || {
                job.wait().unwrap();
                let _ = tx.send(t.elapsed());
            });
            rx.recv_timeout(std::time::Duration::from_secs(20)).expect("wait 没有回来")
        };
        assert!(run("exit") < std::time::Duration::from_secs(5));
        assert!(run("start /b waitfor /t 1 BeatriceJobTest") >= std::time::Duration::from_millis(900));
    }

    /// 真的用 cmd 跑 .bat：文件夹名里有空格、& % ! ^ 括号（还有像变量的 %USERNAME%）都照常启动，不会被 cmd 展开
    #[test]
    fn bat_runs_in_odd_folders() {
        let root = std::env::temp_dir().join(format!("beatrice-bat-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        for (folder, file) in [("A B", "run me.bat"), ("x & y", "go.bat"), ("100% %USERNAME% 50%", "go.bat"), ("Wow! !x!", "go.bat"),
            ("a^b", "go.bat"), ("(体验版) [v1.0]", "启动 (1).bat")] {
            let dir = root.join(folder);
            fs::create_dir_all(&dir).unwrap();
            let bat = dir.join(file);
            fs::write(&bat, b"@echo ok> ran.txt\r\n").unwrap();
            let line = bat_line(&bat).unwrap();
            let job = job::spawn(&line, &dir, true).unwrap().expect("进程应该能放进作业");
            job.wait().unwrap();
            assert!(dir.join("ran.txt").is_file(), "{folder}\\{file}: {line}");
        }
        fs::remove_dir_all(&root).ok();
    }

    /// 扫描和读标题不跟随目录联接（junction）和符号链接：链接到外面的标题文件、整个游戏文件夹都不读。
    /// 建不了联接（mklink /J 不用管理员，一般都行）就跳过
    #[test]
    fn links_not_followed() {
        let root = std::env::temp_dir().join(format!("beatrice-links-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let outside = root.join("outside");
        let lib = root.join("lib");
        fs::create_dir_all(outside.join("inner")).unwrap();
        fs::write(outside.join("Game.exe"), b"x").unwrap();
        fs::write(outside.join("package.json"), br#"{"name": "Secret Title"}"#).unwrap();
        fs::write(outside.join("inner").join("package.json"), br#"{"name": "Secret Inner"}"#).unwrap();
        fs::create_dir_all(lib.join("Real")).unwrap();
        fs::write(lib.join("Real").join("Game.exe"), b"x").unwrap();
        fs::create_dir_all(lib.join("Wrap")).unwrap();
        let junction = |link: &Path, target: &Path| {
            let windir = std::env::var("WINDIR").unwrap_or_else(|_| "C:/Windows".into());
            std::process::Command::new(Path::new(&windir).join("System32").join("cmd.exe"))
                .args(["/d", "/c", "mklink", "/J"]).arg(link).arg(target)
                .output().is_ok_and(|o| o.status.success()) && link.exists()
        };
        let ok = junction(&lib.join("Real").join("www"), &outside) // 游戏文件夹里的中间目录指到外面
            && junction(&lib.join("Real").join("resources"), &root) // resources/app/package.json 也走不出去
            && junction(&lib.join("Linked"), &outside) // 游戏文件夹本身是联接
            && junction(&lib.join("Wrap").join("inner"), &outside); // 包装层里只有一个联接
        if !ok {
            eprintln!("建不了目录联接，跳过");
            fs::remove_dir_all(&root).ok();
            return;
        }
        fs::create_dir_all(root.join("app")).unwrap();
        fs::write(root.join("app").join("package.json"), br#"{"name": "Secret App"}"#).unwrap();
        // 文件符号链接要开发者模式或管理员，建不了就只测联接
        let file_link = std::os::windows::fs::symlink_file(outside.join("package.json"), lib.join("Real").join("Game.ini")).is_ok();
        let found = scan_roots(vec![lib.to_string_lossy().to_string()]);
        let names: Vec<&str> = found.iter().map(|f| f.name.as_str()).collect();
        assert_eq!(names, ["Real"]);
        assert_eq!(found[0].names, ["Real", "Game"]);
        assert!(read_title(&lib.join("Real"), "www/package.json").is_none());
        assert!(read_title(&lib.join("Real"), "www/inner/package.json").is_none());
        if file_link {
            assert!(read_title(&lib.join("Real"), "Game.ini").is_none());
            assert!(read_text(&lib.join("Real").join("Game.ini")).is_none());
        }
        fs::remove_dir_all(&root).ok();
    }

    /// 我的游戏的封面：换封面先写临时文件再一步换上，失败时旧的还在；路径里有链接、封面文件夹是链接都不读不写不删
    #[test]
    fn custom_cover_files() {
        let root = std::env::temp_dir().join(format!("beatrice-covers-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let (pics, dir, outside) = (root.join("pics"), root.join("data").join(CUSTOM_COVERS), root.join("outside"));
        fs::create_dir_all(&pics).unwrap();
        fs::create_dir_all(&outside).unwrap();
        let png = [&PNG_SIGNATURE[..], b"one"].concat();
        let jpg = [0xFF, 0xD8, 0xFF, 0xE0, b'2'];
        fs::write(pics.join("a.png"), &png).unwrap();
        fs::write(pics.join("b.jpg"), jpg).unwrap();
        fs::write(pics.join("c.txt"), b"not an image").unwrap();
        let id = "local-abc";
        assert_eq!(import_cover(&dir, &pics.join("a.png"), id).unwrap(), "local-abc.png");
        assert_eq!(fs::read(dir.join("local-abc.png")).unwrap(), png);
        // 不是图片、编号不对：旧封面不动
        assert!(import_cover(&dir, &pics.join("c.txt"), id).is_err());
        assert!(import_cover(&dir, &pics.join("a.png"), "local-../x").is_err());
        assert_eq!(fs::read(dir.join("local-abc.png")).unwrap(), png);
        // 临时文件写不了（那里是个文件夹）：报错，旧封面还在
        fs::create_dir_all(dir.join("local-abc.tmp")).unwrap();
        let png2 = [&PNG_SIGNATURE[..], b"two"].concat();
        fs::write(pics.join("a.png"), &png2).unwrap();
        assert!(import_cover(&dir, &pics.join("a.png"), id).is_err());
        assert_eq!(fs::read(dir.join("local-abc.png")).unwrap(), png);
        fs::remove_dir(dir.join("local-abc.tmp")).unwrap();
        // 同名替换；换成别的格式时旧文件先留着，没人用了才由启动清理删掉
        import_cover(&dir, &pics.join("a.png"), id).unwrap();
        assert_eq!(fs::read(dir.join("local-abc.png")).unwrap(), png2);
        assert_eq!(import_cover(&dir, &pics.join("b.jpg"), id).unwrap(), "local-abc.jpg");
        assert!(dir.join("local-abc.png").exists() && !dir.join("local-abc.tmp").exists());
        assert_eq!(read_custom_cover_in(&dir, "local-abc.jpg").unwrap(), jpg);
        assert!(read_custom_cover_in(&dir, "../outside/x.jpg").is_err());
        assert!(read_custom_cover_in(&dir, "local-abc.gif").is_err());
        fs::write(dir.join("notes.png"), b"x").unwrap();
        prune_covers(&dir, &["local-abc.jpg".to_string()]);
        assert!(!dir.join("local-abc.png").exists() && dir.join("local-abc.jpg").exists() && dir.join("notes.png").exists());

        let junction = |link: &Path, target: &Path| {
            let windir = std::env::var("WINDIR").unwrap_or_else(|_| "C:/Windows".into());
            std::process::Command::new(Path::new(&windir).join("System32").join("cmd.exe"))
                .args(["/d", "/c", "mklink", "/J"]).arg(link).arg(target)
                .output().is_ok_and(|o| o.status.success()) && link.exists()
        };
        // 选的图片在联接下面：不读
        if !junction(&root.join("via"), &pics) {
            eprintln!("建不了目录联接，跳过链接部分");
            fs::remove_dir_all(&root).ok();
            return;
        }
        assert!(import_cover(&dir, &root.join("via").join("b.jpg"), "local-new").is_err());
        assert!(!dir.join("local-new.jpg").exists());
        // custom-covers 本身被换成联接：不写、不删、不读，外面的文件不动
        fs::write(outside.join("local-zzz.png"), &png).unwrap();
        let linked = root.join("data2").join(CUSTOM_COVERS);
        fs::create_dir_all(linked.parent().unwrap()).unwrap();
        assert!(junction(&linked, &outside));
        assert!(import_cover(&linked, &pics.join("b.jpg"), "local-new").is_err());
        prune_covers(&linked, &[]);
        assert!(read_custom_cover_in(&linked, "local-zzz.png").is_err());
        assert!(outside.join("local-zzz.png").exists() && !outside.join("local-new.jpg").exists());
        // 文件符号链接要开发者模式或管理员，建得了才测：封面文件夹里的链接不读也不删
        if std::os::windows::fs::symlink_file(outside.join("local-zzz.png"), dir.join("local-lnk.png")).is_ok() {
            assert!(read_custom_cover_in(&dir, "local-lnk.png").is_err());
            prune_covers(&dir, &[]);
            assert!(outside.join("local-zzz.png").exists());
        }
        fs::remove_dir_all(&root).ok();
    }

    /// 在 AppData 里换封面：装了 360 这类软件时改名会被拦（错误 17），走直接写的那条路；没装就是正常改名
    #[test]
    fn cover_replace_in_appdata() {
        let Ok(base) = std::env::var("LOCALAPPDATA") else { return };
        let root = Path::new(&base).join(format!("beatrice-cover-test-{}", std::process::id()));
        let (dir, src) = (root.join(CUSTOM_COVERS), std::env::temp_dir().join(format!("beatrice-cover-src-{}.png", std::process::id())));
        for body in [&b"one"[..], b"two"] {
            let png = [&PNG_SIGNATURE[..], body].concat();
            fs::write(&src, &png).unwrap();
            assert_eq!(import_cover(&dir, &src, "local-abc").unwrap(), "local-abc.png");
            assert_eq!(fs::read(dir.join("local-abc.png")).unwrap(), png);
            assert!(!dir.join("local-abc.tmp").exists());
        }
        fs::remove_file(&src).ok();
        fs::remove_dir_all(&root).ok();
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
            extract_pack(&zip, &tmp, "2026-10-27", 0, &lim)
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
        let ok = extract_pack(&zip, &tmp, "2026-10-27", 0, &lim);
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
        assert!(check_catalog(&cat(r#"{"id":"RJ1","cover":"covers/RJ1.jpg"},{"id":"RJ2"},{"id":"RJ3","cover":""}"#), "2026-01-01", 0).is_ok());
        assert!(check_catalog(&cat(r#"{"id":"RJ1"},{"title":"没有编号"}"#), "2026-01-01", 0).unwrap_err().contains("编号"));
        assert!(check_catalog(&cat(r#"{"id":"  "}"#), "2026-01-01", 0).unwrap_err().contains("编号"));
        assert!(check_catalog(&cat(r#""不是对象""#), "2026-01-01", 0).unwrap_err().contains("编号"));
        assert!(check_catalog(&cat(r#"{"id":"RJ1","cover":"covers/../../evil.jpg"}"#), "2026-01-01", 0).unwrap_err().contains("封面"));
        assert!(check_catalog(&cat(r#"{"id":"RJ1","cover":7}"#), "2026-01-01", 0).unwrap_err().contains("封面"));
    }

    #[test]
    fn catalog_revision_orders_same_day_packs() {
        let cat = |rev: &str| format!(r#"{{"version":2,"updated":"2026-10-28"{rev},"games":[]}}"#);
        // 旧包没有 revision，算 0：比自带的 2026-10-28 修订 1 旧
        let err = check_catalog(&cat(""), "2026-10-28", 1).unwrap_err();
        assert!(err.contains("（2026-10-28）比软件自带的（2026-10-28 修订 1）旧"), "{err}");
        assert!(check_catalog(&cat(r#","revision":"x""#), "2026-10-28", 1).is_err()); // 写错的当 0
        // 同一天 revision 更高的收；日期和 revision 都一样的也收（含封面的完整包）
        assert!(check_catalog(&cat(r#","revision":2"#), "2026-10-28", 1).is_ok());
        assert!(check_catalog(&cat(r#","revision":1"#), "2026-10-28", 1).is_ok());
        assert!(check_catalog(&cat(""), "2026-10-28", 0).is_ok());
        // 日期新的不看 revision；日期旧的 revision 再高也不收
        assert!(check_catalog(&cat(""), "2026-10-27", 5).is_ok());
        assert!(check_catalog(&cat(r#","revision":9"#), "2026-10-29", 0).unwrap_err().contains("旧"));
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

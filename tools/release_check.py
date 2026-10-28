"""发布前检查：依赖漏洞（cargo audit、npm audit）和隐私搜索，结果汇总打印。

运行：python -X utf8 tools/release_check.py（cargo 和 npm 要在 PATH 里，或者设好 CARGO_HOME）
有问题时退出码是 1。
"""
import json
import os
import pathlib
import shutil
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
APP = ROOT / "app"
TAURI = APP / "src-tauri"
ENV = dict(os.environ)
if ENV.get("CARGO_HOME"):
    ENV["PATH"] = os.path.join(ENV["CARGO_HOME"], "bin") + os.pathsep + ENV.get("PATH", "")

# 可选：软件里不能出现的个人信息（用户名、文件夹名、邮箱、称呼），写在不进 git 的本地文件里，没有这个文件就跳过隐私搜索：
# 一行一个词；「词|例外1,例外2」表示包含这个词的正常用词不算（比如日文里表示主角的那个词）
TERMS_FILE = pathlib.Path(__file__).with_name("privacy_terms.txt")
_lines = [l.strip() for l in TERMS_FILE.read_text(encoding="utf-8").splitlines() if l.strip()] if TERMS_FILE.exists() else []
TERMS = [l.split("|")[0] for l in _lines]
ALLOWED = {l.split("|")[0]: [x for x in l.split("|")[1].split(",") if x] for l in _lines if "|" in l}


def run(cmd, cwd):
    return subprocess.run(cmd, cwd=cwd, env=ENV, capture_output=True, text=True, encoding="utf-8", errors="replace")


def cargo_audit():
    if not shutil.which("cargo-audit", path=ENV["PATH"]):
        print("  没有 cargo-audit，正在安装（第一次要几分钟）…")
        r = run(["cargo", "install", "cargo-audit", "--locked"], ROOT)
        if r.returncode:
            return False, ["安装 cargo-audit 失败：" + r.stderr.strip()[-300:]]
    r = run(["cargo", "audit", "--json"], TAURI)
    try:
        rep = json.loads(r.stdout)
    except json.JSONDecodeError:
        return False, ["cargo audit 没给出结果：" + (r.stderr or r.stdout).strip()[-300:]]
    lines = []
    for v in rep.get("vulnerabilities", {}).get("list", []):
        a, p = v["advisory"], v["package"]
        lines.append(f"漏洞 {a['id']} {p['name']} {p['version']}：{a['title']}")
    for kind, items in (rep.get("warnings") or {}).items():
        for w in items:
            a, p = w.get("advisory") or {}, w["package"]
            lines.append(f"提醒（{kind}）{a.get('id', '')} {p['name']} {p['version']}：{a.get('title', '')}")
    found = rep.get("vulnerabilities", {}).get("found", False)
    return not found, lines or ["没有已知漏洞"]


def npm_audit():
    npm = shutil.which("npm")
    if not npm:
        return False, ["找不到 npm"]
    r = run([npm, "audit", "--omit=dev", "--json"], APP)
    try:
        rep = json.loads(r.stdout)
    except json.JSONDecodeError:
        return False, ["npm audit 没给出结果：" + (r.stderr or r.stdout).strip()[-300:]]
    counts = rep.get("metadata", {}).get("vulnerabilities", {})
    total = counts.get("total", 0)
    lines = [f"{name}：{v.get('severity')}" for name, v in rep.get("vulnerabilities", {}).items()]
    return total == 0, lines or ["没有已知漏洞"]


def privacy_scan():
    files = [p for p in (APP / "dist").rglob("*") if p.is_file()]
    exe = TAURI / "target" / "release" / "beatrice.exe"
    if exe.exists():
        files.append(exe)
    files += sorted((TAURI / "target" / "release" / "bundle" / "nsis").glob("*.exe"))
    if not TERMS:
        return True, [f"没有 {TERMS_FILE.name}，跳过（想检查就在 tools 下新建它，一行写一个不能出现的词，这个文件不进 git）"]
    if not files:
        return False, ["没有可以检查的文件（先 npm run build 或 npx tauri build）"]
    hits = []
    for f in files:
        data = f.read_bytes()
        for t in TERMS:
            for enc, label in (("utf-8", t), ("utf-16-le", t + "（UTF-16）")):
                n = data.count(t.encode(enc)) - sum(data.count(ok.encode(enc)) for ok in ALLOWED.get(t, []))
                if n > 0:
                    hits.append(f"{f.relative_to(ROOT)} 里有「{label}」{n} 处")
    names = "、".join(sorted({str(f.relative_to(ROOT).parent) for f in files}))
    return not hits, hits or [f"检查了 {len(files)} 个文件（{names}），没有找到"]


def main():
    ok_all = True
    for title, check in (("cargo audit（Rust 依赖）", cargo_audit), ("npm audit（前端依赖）", npm_audit), ("隐私搜索", privacy_scan)):
        print(f"\n== {title} ==")
        ok, lines = check()
        ok_all &= ok
        for line in lines:
            print("  " + line)
        print("  → " + ("通过" if ok else "有问题"))
    print("\n全部通过" if ok_all else "\n有需要处理的问题，见上面")
    return 0 if ok_all else 1


if __name__ == "__main__":
    sys.exit(main())

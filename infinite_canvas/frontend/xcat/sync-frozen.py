"""把 src/xcat/logic/*.js 的可读真源同步进固化应用源码。

阶段 11 / batch 5 之后，画布应用主体是 src/xcat/app/canvas-app.js（自包含
IIFE）。其中 02/03/05/06 四段是历史上由这些 ES 模块真源生成的顶层代码，
现在用显式的 XCAT-SOURCE-BEGIN/END 标记包起来，使真源重新成为可生效的
事实来源：

    改 src/xcat/logic/*.js
      -> python xcat/sync-frozen.py
      -> npm run build:check
      -> node xcat/verify-source-logic.mjs

    python xcat/sync-frozen.py --check      # 幂等校验，不写文件
    python xcat/sync-frozen.py --migrate-from <dir>   # 一次性：从旧生成片段定位

渲染规则与历史生成器完全一致：剥掉行首 `export `，确保文件以换行结尾，
多文件按顺序拼接，末尾追加全局挂接语句。这样生成的文本仍然是普通顶层
函数声明，不引入模块级 const/let，避免 mount("#app") 之前的 TDZ。
"""
import argparse
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
FE = os.path.dirname(HERE)
LOGIC = os.path.join(FE, "src", "xcat", "logic")
FROZEN = os.path.join(FE, "src", "xcat", "app", "canvas-app.js")

# (标记 id, 真源文件列表, 末尾追加的全局挂接语句)
PARTS = [
    ("02-canvas-tabs-core", ["canvas-tabs.js", "canvas-tabs-bridge.js"], ""),
    ("03-save-dialog", ["save-dialog.js"], ""),
    ("05-node-role", ["node-role.js"], "try{installNodeRoleGlobals();}catch(e){}\n"),
    ("06-workflow-scope", ["workflow-scope.js"],
     "try{installWorkflowGlobals();}catch(e){}\n"),
]


def render(names, tail):
    chunks = []
    for name in names:
        text = open(os.path.join(LOGIC, name), encoding="utf8").read()
        if not text.endswith("\n"):
            text += "\n"
        chunks.append(re.sub(r"^export ", "", text, flags=re.M))
    return "".join(chunks) + tail


def markers(pid):
    return ("/* XCAT-SOURCE-BEGIN: %s */\n" % pid,
            "/* XCAT-SOURCE-END: %s */\n" % pid)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="只校验，不写文件")
    ap.add_argument("--migrate-from", default="",
                    help="一次性迁移：该目录下的 <id>.js.txt 是旧生成片段")
    args = ap.parse_args()

    text = open(FROZEN, encoding="utf8").read()
    drift = []
    for pid, names, tail in PARTS:
        begin, end = markers(pid)
        block = begin + render(names, tail) + end
        if begin in text:
            s = text.index(begin)
            if end not in text[s:]:
                print("ERROR: %s missing END marker" % pid, file=sys.stderr)
                return 2
            e = text.index(end, s) + len(end)
            same = text[s:e] == block
            if args.check and not same:
                drift.append(pid)
            elif not args.check and not same:
                text = text[:s] + block + text[e:]
            print("%s  %s  %d B" % (pid, "OK" if same else "SYNCED",
                                    len(block.encode("utf8"))))
        else:
            if args.check:
                print("ERROR: %s has no markers" % pid, file=sys.stderr)
                return 2
            if not args.migrate_from:
                print("ERROR: %s has no markers; pass --migrate-from <dir>" % pid,
                      file=sys.stderr)
                return 2
            old_path = os.path.join(args.migrate_from, pid + ".js.txt")
            old = open(old_path, encoding="utf8").read()
            if text.count(old) != 1:
                print("ERROR: %s old fragment hits %d (expected 1)" %
                      (pid, text.count(old)), file=sys.stderr)
                return 2
            text = text.replace(old, block, 1)
            print("%s  MIGRATED  %d B -> %d B" %
                  (pid, len(old.encode("utf8")), len(block.encode("utf8"))))

    if args.check:
        if drift:
            print("FAIL: %s drifted from src/xcat/logic/" % ", ".join(drift),
                  file=sys.stderr)
            return 1
        print("PASS: 4 frozen blocks == src/xcat/logic/*.js")
        return 0

    with open(FROZEN, "w", encoding="utf8", newline="") as f:
        f.write(text)
    print("wrote", FROZEN, os.path.getsize(FROZEN), "B")
    return 0


if __name__ == "__main__":
    sys.exit(main())

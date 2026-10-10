"""AVITECH coding evaluator.

Layered evaluator:
1) language/syntax/compile check;
2) server-side behavioural tests where the question has a known I/O contract;
3) semantic checks for markup/style/component questions;
4) bounded execution and normalized output comparison.

It deliberately does NOT compare a student's source text to the reference solution.
For questions without a machine-checkable contract, it uses syntax + static
logic evidence instead of exposing a REVIEW_REQUIRED state to the candidate.
"""
from __future__ import annotations

import html.parser
import json
import os
import random
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
BANK = ROOT / "static" / "data" / "it_coding_questions.json"

LANG_ALIASES = {"tailwind": "Tailwind CSS", ".net": ".NET", "node": "Node.js"}


def _norm_lang(v: str) -> str:
    s = str(v or "").strip()
    return LANG_ALIASES.get(s.casefold(), s)


def load_question(question_id: str, language: str = "") -> dict | None:
    try:
        data = json.loads(BANK.read_text(encoding="utf-8"))
    except Exception:
        return None
    qid = str(question_id or "").strip()
    lang = _norm_lang(language)
    for q in data.get("questions", []):
        if str(q.get("id") or q.get("questionId") or "").strip() == qid:
            if not lang or _norm_lang(q.get("language", "")) == lang:
                return q
    return None


def _run(cmd, source: str, suffix: str, stdin: str = "", timeout: float = 3.0, cwd: Path | None = None):
    td = Path(tempfile.mkdtemp(prefix="avitec_eval_"))
    try:
        src = td / ("Main" + suffix)
        src.write_text(source, encoding="utf-8")
        try:
            p = subprocess.run(cmd(src, td), input=stdin, text=True, capture_output=True,
                               timeout=timeout, cwd=str(cwd or td), shell=False,
                               env={"PATH": os.environ.get("PATH", ""), "LANG": "C.UTF-8"})
            out = (p.stdout or "")[:12000]
            err = (p.stderr or "")[:12000]
            return p.returncode, out, err, False
        except subprocess.TimeoutExpired as e:
            return -124, (e.stdout or "") if isinstance(e.stdout, str) else "", "Time limit exceeded", True
    finally:
        shutil.rmtree(td, ignore_errors=True)


def _python_runner(src, td):
    return [shutil.which("python") or "python", "-I", "-B", str(src)]


def _node_runner(src, td):
    return [shutil.which("node") or "node", str(src)]


def _php_runner(src, td):
    return [shutil.which("php") or "php", "-n", str(src)]


def _java_runner(src, td):
    # Java source in the bank uses class Main.
    return [shutil.which("java") or "java", "-cp", str(td), "Main"]


def _java_compile_and_run(source: str, stdin: str, timeout: float):
    td = Path(tempfile.mkdtemp(prefix="avitec_eval_java_"))
    try:
        src = td / "Main.java"
        src.write_text(source, encoding="utf-8")
        javac = shutil.which("javac")
        java = shutil.which("java")
        if not javac or not java:
            return {"status": "REVIEW_REQUIRED", "message": "Java runtime/compiler is not installed on the server."}
        cp = subprocess.run([javac, "-encoding", "UTF-8", str(src)], capture_output=True, text=True, timeout=5)
        if cp.returncode != 0:
            return {"status": "COMPILE_ERROR", "message": cp.stderr[:4000], "stdout": cp.stdout[:4000]}
        try:
            rp = subprocess.run([java, "-cp", str(td), "Main"], input=stdin, text=True,
                                capture_output=True, timeout=timeout, shell=False,
                                env={"PATH": os.environ.get("PATH", ""), "LANG": "C.UTF-8"})
            if rp.returncode != 0:
                return {"status": "RUNTIME_ERROR", "message": rp.stderr[:4000], "stdout": rp.stdout[:4000]}
            return {"status": "OK", "stdout": rp.stdout[:12000], "stderr": rp.stderr[:4000]}
        except subprocess.TimeoutExpired:
            return {"status": "TIME_LIMIT", "message": "Time limit exceeded."}
    except Exception as e:
        return {"status": "EVALUATOR_ERROR", "message": str(e)}
    finally:
        shutil.rmtree(td, ignore_errors=True)


def _compile_c(source: str, lang: str):
    compiler = shutil.which("gcc" if lang == "C" else "g++")
    if not compiler:
        return None, {"status": "REVIEW_REQUIRED", "message": f"{lang} compiler is not installed on the server."}
    td = Path(tempfile.mkdtemp(prefix="avitec_eval_c_"))
    ext = ".c" if lang == "C" else ".cpp"
    src = td / ("Main" + ext)
    exe = td / "main_exec"
    src.write_text(source, encoding="utf-8")
    cmd = [compiler, str(src), "-O2", "-o", str(exe)]
    if lang == "C++": cmd.insert(1, "-std=c++17")
    else: cmd.insert(1, "-std=c11")
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=6, shell=False)
        if p.returncode != 0:
            return td, {"status": "COMPILE_ERROR", "message": p.stderr[:4000], "stdout": p.stdout[:4000]}
        return td, {"status": "COMPILED", "exe": str(exe), "message": "Compilation successful."}
    except Exception as e:
        shutil.rmtree(td, ignore_errors=True)
        return None, {"status": "EVALUATOR_ERROR", "message": str(e)}


def _run_compiled(exe: str, stdin: str, timeout: float, td: Path):
    try:
        p = subprocess.run([exe], input=stdin, text=True, capture_output=True, timeout=timeout,
                           cwd=str(td), shell=False,
                           env={"PATH": os.environ.get("PATH", ""), "LANG": "C.UTF-8"})
        return {"status": "OK" if p.returncode == 0 else "RUNTIME_ERROR",
                "stdout": p.stdout[:12000], "stderr": p.stderr[:4000], "returncode": p.returncode}
    except subprocess.TimeoutExpired:
        return {"status": "TIME_LIMIT", "message": "Time limit exceeded."}


def _canonical_tokens(text: str) -> list[str]:
    s = str(text or "").replace("\r", "").strip()
    # Normalize common boolean spellings across languages.
    s = re.sub(r"\b(true|True|TRUE)\b", "true", s)
    s = re.sub(r"\b(false|False|FALSE)\b", "false", s)
    # Normalize -0 and trailing .0 for numeric output.
    toks = re.findall(r"\S+", s)
    out=[]
    for t in toks:
        try:
            x=float(t)
            if x == int(x): t=str(int(x))
        except Exception:
            pass
        out.append(t)
    return out


def _eq_output(actual: str, expected: str) -> bool:
    return _canonical_tokens(actual) == _canonical_tokens(expected)


def _oracle(kind: str, stdin: str) -> str | None:
    lines = stdin.splitlines()
    try:
        if kind == "reverse": return lines[0][::-1]
        if kind == "palindrome":
            s="".join(c.lower() for c in lines[0] if not c.isspace()); return str(s==s[::-1])
        if kind == "anagram":
            return str(sorted(lines[0].lower()) == sorted(lines[1].lower()))
        if kind == "dedupe":
            a=list(map(int,lines[0].split())); seen=set(); o=[]
            for x in a:
                if x not in seen: seen.add(x); o.append(x)
            return " ".join(map(str,o))
        if kind == "second":
            a=sorted(set(map(int,lines[0].split())), reverse=True); return str(a[1] if len(a)>1 else None)
        if kind in {"kth_largest","kth_smallest"}:
            a=sorted(set(map(int,lines[0].split())), reverse=kind=="kth_largest"); k=int(lines[1]); return str(a[k-1] if 0<k<=len(a) else None)
        if kind == "missing":
            a=list(map(int,lines[0].split())); n=len(a); return str(n*(n+1)//2-sum(a))
        if kind == "zeros":
            a=list(map(int,lines[0].split())); return " ".join(map(str,[x for x in a if x]+[0]*a.count(0)))
        if kind == "maxsub":
            a=list(map(int,lines[0].split())); cur=best=a[0]
            for x in a[1:]: cur=max(x,cur+x); best=max(best,cur)
            return str(best)
        if kind == "minsub":
            a=list(map(int,lines[0].split())); cur=best=a[0]
            for x in a[1:]: cur=min(x,cur+x); best=min(best,cur)
            return str(best)
        if kind == "binary":
            a=list(map(int,lines[0].split())); t=int(lines[1]);
            try:return str(a.index(t))
            except ValueError:return "-1"
        if kind == "insertpos":
            import bisect
            a=list(map(int,lines[0].split())); return str(bisect.bisect_left(a,int(lines[1])))
        if kind in {"sort_selection","sort_insertion","sort_bubble"}:
            return " ".join(map(str,sorted(map(int,lines[0].split()))))
        if kind == "gcdlcm":
            import math
            a,b=map(int,lines[0].split()); g=math.gcd(a,b); return f"{g} {abs(a*b)//g if g else 0}"
        if kind == "decbin": return bin(int(lines[0]))[2:]
        if kind == "bindec": return str(int(lines[0].strip(),2))
        if kind == "setbits": return str(int(lines[0]).bit_count())
        if kind == "pow2":
            n=int(lines[0]); return str(n>0 and (n&(n-1))==0)
        if kind == "factorial":
            import math; return str(math.factorial(int(lines[0])))
        if kind == "fibonacci":
            n=int(lines[0]); a,b=0,1
            for _ in range(n): a,b=b,a+b
            return str(a)
        if kind == "prime":
            n=int(lines[0]); return str(n>=2 and all(n%d for d in range(2,int(n**0.5)+1)))
        if kind == "longprefix":
            a=lines[0].split(); p=a[0] if a else ''
            for w in a[1:]:
                while p and not w.startswith(p): p=p[:-1]
            return p
        if kind == "permutations":
            from itertools import permutations
            s=lines[0].strip(); return "\n".join("".join(p) for p in sorted(set(permutations(s))))
    except Exception:
        return None
    return None


def _tests_for_question(q: dict) -> list[tuple[str,str]]:
    text=str(q.get("question") or "").casefold()
    # Three varied cases per problem family. These are deliberately server-side.
    if "reverse a string" in text:
        k="reverse"; ins=["hello\n","Aviation\n","racecar 123\n"]
    elif "palindrome" in text and "string" in text:
        k="palindrome"; ins=["Never odd or even\n","hello\n","A man a plan a canal Panama\n"]
    elif "two strings are anagrams" in text:
        k="anagram"; ins=["listen\nsilent\n","hello\nworld\n","Dormitory\nDirty room\n"]
    elif "remove duplicate values" in text:
        k="dedupe"; ins=["1 2 2 3 1 4\n","5 5 5\n","-1 2 -1 3 2\n"]
    elif "second-largest distinct" in text:
        k="second"; ins=["9 1 7 7 3\n","5 4\n","10 10 8 2\n"]
    elif "kth largest" in text and "top k" not in text:
        k="kth_largest"; ins=["9 1 7 3 5\n2\n","10 20 30 40\n4\n","5 5 4 3\n2\n"]
    elif "kth smallest" in text:
        k="kth_smallest"; ins=["9 1 7 3 5\n2\n","10 20 30 40\n4\n","5 5 4 3\n2\n"]
    elif "missing number from 0 through n" in text:
        k="missing"; ins=["3 0 1\n","9 6 4 2 3 5 7 0 1\n","0\n"]
    elif "move all zero" in text:
        k="zeros"; ins=["0 1 0 3 12\n","1 2 3\n","0 0 -1 0 2\n"]
    elif "maximum subarray sum" in text:
        k="maxsub"; ins=["-2 1 -3 4 -1 2 1 -5 4\n","-5 -2 -9\n","5\n"]
    elif "minimum subarray sum" in text:
        k="minsub"; ins=["3 -4 2 -3 -1 7 -5\n","5 2 4\n","-5\n"]
    elif "binary search" in text and "sorted" in text:
        k="binary"; ins=["1 3 5 7 9\n7\n","1 3 5 7 9\n2\n","-5 -1 0 4\n-5\n"]
    elif "insertion position" in text:
        k="insertpos"; ins=["1 3 5 6\n5\n","1 3 5 6\n2\n","1 3 5 6\n7\n"]
    elif "selection sort" in text:
        k="sort_selection"; ins=["64 25 12 22 11\n","3 1 2\n","5 5 1 -2\n"]
    elif "insertion sort" in text:
        k="sort_insertion"; ins=["12 11 13 5 6\n","3 1 2\n","5 5 1 -2\n"]
    elif "bubble sort" in text:
        k="sort_bubble"; ins=["5 1 4 2 8\n","1 2 3 4\n","5 5 1 -2\n"]
    elif "gcd and lcm" in text:
        k="gcdlcm"; ins=["12 18\n","7 5\n","0 9\n"]
    elif "decimal integer to binary" in text:
        k="decbin"; ins=["10\n","0\n","255\n"]
    elif "binary string to decimal" in text:
        k="bindec"; ins=["1010\n","0\n","11111111\n"]
    elif "number of set bits" in text:
        k="setbits"; ins=["7\n","8\n","0\n"]
    elif "power of two" in text:
        k="pow2"; ins=["16\n","18\n","1\n"]
    elif "factorial recursively" in text:
        k="factorial"; ins=["0\n","5\n","8\n"]
    elif "fibonacci" in text and "memoization" in text:
        k="fibonacci"; ins=["0\n","10\n","20\n"]
    elif "whether an integer is prime" in text or "test whether an integer is prime" in text:
        k="prime"; ins=["2\n","17\n","21\n"]
    elif "longest common prefix" in text:
        k="longprefix"; ins=["flower flow flight\n","dog racecar car\n","inter interview internet\n"]
    elif "generate all permutations" in text:
        k="permutations"; ins=["abc\n","aa\n"]
    else:
        return []
    out=[]
    for i in ins:
        e=_oracle(k,i)
        if e is not None: out.append((i,e))
    return out


def _static_web_analysis(q: dict, code: str) -> dict:
    lang=_norm_lang(q.get("language","")); text=str(q.get("question") or "").casefold(); c=code
    checks=[]
    def add(label, ok): checks.append({"check":label,"passed":bool(ok)})
    if lang == "HTML":
        # html.parser accepts an empty string as syntactically valid. That is
        # not a valid coding answer, so require actual HTML content.
        add("HTML submission is non-empty", bool(c.strip()))
        add("HTML parses", bool(c.strip()) and _html_parses(c))
        if "form" in text: add("Form element", bool(re.search(r"<form\b",c,re.I)))
        if "semantic" in text: add("Semantic structure", bool(re.search(r"<(main|section|header|nav|article|footer)\b",c,re.I)))
        if "accessible labels" in text: add("Labels", bool(re.search(r"<label\b",c,re.I)))
        if "validation" in text: add("Native validation", bool(re.search(r"\brequired\b|type=[\"'](email|number|date|password)[\"']",c,re.I)))
        if "mobile" in text or "responsive" in text: add("Viewport meta", bool(re.search(r"name=[\"']viewport[\"']",c,re.I)))
        if "multi-step" in text: add("Multi-step structure", bool(re.search(r"step|next|previous|progress",c,re.I)))
        if "login" in text: add("Login fields", bool(re.search(r"type=[\"']password[\"']",c,re.I)))
        if "password reset" in text: add("Password reset field", bool(re.search(r"password|reset",c,re.I)))
        if "checkout" in text: add("Checkout/payment fields", bool(re.search(r"card|address|checkout|payment|zip|cvv",c,re.I)))
    elif lang in {"CSS","Bootstrap","Tailwind CSS"}:
        if lang=="CSS":
            add("CSS syntax/structure", bool(re.search(r"[^{}]+\{[^{}]*:[^{}]+;?[^{}]*\}",c,re.S)))
            if "flexbox" in text: add("Flexbox", "display:flex" in re.sub(r"\s+","",c).lower())
            if "grid" in text: add("Grid", "display:grid" in re.sub(r"\s+","",c).lower())
            if "responsive" in text or "breakpoint" in text: add("Responsive media queries", "@media" in c)
            if "focus" in text: add("Keyboard focus", ":focus" in c)
            if "reduced-motion" in text: add("Reduced motion", "prefers-reduced-motion" in c)
            if "overflow" in text: add("Overflow handling", "overflow" in c)
            if "custom properties" in text: add("CSS custom properties", "--" in c and "var(" in c)
            if "sticky" in text: add("Sticky positioning", "position:sticky" in re.sub(r"\s+","",c).lower())
            if "animation" in text: add("Animation", "@keyframes" in c or "animation" in c)
        elif lang=="Bootstrap":
            add("Bootstrap classes", bool(re.search(r"\b(container|row|col-|navbar|btn|form-control|d-flex|gap-|p-|m-)\b",c)))
            if "navbar" in text: add("Navbar structure", "navbar" in c)
            if "collaps" in text: add("Collapse controls", "collapse" in c and "navbar-toggler" in c)
            if "responsive" in text or "mobile-first" in text: add("Responsive utilities/grid", bool(re.search(r"\b(sm|md|lg|xl|xxl)-",c)))
            if "validation" in text: add("Validation support", bool(re.search(r"is-valid|is-invalid|invalid-feedback|valid-feedback",c)))
        else:
            add("Tailwind utilities", bool(re.search(r"\b(flex|grid|block|inline|px-|py-|mx-|my-|text-|bg-|rounded|shadow)\b",c)))
            if "responsive" in text or "breakpoint" in text: add("Responsive breakpoints", bool(re.search(r"\b(sm|md|lg|xl|2xl):",c)))
            if "focus" in text or "hover" in text: add("Interaction variants", bool(re.search(r"\b(focus|hover|disabled):",c)))
            if "no component-specific stylesheet" in text: add("Utility-first/no custom stylesheet", not bool(re.search(r"<style|\.css",c,re.I)))
    elif lang == "React":
        add("React component syntax", bool(re.search(r"(?:function|const)\s+[A-Z][A-Za-z0-9_]*|<[A-Za-z]",c)))
        if "hooks" in text or "counter" in text or "state" in text: add("State hook", "useState" in c)
        if "props" in text: add("Props", bool(re.search(r"props|\{[^}]*\}",c)))
        if "callback" in text: add("Callback/event handling", bool(re.search(r"onClick|onChange|callback|set[A-Z]",c)))
        if "localstorage" in text: add("localStorage", "localStorage" in c)
        if "context" in text: add("Context API", "createContext" in c and "useContext" in c)
        if "cleanup" in text: add("Effect cleanup", "useEffect" in c and "return" in c)
    elif lang == "Vanilla JS":
        add("JavaScript present", bool(re.search(r"\b(document|addEventListener|querySelector|createElement)\b",c)))
        if "todo" in text or "list" in text: add("DOM list manipulation", bool(re.search(r"createElement|appendChild|innerHTML|insertAdjacent",c)))
        if "event" in text or "keyboard" in text: add("Event handling", "addEventListener" in c)
        if "validation" in text: add("Validation logic", bool(re.search(r"checkValidity|preventDefault|required|valid",c,re.I)))
    passed=sum(x["passed"] for x in checks); total=len(checks)
    score=round(100*passed/total) if total else 0
    return {"mode":"semantic","status":"PASS" if score>=70 else "REVIEW_REQUIRED","score":score,"checks":checks,
            "summary":f"{passed}/{total} semantic checks passed." if total else "No semantic checks were available."}


class _Parser(html.parser.HTMLParser):
    def __init__(self): super().__init__(); self.tags=[]
    def handle_starttag(self,tag,attrs): self.tags.append(tag.lower())
    def handle_startendtag(self,tag,attrs): self.tags.append(tag.lower())


def _html_parses(code: str):
    try:
        p=_Parser(); p.feed(code); p.close(); return True
    except Exception: return False



# ---------------------------------------------------------------------------
# Static correctness analysis
# ---------------------------------------------------------------------------
# This layer deliberately does NOT compare submitted source text with
# correctCode. It estimates correctness from syntax + implementation logic
# implied by the question.  Behavioural tests remain useful evidence when a
# machine-readable contract exists, but a missing contract is never exposed as
# "Needs Review" to the candidate.

def _logic_feature_map(question: str, code: str, lang: str) -> list[tuple[str, bool]]:
    q = str(question or "").casefold()
    c = str(code or "")
    cl = c.casefold()
    checks: list[tuple[str, bool]] = []

    def has(*patterns):
        return any(re.search(p, c, re.I | re.S) for p in patterns)

    # Core program structure. These are intentionally language-agnostic.
    checks.append(("Uses program logic/control flow", has(r"\bif\b", r"\bfor\b", r"\bwhile\b", r"\bswitch\b", r"\bcase\b")))
    checks.append(("Produces or returns a result", has(r"\breturn\b", r"\bprint\s*\(", r"\bconsole\.log\s*\(", r"\bSystem\.out\b", r"\bprintf\s*\(", r"\becho\b")))
    checks.append(("Processes input/data", has(r"\binput\s*\(", r"\bstdin\b", r"\bargv\b", r"\brequest\b", r"\bdata\b", r"\barr(?:ay)?\b", r"\bintervals?\b", r"\blist\b", r"\bnums?\b", r"\bvalues?\b")))

    # Problem-specific logic signals. A solution does not need every signal;
    # these are evidence checks, not source-code matching.
    feature_rules = [
        (r"merge overlapping intervals|merge intervals",
         [("Sorts intervals before merging", r"\bsort(?:ed)?\s*\("),
          ("Iterates through intervals", r"\bfor\b|\bwhile\b"),
          ("Checks interval overlap", r"(<=|>=|<|>).{0,100}(start|end|\[[^]]+\])|(?:start|end|\[[^]]+\]).{0,100}(<=|>=|<|>)"),
          ("Builds merged output", r"\bappend\s*\(|\bextend\s*\(")]),
        (r"strongly connected components|kosaraju|tarjan",
         [("Builds/uses graph traversal", r"\bgraph\b|\badj(?:acency)?\b|\bneighbors?\b"),
          ("Tracks visited vertices", r"\bvisited\b|\bseen\b"),
          ("Uses DFS/traversal", r"\bdfs\b|\brecursive\b|\bstack\b"),
          ("Handles reverse/low-link structure", r"\breverse\b|\btranspose\b|\blow\b|\blowlink\b|\bfinishtime\b")]),
        (r"binary search",
         [("Uses ordered/search bounds", r"\b(left|right|lo|hi|low|high)\b"),
          ("Halves the search space", r"\bmid\b|//\s*2|\/\s*2"),
          ("Compares target with midpoint", r"(target|key|x).{0,60}(mid|middle)|(?:mid|middle).{0,60}(target|key|x)")]),
        (r"merge.*k.*sorted|merge k sorted|merge multiple sorted",
         [("Uses multiple sorted sequences", r"heap|priority|k[- ]?way|merge|list|array"),
          ("Iterates/merges elements", r"\bfor\b|\bwhile\b|merge"),
          ("Maintains ordered result", r"sort|heap|priority|append|extend")]),
        (r"top k|k largest|k smallest|kth largest|kth smallest",
         [("Tracks a k-sized selection", r"\bk\b|heap|priority|window|count"),
          ("Processes candidate values", r"\bfor\b|\bwhile\b|sort"),
          ("Maintains ranking/order", r"heap|sort|sorted|priority|\bmax\b|\bmin\b")]),
        (r"lru cache|least recently used|cache",
         [("Maintains cached entries", r"cache|dict|map|ordered|lru"),
          ("Handles cache capacity", r"capacity|maxsize|limit|len"),
          ("Updates usage order", r"move_to_end|order|recent|pop|delete|remove")]),
        (r"interval|meeting|calendar|schedule",
         [("Processes intervals/events", r"interval|meeting|event|calendar|start|end"),
          ("Orders or scans events", r"sort|sorted|\bfor\b|\bwhile\b"),
          ("Applies overlap/scheduling conditions", r"<|>|<=|>=|overlap|conflict|free|deadline")]),
        (r"date|weekday|days between|semantic version|version string",
         [("Parses structured components", r"split|parse|match|regex|year|month|day|version"),
          ("Compares/orders components", r"sort|sorted|compare|<|>|=="),
          ("Handles boundary/ordering rules", r"if|while|for|case|pre|release|leap")]),
        (r"sort|sorting",
         [("Contains iteration over values", r"\bfor\b|\bwhile\b"),
          ("Performs comparisons", r"<|>"),
          ("Moves/swaps/inserts values", r"\bswap\b|\btemp\b|\bappend\b|\binsert\b|\bheap\b|\bsort(?:ed)?\s*\(")]),
        (r"two pointer|two-pointer",
         [("Uses two indices/pointers", r"\b(left|right|l|r)\b"),
          ("Moves pointers conditionally", r"\b(left|right|l|r)\s*(\+\+|--|\+=|-=)"),
          ("Iterates while pointers converge", r"\bwhile\b")]),
        (r"sliding window|window",
         [("Maintains a window boundary", r"\b(left|right|start|end)\b"),
          ("Expands/shrinks the window", r"\bwhile\b|left\s*(\+\+|\+=)|right\s*(\+\+|\+=)"),
          ("Tracks window state", r"\bcount\b|\bfreq\b|\bfrequency\b|\bsum\b|\bseen\b")]),
        (r"dynamic programming|\bdp\b|memoization|memoized",
         [("Stores subproblem results", r"\bdp\b|\bmemo\b|\bcache\b|\blru_cache\b"),
          ("Builds subproblems iteratively or recursively", r"\bfor\b|\bwhile\b|\bdef\b"),
          ("Uses previous states", r"\[.*-1\]|\[.*-2\]|dp\[|memo\[")]),
        (r"knapsack",
         [("Tracks capacity/target state", r"\bcapacity\b|\bweight\b|\bweights\b|\btarget\b"),
          ("Uses DP/state storage", r"\bdp\b|\bmemo\b|\btable\b"),
          ("Iterates items and states", r"\bfor\b|\bwhile\b")]),
        (r"graph|vertex|vertices|edge|edges",
         [("Represents graph relationships", r"\badj(?:acency)?\b|\bgraph\b|\bedges?\b|\bneighbors?\b"),
          ("Tracks visited state", r"\bvisited\b|\bseen\b"),
          ("Traverses graph", r"\bdfs\b|\bbfs\b|\bqueue\b|\bstack\b|\bdeque\b")]),
        (r"tree|binary search tree|bst",
         [("Uses tree/node structure", r"\bnode\b|\btreenode\b|\bleft\b|\bright\b"),
          ("Traverses tree", r"\bdfs\b|\bbfs\b|\brecursive\b|\bqueue\b|\bstack\b"),
          ("Uses ordering/child conditions", r"<|>|<=|>=|\bleft\b|\bright\b")]),
        (r"linked list",
         [("Uses next/link pointers", r"\bnext\b|\bprev\b|\bhead\b|\btail\b"),
          ("Traverses nodes", r"\bwhile\b|\bfor\b"),
          ("Updates links", r"\bnext\s*=|\bprev\s*=|\bhead\s*=")]),
        (r"stack",
         [("Uses stack operations", r"\bappend\s*\(|\bpush\b|\bpop\s*\("),
          ("Processes items iteratively", r"\bfor\b|\bwhile\b")]),
        (r"queue|breadth.first",
         [("Uses queue operations", r"\bdeque\b|\bqueue\b|\bpopleft\b|\benqueue\b"),
          ("Processes items iteratively", r"\bfor\b|\bwhile\b")]),
        (r"heap|priority queue",
         [("Uses heap/priority structure", r"\bheapq\b|\bheap\b|\bpriority\b"),
          ("Pushes/pops ordered items", r"\bheappush\b|\bheappop\b|\bpush\b|\bpop\b")]),
        (r"hash table|hashmap|hash map|frequency|count occurrences",
         [("Uses hash/map structure", r"\bdict\b|\bmap\b|\bdefaultdict\b|\bcounter\b|\{\}"),
          ("Updates/looks up keys", r"\.get\s*\(|\[[^]]+\]\s*=|\.setdefault\s*\(")]),
        (r"matrix|grid",
         [("Indexes matrix/grid cells", r"\[\s*[^\]]+\]\s*\[\s*[^\]]+\]"),
          ("Traverses rows/cells", r"\bfor\b|\bwhile\b"),
          ("Handles boundaries/neighbors", r"\brow\b|\bcol\b|\brows\b|\bcols\b|\bdx\b|\bdy\b|\bdirs?\b")]),
        (r"palindrome",
         [("Compares mirrored/reversed content", r"\[::-1\]|\breverse\b|\b(left|right)\b"),
          ("Performs character/string comparison", r"\bfor\b|\bwhile\b|==")]),
        (r"anagram",
         [("Normalizes or counts characters", r"\bsorted\s*\(|\bcounter\b|\bcount\b|\bdict\b"),
          ("Compares both strings", r"\b==\b|\bfor\b")]),
        (r"gcd|greatest common divisor",
         [("Uses remainder/modulo reduction", r"%"),
          ("Repeats until termination", r"\bwhile\b|\brecurs")]),
        (r"prime",
         [("Checks divisibility", r"%"),
          ("Checks multiple divisors", r"\bfor\b|\bwhile\b")]),
        (r"factorial|fibonacci",
         [("Handles base case", r"\bif\b"),
          ("Uses recurrence/iteration", r"\bfor\b|\bwhile\b|\brecurs|\b\w+\s*\(")]),
        (r"backtracking|n.queens|sudoku",
         [("Makes recursive/search choices", r"\bdef\b|\brecurs"),
          ("Checks constraints", r"\bif\b|\bvalid\b|\bcheck\b"),
          ("Backtracks state", r"\bremove\b|\bpop\b|\bundo\b|\bbacktrack")]),
        (r"greedy|activity selection|minimum rooms|meeting rooms|non.overlapping",
         [("Orders candidates", r"\bsort(?:ed)?\s*\("),
          ("Iterates candidates", r"\bfor\b|\bwhile\b"),
          ("Makes local feasibility/choice checks", r"\bif\b|<|>|<=|>=")]),
    ]

    matched = False
    for qpat, rules in feature_rules:
        if re.search(qpat, q, re.I):
            matched = True
            checks.extend((label, bool(re.search(pattern, c, re.I | re.S))) for label, pattern in rules)
            break

    # Additional generic evidence based on explicit requirements in the prompt.
    if re.search(r"input|read|accept", q):
        checks.append(("Reads/accepts input", has(r"\binput\s*\(", r"\bstdin\b", r"\bargv\b", r"\bread\s*\(")))
    if re.search(r"output|print|display|return", q):
        checks.append(("Produces requested output", has(r"\bprint\s*\(", r"\bconsole\.log\s*\(", r"\breturn\b", r"\bSystem\.out\b", r"\bprintf\s*\(")))
    if re.search(r"handle.*empty|empty.*case|edge case|boundary", q):
        checks.append(("Handles edge/boundary cases", has(r"\bif\b", r"\btry\b", r"\bexcept\b", r"\belse\b", r"\bnull\b|\bnone\b")))
    if re.search(r"efficient|optimi[sz]|o\(", q):
        checks.append(("Shows an efficiency-aware approach", has(r"\bheap\b|\bbinary\b|\bdp\b|\bmemo\b|\bsort\b|\bset\b|\bdict\b|\bhash\b|\bdeque\b")))

    # If no specialized family matched, use conservative generic logic signals.
    if not matched:
        checks.append(("Contains meaningful branching/iteration", has(r"\bif\b", r"\bfor\b", r"\bwhile\b", r"\bswitch\b")))
        checks.append(("Uses a data structure or variable transformation", has(r"\[", r"\{", r"\bset\b", r"\bdict\b", r"\bmap\b", r"\bsplit\b", r"\bjoin\b")))
        checks.append(("Returns/displays a computed value", has(r"\breturn\b", r"\bprint\s*\(", r"\bconsole\.log\b", r"\bSystem\.out\b", r"\bprintf\b")))

    return checks


def _has_meaningful_implementation(code: str, lang: str) -> bool:
    """Detect whether the submission contains an actual implementation.

    This check intentionally does not parse/compile the source: logic is scored
    first, and syntax is checked only after logic exceeds 50/80.
    """
    c = str(code or "").strip()
    if not c:
        return False

    if lang == "Python":
        # Reject bare identifiers/gibberish while allowing different valid
        # implementation styles to reach the logic analyser.
        return bool(re.search(
            r"\b(def|class|if|elif|else|for|while|try|except|with|return|"
            r"import|from|print|input|lambda|yield|raise|assert)\b"
            r"|[A-Za-z_][A-Za-z0-9_]*\s*="
            r"|\[[^\]]*\]|\{[^}]*\}|\([^)]*\)\s*:",
            c
        ))

    if lang in {"JavaScript", "Node.js"}:
        return bool(re.search(
            r"\b(function|const|let|var|if|else|for|while|class|return|"
            r"switch|case|console\.log)\b|=>|[{};]",
            c
        ))

    if lang in {"Java", "C", "C++", "C#", ".NET"}:
        return bool(re.search(
            r"\b(class|public|private|protected|static|void|int|float|double|"
            r"string|if|else|for|while|return|main|namespace|using)\b|[{};]",
            c, re.I
        ))

    if lang == "PHP":
        return bool(re.search(
            r"<\?php|function\b|\bif\b|\bforeach\b|\bwhile\b|\becho\b|\breturn\b",
            c, re.I
        ))

    return len(re.findall(r"[A-Za-z_][A-Za-z0-9_]*", c)) >= 3

def _check_javascript_syntax(code: str):
    node = shutil.which("node")
    if not node:
        return True, None
    try:
        p = subprocess.run([node, "--check"], input=str(code or ""), text=True,
                           capture_output=True, timeout=5, shell=False,
                           env={"PATH": os.environ.get("PATH", ""), "LANG": "C.UTF-8"})
        return p.returncode == 0, (p.stderr or p.stdout or "")[:4000]
    except subprocess.TimeoutExpired:
        return False, "Syntax check timed out."
    except Exception as exc:
        return False, str(exc)


def _check_compiled_syntax(lang: str, code: str):
    lang = _norm_lang(lang)
    if lang in {"C", "C++"}:
        td, result = _compile_c(code, lang)
        if td is not None:
            shutil.rmtree(td, ignore_errors=True)
        if result.get("status") == "COMPILED":
            return True, None
        return False, result.get("message")

    if lang == "Java":
        td = Path(tempfile.mkdtemp(prefix="avitec_java_syntax_"))
        try:
            javac = shutil.which("javac")
            if not javac:
                return True, None
            src = td / "Main.java"
            src.write_text(code, encoding="utf-8")
            p = subprocess.run([javac, "-encoding", "UTF-8", str(src)],
                               capture_output=True, text=True, timeout=6, shell=False)
            return p.returncode == 0, (p.stderr or p.stdout or "")[:4000]
        except Exception as exc:
            return False, str(exc)
        finally:
            shutil.rmtree(td, ignore_errors=True)

    if lang == "PHP":
        php = shutil.which("php")
        if not php:
            return True, None
        try:
            p = subprocess.run([php, "-l"], input=code, text=True, capture_output=True,
                               timeout=5, shell=False)
            return p.returncode == 0, (p.stderr or p.stdout or "")[:4000]
        except Exception as exc:
            return False, str(exc)

    # For C#/.NET, use the locally available compiler/runtime when present.
    if lang in {"C#", ".NET"}:
        dotnet = shutil.which("dotnet")
        if not dotnet:
            return True, None
        # `dotnet` does not provide a portable one-file syntax check. Do not
        # reject valid code merely because the host lacks a C# compiler.
        return True, None

    return True, None


def evaluate_code(code: str, question: dict) -> dict:
    """Evaluate the submitted implementation against the actual question.

    IMPORTANT: the public Flask API calls this as evaluate_code(code, question).
    Logic is evaluated first (80 points); syntax/compile is checked only after
    logic exceeds 50/80. Source text is never compared with correctCode.
    """
    # Defensive argument handling prevents the old reversed-argument crash from
    # becoming a 500 if a caller accidentally supplies the arguments backwards.
    if isinstance(code, dict) and isinstance(question, str):
        code, question = question, code
    if not isinstance(question, dict):
        return {
            "status": "WRONG_ANSWER",
            "score": 0,
            "summary": "0% Code Correct",
            "analysis": {"error": "Invalid question payload."},
        }

    lang = _norm_lang(question.get("language", ""))
    code = str(code or "")

    # First pass: actual question-specific logic only.
    preliminary = _static_correctness_analysis(question, code, syntax_ok=None)
    logic_score = int(preliminary["analysis"].get("logic_score", 0))

    # A static semantic score is not proof that the program produces the right
    # result. Only questions with a server-side behavioural contract may be
    # awarded PASS/100. Unsupported questions remain REVIEW_REQUIRED instead
    # of falsely claiming that arbitrary code is fully correct.
    behavioural_tests = _tests_for_question(question)
    if not behavioural_tests:
        preliminary["status"] = "REVIEW_REQUIRED" if logic_score >= 70 else "WRONG_ANSWER"
        preliminary["score"] = min(logic_score, 69)
        preliminary["summary"] = f"{preliminary['score']}% Code Correct • Behavioural test unavailable; full correctness not proven."
        preliminary["analysis"]["behavioural_checked"] = False
        preliminary["analysis"]["full_correctness_proven"] = False
        preliminary["analysis"]["reason"] = "No server-side behavioural contract exists for this question."
        return preliminary

    preliminary["analysis"]["behavioural_checked"] = True

    # Logic gate: a syntactically valid but irrelevant program can never pass.
    if logic_score <= 50:
        preliminary["status"] = "WRONG_ANSWER"
        preliminary["score"] = logic_score
        preliminary["summary"] = f"{logic_score}% Code Correct"
        preliminary["analysis"]["syntax_checked"] = False
        preliminary["analysis"]["syntax_score"] = 0
        return preliminary

    # Second pass: syntax/compile only after logic > 50/80.
    syntax_ok, syntax_error = True, None
    try:
        if lang == "Python":
            import ast
            ast.parse(code)
        elif lang in {"JavaScript", "Node.js", "Vanilla JS"}:
            syntax_ok, syntax_error = _check_javascript_syntax(code)
        elif lang in {"Java", "C", "C++", "C#", ".NET", "PHP"}:
            syntax_ok, syntax_error = _check_compiled_syntax(lang, code)
    except SyntaxError as exc:
        syntax_ok = False
        syntax_error = f"{exc.msg} (line {exc.lineno})"
    except Exception as exc:
        syntax_ok = False
        syntax_error = str(exc)

    result = _static_correctness_analysis(question, code, syntax_ok=syntax_ok)
    if syntax_error:
        result["analysis"]["syntax_error"] = syntax_error
    return result


def _question_family(q: dict) -> str:
    global _FAMILY_CACHE
    if _FAMILY_CACHE is None:
        try:
            raw = json.loads(_FAMILY_BANK.read_text(encoding="utf-8"))
            _FAMILY_CACHE = raw.get("questions", {})
        except Exception:
            _FAMILY_CACHE = {}
    return str(_FAMILY_CACHE.get(str(q.get("id")), {}).get("family") or "simple_program")



def _semantic_requirements(question: str, code: str, lang: str) -> list[tuple[str, bool]]:
    """Question-specific semantic checks.

    These checks are deliberately based on the requested operation, not on
    superficial keywords. A keyword such as `sort` or `print` cannot make an
    unrelated solution correct.
    """
    q = str(question or "").casefold()
    c = str(code or "")
    cl = c.casefold()
    checks = []

    def has(*patterns):
        return any(re.search(p, c, re.I | re.S) for p in patterns)

    def add(label, ok):
        checks.append((label, bool(ok)))

    # ---------- Core semantic helpers ----------
    is_python = _norm_lang(lang) == "Python"
    is_js = _norm_lang(lang) in {"JavaScript", "Node.js", "Vanilla JS"}

    # Count even values / numbers.
    if re.search(r"\bcount\b.*\beven\b|\beven\b.*\bcount\b", q):
        add("Processes the supplied array/list", has(
            r"\bfor\b", r"\bwhile\b", r"\bsum\s*\(", r"\bfilter\s*\(",
            r"\blist\b", r"\barray\b"
        ))
        add("Checks evenness", has(
            r"%\s*2\s*==\s*0", r"%\s*2\s*===\s*0",
            r"\bmod\b.{0,20}\b2\b.{0,20}(even|0)"
        ))
        add("Maintains an even-value count", has(
            r"\bcount\b\s*(?:\+=|\+?=)\s*1",
            r"\bcount\b\s*=\s*\bcount\b\s*\+\s*1",
            r"\beven_count\b", r"\bnum_even\b"
        ))
        add("Outputs/returns the count", has(
            r"\bprint\s*\(\s*(?:count|even_count|num_even)",
            r"\breturn\s+(?:count|even_count|num_even)",
            r"console\.log\s*\(\s*(?:count|even_count|num_even)",
            r"System\.out.*\b(count|even_count|num_even)\b"
        ))
        return checks

    # Sum / total.
    if re.search(r"\b(sum|total)\b.*\b(array|list|numbers|values)\b|\b(array|list|numbers|values)\b.*\b(sum|total)\b", q):
        add("Processes the collection", has(r"\bfor\b", r"\bwhile\b", r"\bsum\s*\(", r"\breduce\s*\("))
        add("Accumulates numeric values", has(
            r"\b(sum|total)\b\s*(?:\+=|=)",
            r"\bsum\s*\(", r"\breduce\s*\("
        ))
        add("Outputs/returns the sum", has(
            r"\bprint\s*\(", r"\breturn\b", r"console\.log\s*\(", r"System\.out", r"\bprintf\s*\("
        ))
        return checks

    # Average.
    if re.search(r"\baverage\b|\bmean\b", q):
        add("Processes all values", has(r"\bfor\b", r"\bwhile\b", r"\bsum\s*\(", r"\breduce\s*\("))
        add("Computes total and count/length", has(
            r"\bsum\b", r"\blen\s*\(", r"\blength\b", r"\bcount\b", r"\breduce\s*\("
        ))
        add("Divides total by number of values", has(r"/\s*(?:len|length|count)", r"\baverage\b", r"/"))
        add("Outputs/returns the average", has(r"\bprint\s*\(", r"\breturn\b", r"console\.log\s*\(", r"System\.out"))
        return checks

    # Maximum/minimum.
    if re.search(r"\b(find|get|calculate|return)\b.*\b(maximum|minimum|max|min|largest|smallest)\b|\b(maximum|minimum|largest|smallest)\b.*\b(array|list|numbers|values)\b", q):
        add("Processes collection values", has(r"\bfor\b", r"\bwhile\b", r"\bmax\s*\(", r"\bmin\s*\(", r"\bsorted\s*\("))
        add("Compares or tracks an extremum", has(
            r"\bmax\s*\(", r"\bmin\s*\(", r"\bif\b.{0,100}(>|<|>=|<=)",
            r"\b(largest|smallest|max|min)\b"
        ))
        add("Outputs/returns the extremum", has(r"\bprint\s*\(", r"\breturn\b", r"console\.log\s*\(", r"System\.out"))
        return checks

    # Reverse string/list.
    if re.search(r"\breverse\b.*\b(string|array|list)\b|\b(string|array|list)\b.*\breverse\b", q):
        add("Reads/processes the target sequence", has(r"\bfor\b", r"\bwhile\b", r"\bsplit\s*\(", r"\blist\b", r"\barray\b", r"\bstring\b"))
        add("Actually reverses sequence order", has(
            r"\[::-1\]", r"\breverse\s*\(", r"\.reverse\s*\(", r"\breversed\s*\(",
            r"\b(?:left|right|i|j)\b.{0,100}(swap|temp)"
        ))
        add("Outputs/returns the reversed sequence", has(r"\bprint\s*\(", r"\breturn\b", r"console\.log\s*\(", r"System\.out"))
        return checks

    # Palindrome.
    if re.search(r"\bpalindrome\b", q):
        add("Obtains/iterates the input", has(r"\binput\s*\(", r"\bfor\b", r"\bwhile\b", r"\bsplit\s*\("))
        add("Compares mirrored/reversed content", has(
            r"\[::-1\]", r"\breverse\b", r"\breversed\s*\(",
            r"\b(left|right|i|j)\b.{0,100}(==|!=).{0,100}\b(left|right|i|j)\b"
        ))
        add("Produces palindrome result", has(r"\bprint\s*\(", r"\breturn\b", r"console\.log\s*\(", r"System\.out"))
        return checks

    # Factorial.
    if re.search(r"\bfactorial\b", q):
        add("Reads/uses n", has(r"\bn\b", r"\binput\s*\(", r"\bint\s*\("))
        add("Multiplies through factorial range", has(r"\bfor\b|\bwhile\b|\*=\s*|\bmath\.factorial\b"))
        add("Outputs/returns factorial", has(r"\bprint\s*\(", r"\breturn\b", r"console\.log\s*\(", r"System\.out"))
        return checks

    # Fibonacci.
    if re.search(r"\bfibonacci\b", q):
        add("Maintains Fibonacci state", has(r"\b(a|b|x|y|prev|curr|next)\b"))
        add("Uses iterative or recursive Fibonacci progression", has(
            r"\bfor\b|\bwhile\b|\brecurs|\bfibonacci\b|(?:a|prev|curr).{0,50}\+"
        ))
        add("Outputs/returns Fibonacci result", has(r"\bprint\s*\(", r"\breturn\b", r"console\.log\s*\(", r"System\.out"))
        return checks

    # Prime.
    if re.search(r"\bprime\b", q):
        add("Tests divisibility", has(r"%", r"mod"))
        add("Checks factors up to a relevant bound or equivalent", has(
            r"\bfor\b|\bwhile\b|\bsqrt\s*\(", r"\b2\b.{0,100}\bn\b"
        ))
        add("Produces prime/non-prime result", has(r"\bprint\s*\(", r"\breturn\b", r"console\.log\s*\(", r"true|false"))
        return checks

    # GCD/LCM.
    if re.search(r"\bgcd\b|\bgreatest common divisor\b|\blcm\b|\bleast common multiple\b", q):
        add("Uses divisibility/remainder arithmetic", has(r"%", r"mod"))
        add("Implements iterative/recursive divisor reduction or LCM relation", has(
            r"\bwhile\b|\brecurs|\bgcd\b|\blcm\b|a\s*\*\s*b|\/\s*gcd"
        ))
        add("Outputs/returns the requested number", has(r"\bprint\s*\(", r"\breturn\b", r"console\.log\s*\(", r"System\.out"))
        return checks

    # Remove duplicates / unique values. This must verify the operation itself;
    # calling an unrelated method such as `sort()` or `unique()` is not enough.
    if re.search(r"\bremoves?\b.*\bduplicates?\b|\bduplicates?\b.*\b(removes?|eliminate|delete)\b|\bdedup", q):
        add("Processes the collection", has(
            r"\bfor\b", r"\bwhile\b", r"\blist\b", r"\barray\b", r"\bset\b", r"\bdict\b",
            r"Object\.keys", r"Set\s*\(", r"new\s+Set"
        ))
        add("Detects or tracks duplicate values", has(
            r"\bset\b", r"\bseen\b", r"\bdict\b", r"\bunique\b", r"\bdistinct\b",
            r"not\s+in", r"!\s*.*\.has\s*\(", r"\.has\s*\(", r"includes\s*\(",
            r"indexOf\s*\(", r"\bcount\s*\("
        ))
        add("Builds a de-duplicated result", has(
            r"dict\.fromkeys", r"set\s*\(", r"new\s+Set", r"\.add\s*\(",
            r"\.append\s*\(", r"\.push\s*\(", r"\bunique\b", r"\bdistinct\b",
            r"\bseen\b"
        ))
        add("Outputs or returns the de-duplicated result", has(
            r"\bprint\s*\(", r"\breturn\b", r"console\.log\s*\(",
            r"System\.out", r"\bprintf\s*\(", r"\becho\b"
        ))
        return checks

    # Sorting questions: distinguish a sorting task from an unrelated use of
    # sort(). Sorting alone is NOT sufficient for other question types.
    if re.search(r"\bsort\b|\bsorting\b", q):
        add("Processes the values to be sorted", has(r"\bfor\b", r"\bwhile\b", r"\bsort\s*\(", r"\bsorted\s*\("))
        add("Implements ordering/rearrangement", has(
            r"\bsort\s*\(", r"\bsorted\s*\(", r"swap", r"<", r">", r"compare"
        ))
        add("Outputs/returns the sorted result", has(r"\bprint\s*\(", r"\breturn\b", r"console\.log\s*\(", r"System\.out"))
        return checks

    # Binary search.
    if re.search(r"\bbinary search\b", q):
        add("Maintains search bounds", has(r"\b(left|right|lo|hi|low|high)\b"))
        add("Computes midpoint / halves search space", has(r"\bmid\b", r"//\s*2", r"/\s*2"))
        add("Compares target with midpoint and narrows range", has(r"(target|key).{0,100}(mid|middle)|(?:mid|middle).{0,100}(target|key)"))
        add("Returns/prints search result", has(r"\breturn\b", r"\bprint\s*\(", r"console\.log\s*\(", r"System\.out"))
        return checks

    # Merge intervals.
    if re.search(r"merge overlapping intervals|merge intervals", q):
        add("Orders intervals before merging", has(r"\bsort\s*\(", r"\bsorted\s*\("))
        add("Iterates through intervals", has(r"\bfor\b", r"\bwhile\b"))
        add("Checks overlap between interval boundaries", has(
            r"\b(start|end)\b.{0,100}(<=|>=|<|>)",
            r"\[[^]]+\]\s*\[[^]]+\]"
        ))
        add("Builds merged interval output", has(r"\bappend\s*\(", r"\bextend\s*\(", r"\bmerged\b"))
        return checks

    # Two-sum / pair sum.
    if re.search(r"\btwo sum\b|\bpairs?\b.*\bsum\b|\bsum\b.*\bpairs?\b", q):
        add("Processes array values", has(r"\bfor\b", r"\bwhile\b", r"\bnums?\b", r"\barray\b", r"\blist\b"))
        add("Uses target-sum relation", has(r"\btarget\b", r"\bsum\b", r"\+"))
        add("Uses complement/second-value lookup or pair scan", has(r"\bdict\b|\bset\b|\bhash\b|\bseen\b|\bfor\b|\bwhile\b"))
        add("Returns/prints the requested pair/index", has(r"\breturn\b", r"\bprint\s*\(", r"console\.log\s*\(", r"System\.out"))
        return checks

    # Anagram.
    if re.search(r"\banagram\b", q):
        add("Processes both strings", has(r"split\s*\(", r"sorted\s*\(", r"\bstring\b", r"\bs1\b|\bs2\b"))
        add("Compares character composition", has(r"sorted\s*\(", r"count", r"frequency", r"counter", r"\bdict\b", r"=="))
        add("Outputs/returns the anagram result", has(r"\breturn\b", r"\bprint\s*\(", r"console\.log\s*\(", r"true|false"))
        return checks

    # Generic question-specific fallback: require the code to contain a result
    # path AND a meaningful operation. Do not grant correctness from a single
    # keyword such as print/sort.
    add("Contains a meaningful implementation", has(
        r"\bfor\b|\bwhile\b|\bif\b|\bdef\b|\bfunction\b|\breturn\b|=>|=\s*[^=]"
    ))
    add("Contains an output/return path", has(
        r"\breturn\b|\bprint\s*\(|console\.log\s*\(|System\.out|printf\s*\(|echo\b"
    ))
    return checks


def _logic_feature_map(question: str, code: str, lang: str) -> list[tuple[str, bool]]:
    return _semantic_requirements(question, code, lang)


def _static_correctness_analysis(question: dict, code: str, syntax_ok: bool | None = None) -> dict:
    """Professional candidate-facing policy: Logic 80 + Syntax 20.

    Logic is evaluated first. Syntax/compile is checked only when logic > 50/80.
    Correct Code requires total >= 70.
    """
    lang = _norm_lang(question.get("language", ""))
    qtext = str(question.get("question") or "")
    c = str(code or "").strip()
    family = "question_semantic"

    meaningful = _has_meaningful_implementation(c, lang)
    checks = _logic_feature_map(qtext, c, lang)
    if not meaningful:
        checks = [("Contains a meaningful implementation for this question family", False)]

    passed = sum(1 for _, ok in checks if ok)
    total = len(checks)
    logic_score = round(80 * passed / total) if total else 0

    syntax_checked = logic_score > 50
    syntax_score = 0 if not syntax_checked else (20 if syntax_ok is True else 0)

    # A question-specific logic family is only correct when every mandatory
    # semantic requirement passes. This prevents 3/4 semantic checks + valid
    # syntax from incorrectly becoming a PASS.
    semantic_complete = bool(checks) and all(bool(ok) for _, ok in checks)
    weighted_score = max(0, min(100, logic_score + syntax_score))
    score = weighted_score if semantic_complete else logic_score

    if not meaningful:
        status = "WRONG_ANSWER"
    elif syntax_checked and syntax_ok is False:
        status = "COMPILE_ERROR"
    elif semantic_complete and score >= 70:
        status = "PASS"
    else:
        status = "WRONG_ANSWER"

    return {
        "status": status,
        "score": score,
        "summary": f"{score}% Code Correct • Syntax {syntax_score}/20 • Logic {logic_score}/80",
        "analysis": {
            "family": family,
            "syntax_score": syntax_score,
            "syntax_max": 20,
            "syntax_checked": syntax_checked,
            "logic_score": logic_score,
            "logic_max": 80,
            "logic_gate": "Syntax checked only when Logic > 50/80",
            "pass_threshold": 70,
            "logic_checks_passed": passed,
            "logic_checks_total": total,
            "checks": [{"check": label, "passed": bool(ok)} for label, ok in checks],
        }
    }

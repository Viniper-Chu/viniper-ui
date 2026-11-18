"""Check explicitly asserted, numeric equalities in a reviewed math answer."""
import re
from fractions import Fraction

_MATH = re.compile(r"\$\$(.+?)\$\$|(?<!\$)\$(?!\$)([^$\n]+?)\$|\\\((.+?)\\\)|\\\[(.+?)\\\]", re.S)
# Unbraced TeX fraction arguments each consume exactly one digit.
_ARGUMENT = r"(?:\{([+-]?\d{1,12})\}|(\d))"
_FRAC = re.compile(r"\\(?:dfrac|tfrac|frac)\s*" + _ARGUMENT + r"\s*" + _ARGUMENT)
_TERM = re.compile(r"([+-]?)\s*(\d{1,12}(?:/\d{1,12})?)")


def _sum(text):
    def fraction(match):
        n, d = match[1] or match[2], match[3] or match[4]
        return " " + str(Fraction(int(n), int(d))) + " "
    text = _FRAC.sub(fraction, text.strip()).replace("−", "-").strip()
    pos, total = 0, Fraction()
    while pos < len(text):
        match = _TERM.match(text, pos)
        if not match or (pos and not match[1]):
            return None
        total += (-1 if match[1] == "-" else 1) * Fraction(match[2])
        pos = match.end()
        while pos < len(text) and text[pos].isspace():
            pos += 1
    return total if pos else None


def inconsistent_equality(answer):
    prose = re.sub(r"```.*?(?:```|$)|`[^`\n]*`", "", answer, flags=re.S)
    for match in _MATH.finditer(prose):
        # Quoted mistakes and hypothetical equalities may be deliberately false.
        before = re.split(r"[。！？\n]", prose[max(0, match.start()-100):match.start()])[-1]
        after = re.split(r"[。！？\n，,；;]", prose[match.end():match.end()+50])[0]
        if re.search(r"误写|错误|错写|反设|假设|假定|若|假如|不能写", before) or re.search(r"不成立|不正确|错[的误]|矛盾", after):
            continue
        expression = next(part for part in match.groups() if part is not None)
        pieces = re.split(r"(=|\\neq?|≠|<|>|≤|≥|\\leq?|\\geq?)", expression)
        for index in range(1, len(pieces), 2):
            if pieces[index] != "=":
                continue
            left, right = pieces[index-1].strip(), pieces[index+1].strip()
            if max(len(left), len(right)) > 120:
                continue
            try:
                a, b = _sum(left), _sum(right)
            except (ValueError, ZeroDivisionError):
                continue
            if a is not None and b is not None and a != b:
                return f"${left}={right}$ 左侧为 {a}，右侧为 {b}。"
    return ""

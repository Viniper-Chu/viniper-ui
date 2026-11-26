"""Check numeric equalities and structured machine-readable math conclusions via exact rational arithmetic."""
from __future__ import annotations

import ast
import json
import re
from fractions import Fraction
from typing import Any

_MATH = re.compile(r"\$\$(.+?)\$\$|(?<!\$)\$(?!\$)([^$\n]+?)\$|\\\((.+?)\\\)|\\\[(.+?)\\\]", re.S)
# Unbraced TeX fraction arguments each consume exactly one digit.
_ARGUMENT = r"(?:\{([^{}]+)\}|(\d))"
_FRAC = re.compile(r"\\(?:dfrac|tfrac|frac)\s*" + _ARGUMENT + r"\s*" + _ARGUMENT)
_FENCED_BLOCK = re.compile(r"```(math-check|json)\s*\n(.*?)```", re.S | re.I)


def _normalize_tex_expr(text: str) -> str:
    expr = str(text or "").strip()
    expr = expr.replace("−", "-").replace("×", "*").replace("÷", "/")
    expr = re.sub(r"\\(?:left|right)\s*([()\[\]])", r"\1", expr)
    expr = expr.replace("[", "(").replace("]", ")")
    expr = re.sub(r"\\(?:times|cdot)\b", " * ", expr)
    expr = re.sub(r"\\div\b", " / ", expr)
    for _ in range(6):
        next_expr = _FRAC.sub(
            lambda m: f"(({m.group(1) or m.group(2)})/({m.group(3) or m.group(4)}))",
            expr,
        )
        if next_expr == expr:
            break
        expr = next_expr
    expr = expr.replace("^", "**")
    # Support standard mathematical juxtaposition like 2x or 3(x - 1) when variables are provided.
    expr = re.sub(r"(\d)\s*([A-Za-z(])", r"\1*(\2" if False else r"\1*\2", expr)
    expr = re.sub(r"(\))\s*(\d|[A-Za-z(])", r"\1*\2", expr)
    return expr.strip()


def eval_rational_expr(text: str, env: dict[str, Fraction] | None = None) -> Fraction | None:
    """Safely evaluate a rational arithmetic/algebraic expression using exact Fraction."""
    norm = _normalize_tex_expr(text)
    if not norm or len(norm) > 240:
        return None
    if not env and re.search(r"[A-Za-z\\]", norm):
        return None
    if re.search(r"\\", norm):
        return None
    try:
        tree = ast.parse(norm, mode="eval")
    except SyntaxError:
        return None

    variables = env or {}

    def _eval(node: ast.AST) -> Fraction:
        if isinstance(node, ast.Expression):
            return _eval(node.body)
        if isinstance(node, ast.Constant) and isinstance(node.value, int) and not isinstance(node.value, bool):
            if abs(node.value) > 10**18:
                raise ValueError("integer too large")
            return Fraction(node.value)
        if isinstance(node, ast.Name):
            if node.id in variables:
                return variables[node.id]
            raise ValueError(f"unbound variable {node.id}")
        if isinstance(node, ast.UnaryOp):
            val = _eval(node.operand)
            if isinstance(node.op, ast.UAdd):
                return val
            if isinstance(node.op, ast.USub):
                return -val
            raise ValueError("unsupported unary op")
        if isinstance(node, ast.BinOp):
            left = _eval(node.left)
            right = _eval(node.right)
            if isinstance(node.op, ast.Add):
                return left + right
            if isinstance(node.op, ast.Sub):
                return left - right
            if isinstance(node.op, ast.Mult):
                return left * right
            if isinstance(node.op, ast.Div):
                if right == 0:
                    raise ZeroDivisionError("division by zero")
                return left / right
            if isinstance(node.op, ast.Pow):
                if right.denominator != 1 or abs(right.numerator) > 12:
                    raise ValueError("non-integer or large exponent")
                exp = int(right.numerator)
                if exp < 0 and left == 0:
                    raise ZeroDivisionError("zero to negative power")
                return left ** exp
            raise ValueError("unsupported binary op")
        raise ValueError("unsupported syntax")

    val = _eval(tree)
    if abs(val.numerator) > 10**30 or val.denominator > 10**30:
        return None
    return val


def _parse_bound(raw: Any) -> Fraction | None:
    if raw is None:
        return None
    s = str(raw).strip().lower().replace("−", "-").replace("∞", "inf").replace("\\infty", "inf")
    if s in {"", "-inf", "+inf", "inf", "none", "null"}:
        return None
    return eval_rational_expr(str(raw))


def _fmt_domain(domain: dict[str, Any]) -> str:
    lo = domain.get("lower")
    hi = domain.get("upper")
    lo_open = bool(domain.get("lower_open", False))
    hi_open = bool(domain.get("upper_open", False))
    lo_s = "-∞" if lo is None or str(lo).strip().lower() in {"", "-inf", "none"} else str(lo)
    hi_s = "+∞" if hi is None or str(hi).strip().lower() in {"", "+inf", "inf", "none"} else str(hi)
    left_br = "(" if lo_open or lo_s == "-∞" else "["
    right_br = ")" if hi_open or hi_s == "+∞" else "]"
    return f"{left_br}{lo_s}, {hi_s}{right_br}"


def _rational_in_domain(x: Fraction, domain: dict[str, Any]) -> bool:
    lo = _parse_bound(domain.get("lower"))
    hi = _parse_bound(domain.get("upper"))
    lo_open = bool(domain.get("lower_open", False))
    hi_open = bool(domain.get("upper_open", False))
    if lo is not None:
        if x < lo or (lo_open and x == lo):
            return False
    if hi is not None:
        if x > hi or (hi_open and x == hi):
            return False
    return True


def _quad_root_cmp_bound(center: Fraction, r2: Fraction, sigma: int, bound: Fraction) -> int:
    """Compare x = center + sigma * sqrt(r2) (sigma in {-1, +1}, r2 > 0) with rational bound.
    Returns -1 if x < bound, 0 if x == bound, +1 if x > bound, using exact Fraction arithmetic."""
    d = bound - center
    if sigma > 0:
        if d <= 0:
            return 1
        d2 = d * d
        return -1 if r2 < d2 else (0 if r2 == d2 else 1)
    # sigma < 0: comparing -sqrt(r2) vs d  <=>  comparing d vs -sqrt(r2)
    if d >= 0:
        return -1
    d2 = d * d
    return 1 if r2 < d2 else (0 if r2 == d2 else -1)


def _quad_root_in_domain(center: Fraction, r2: Fraction, sigma: int, domain: dict[str, Any]) -> bool:
    lo = _parse_bound(domain.get("lower"))
    hi = _parse_bound(domain.get("upper"))
    lo_open = bool(domain.get("lower_open", False))
    hi_open = bool(domain.get("upper_open", False))
    if lo is not None:
        cmp_lo = _quad_root_cmp_bound(center, r2, sigma, lo)
        if cmp_lo < 0 or (lo_open and cmp_lo == 0):
            return False
    if hi is not None:
        cmp_hi = _quad_root_cmp_bound(center, r2, sigma, hi)
        if cmp_hi > 0 or (hi_open and cmp_hi == 0):
            return False
    return True


def _detect_quadratic(expr: str, var: str) -> tuple[Fraction, Fraction, Fraction] | None:
    """If expr is identically p*var^2 + q*var + r over Q, return (p, q, r); else None."""
    try:
        g0 = eval_rational_expr(expr, {var: Fraction(0)})
        g1 = eval_rational_expr(expr, {var: Fraction(1)})
        gm1 = eval_rational_expr(expr, {var: Fraction(-1)})
        if g0 is None or g1 is None or gm1 is None:
            return None
        r = g0
        p = (g1 + gm1) / 2 - r
        q = (g1 - gm1) / 2
        for probe in (Fraction(2), Fraction(-2), Fraction(3), Fraction(5), Fraction(7, 3)):
            gv = eval_rational_expr(expr, {var: probe})
            if gv is None or gv != p * probe * probe + q * probe + r:
                return None
        return (p, q, r)
    except (ZeroDivisionError, ValueError):
        return None


def _exact_poly_roots_in_domain(p: Fraction, q: Fraction, r: Fraction, target_a: Fraction, domain: dict[str, Any]) -> int | None:
    """Count distinct real solutions of p*x^2 + q*x + (r - target_a) = 0 in domain."""
    c0 = r - target_a
    if p == 0:
        if q == 0:
            return 0 if c0 != 0 else None
        x0 = -c0 / q
        return 1 if _rational_in_domain(x0, domain) else 0
    disc = q * q - 4 * p * c0
    if disc < 0:
        return 0
    center = -q / (2 * p)
    if disc == 0:
        return 1 if _rational_in_domain(center, domain) else 0
    r2 = disc / (4 * p * p)
    count = 0
    if _quad_root_in_domain(center, r2, -1, domain):
        count += 1
    if _quad_root_in_domain(center, r2, 1, domain):
        count += 1
    return count


_CMP_OPS = ("<=", ">=", "==", "!=", "<", ">", "=")


def _eval_single_atom(atom: str, param: str, val: Fraction, boundaries_out: set[Fraction]) -> bool | None:
    s = atom.strip().replace("≤", "<=").replace("≥", ">=").replace("≠", "!=").replace("−", "-")
    if not s:
        return None
    set_match = re.fullmatch(rf"{re.escape(param)}\s*(?:∈|\\in|in)\s*\{{([^{{}}]+)\}}", s)
    if set_match:
        members: list[Fraction] = []
        for item in set_match.group(1).split(","):
            fv = eval_rational_expr(item.strip())
            if fv is None:
                return None
            boundaries_out.add(fv)
            members.append(fv)
        return val in members

    tokens = re.split(r"(<=|>=|==|!=|<|>|=)", s)
    if len(tokens) < 3 or len(tokens) % 2 == 0:
        return None
    operands: list[Fraction] = []
    for idx in range(0, len(tokens), 2):
        part = tokens[idx].strip()
        if part == param:
            operands.append(val)
        else:
            fv = eval_rational_expr(part)
            if fv is None:
                return None
            boundaries_out.add(fv)
            operands.append(fv)
    for idx in range(1, len(tokens), 2):
        op = tokens[idx]
        lhs, rhs = operands[idx // 2], operands[idx // 2 + 1]
        ok = (
            lhs <= rhs if op == "<=" else
            lhs >= rhs if op == ">=" else
            lhs < rhs if op == "<" else
            lhs > rhs if op == ">" else
            lhs != rhs if op == "!=" else
            lhs == rhs
        )
        if not ok:
            return False
    return True


def _eval_condition(cond: str, param: str, val: Fraction, boundaries_out: set[Fraction]) -> bool | None:
    normalized = re.sub(r"\s*(?:或|\\cup|∪|\bor\b|\|\|)\s*", " OR ", str(cond or "").strip(), flags=re.I)
    or_parts = [p.strip() for p in normalized.split(" OR ") if p.strip()]
    if not or_parts:
        return None
    any_true = False
    for disj in or_parts:
        conj_norm = re.sub(r"\s*(?:且|\band\b|&&|,|，)\s*", " AND ", disj, flags=re.I)
        and_parts = [p.strip() for p in conj_norm.split(" AND ") if p.strip()]
        conj_ok = True
        for atom in and_parts:
            res = _eval_single_atom(atom, param, val, boundaries_out)
            if res is None:
                return None
            if not res:
                conj_ok = False
        if conj_ok:
            any_true = True
    return any_true


def _sample_domain_rationals(domain: dict[str, Any]) -> list[Fraction]:
    lo = _parse_bound(domain.get("lower"))
    hi = _parse_bound(domain.get("upper"))
    candidates: set[Fraction] = set()
    if lo is not None and hi is not None and lo < hi:
        span = hi - lo
        for k in range(0, 25):
            candidates.add(lo + span * Fraction(k, 24))
        for denom in (3, 5, 7, 10):
            for num in range(1, denom):
                candidates.add(lo + span * Fraction(num, denom))
    elif lo is not None:
        for step in (Fraction(0), Fraction(1, 10), Fraction(1, 3), Fraction(1, 2), Fraction(1), Fraction(2), Fraction(5), Fraction(10)):
            candidates.add(lo + step)
    elif hi is not None:
        for step in (Fraction(0), Fraction(1, 10), Fraction(1, 3), Fraction(1, 2), Fraction(1), Fraction(2), Fraction(5), Fraction(10)):
            candidates.add(hi - step)
    else:
        for num in range(-12, 13):
            candidates.add(Fraction(num, 2))
            candidates.add(Fraction(num, 3))
    return sorted(x for x in candidates if _rational_in_domain(x, domain))


def parse_math_check_blocks(answer: str) -> tuple[list[dict[str, Any]], str]:
    blocks: list[dict[str, Any]] = []
    for match in _FENCED_BLOCK.finditer(str(answer or "")):
        tag = match.group(1).lower()
        body = match.group(2).strip()
        if not body:
            continue
        try:
            parsed = json.loads(body)
        except json.JSONDecodeError:
            if tag == "math-check":
                return [], "机器可读结论块 `math-check` 的 JSON 格式无法解析。"
            continue
        if isinstance(parsed, dict):
            target = parsed.get("math_check") if isinstance(parsed.get("math_check"), dict) else parsed
            if tag == "math-check" or target.get("type") in {"parametric_roots", "function_range", "equation_roots"}:
                blocks.append(target)
    return blocks, ""


def _verify_parametric_roots(spec: dict[str, Any]) -> str:
    var = str(spec.get("variable") or "x").strip()
    param = str(spec.get("parameter") or "a").strip()
    expr = str(spec.get("parameter_expr") or "").strip()
    domain = spec.get("domain") if isinstance(spec.get("domain"), dict) else {}
    pieces = spec.get("pieces")
    if not expr or not isinstance(pieces, list) or not pieces:
        return ""

    boundaries: set[Fraction] = {Fraction(0), Fraction(1), Fraction(-1)}
    for piece in pieces:
        if not isinstance(piece, dict) or "condition" not in piece or "roots" not in piece:
            return "机器可读结论块 `pieces` 缺少 `condition` 或 `roots` 字段。"
        probe = _eval_condition(str(piece["condition"]), param, Fraction(0), boundaries)
        if probe is None:
            return f"机器可读结论块中的分段条件「{piece['condition']}」无法解析，请使用如 `-3 < {param} < 0` 或 `{param} == 1` 的显式不等式。"

    poly = _detect_quadratic(expr, var)
    if poly is not None:
        p, q, r = poly
        if p != 0:
            vertex_x = -q / (2 * p)
            boundaries.add(p * vertex_x * vertex_x + q * vertex_x + r)
        for b_key in ("lower", "upper"):
            bv = _parse_bound(domain.get(b_key))
            if bv is not None:
                boundaries.add(p * bv * bv + q * bv + r)

    sorted_b = sorted(boundaries)
    test_a: list[Fraction] = []
    if sorted_b:
        test_a.append(sorted_b[0] - 1)
        for idx, b in enumerate(sorted_b):
            test_a.append(b)
            if idx + 1 < len(sorted_b):
                test_a.append((b + sorted_b[idx + 1]) / 2)
        test_a.append(sorted_b[-1] + 1)

    has_low_tail = bool(sorted_b and any(_eval_condition(str(pc["condition"]), param, sorted_b[0] - 100, set()) for pc in pieces))
    has_high_tail = bool(sorted_b and any(_eval_condition(str(pc["condition"]), param, sorted_b[-1] + 100, set()) for pc in pieces))
    expect_full_partition = has_low_tail and has_high_tail

    for a_val in test_a:
        matched = [pc for pc in pieces if _eval_condition(str(pc["condition"]), param, a_val, set())]
        if len(matched) > 1:
            conds = "、".join(str(m["condition"]) for m in matched)
            return f"有理数抽样核验未通过：当 {param} = {a_val} 时同时满足多个分段（{conds}），分段区间存在重叠。"
        if expect_full_partition and len(matched) == 0:
            return f"有理数抽样核验未通过：参数值 {param} = {a_val} 未被任何分段覆盖，请补齐临界点或区间。"
        if len(matched) == 1 and poly is not None:
            claimed = int(matched[0]["roots"])
            actual = _exact_poly_roots_in_domain(poly[0], poly[1], poly[2], a_val, domain)
            if actual is not None and actual != claimed:
                return (
                    f"有理数抽样核验未通过：当 {param} = {a_val} 时，方程在区间 {_fmt_domain(domain)} "
                    f"内实际有 {actual} 个不同实根，但定稿分段「{matched[0]['condition']}」写为 {claimed} 个。"
                )

    # Rational domain sampling (catches non-polynomial rational functions as well).
    preimages: dict[Fraction, list[Fraction]] = {}
    for x_val in _sample_domain_rationals(domain):
        try:
            a_at_x = eval_rational_expr(expr, {var: x_val})
        except ZeroDivisionError:
            continue
        if a_at_x is not None:
            preimages.setdefault(a_at_x, []).append(x_val)

    for a_at_x, xs in preimages.items():
        matched = [pc for pc in pieces if _eval_condition(str(pc["condition"]), param, a_at_x, set())]
        if not matched:
            return (
                f"有理数抽样核验未通过：取 {var} = {xs[0]} ∈ {_fmt_domain(domain)} 得 {param} = {a_at_x}，"
                f"该参数值未被任何分段覆盖。"
            )
        claimed = int(matched[0]["roots"])
        if claimed < len(xs):
            sample_str = ", ".join(str(v) for v in xs[:3])
            return (
                f"有理数抽样核验未通过：取 {var} = {sample_str} ∈ {_fmt_domain(domain)} 得 {param} = {a_at_x}，"
                f"区间内至少有 {len(xs)} 个不同实根，但定稿分段「{matched[0]['condition']}」写为 {claimed} 个。"
            )
    return ""


def _verify_function_range(spec: dict[str, Any]) -> str:
    var = str(spec.get("variable") or "x").strip()
    expr = str(spec.get("expr") or "").strip()
    domain = spec.get("domain") if isinstance(spec.get("domain"), dict) else {}
    rng = spec.get("range") if isinstance(spec.get("range"), dict) else {}
    if not expr or not rng:
        return ""

    for x_val in _sample_domain_rationals(domain):
        try:
            y_val = eval_rational_expr(expr, {var: x_val})
        except ZeroDivisionError:
            continue
        if y_val is not None and not _rational_in_domain(y_val, rng):
            return (
                f"有理数抽样核验未通过：取 {var} = {x_val} ∈ {_fmt_domain(domain)} 时函数值为 {y_val}，"
                f"超出了定稿所写值域 {_fmt_domain(rng)}。"
            )

    poly = _detect_quadratic(expr, var)
    if poly is not None:
        p, q, r = poly
        for side_key, open_key, label in (("lower", "lower_open", "下界"), ("upper", "upper_open", "上界")):
            bound = _parse_bound(rng.get(side_key))
            if bound is None:
                continue
            is_open = bool(rng.get(open_key, False))
            roots = _exact_poly_roots_in_domain(p, q, r, bound, domain)
            if roots is not None:
                if not is_open and roots == 0:
                    return (
                        f"有理数抽样核验未通过：定稿值域 {_fmt_domain(rng)} 包含闭端点 {bound}（{label}），"
                        f"但原函数在定义域 {_fmt_domain(domain)} 内无法取到 {bound}。"
                    )
                if is_open and roots > 0:
                    return (
                        f"有理数抽样核验未通过：定稿值域 {_fmt_domain(rng)} 将 {bound}（{label}）写为开端点，"
                        f"但原函数在定义域 {_fmt_domain(domain)} 内实际可取到 {bound}。"
                    )
            # Also verify no values exist strictly beyond bound
            probe = bound - Fraction(1, 1000) if side_key == "lower" else bound + Fraction(1, 1000)
            beyond = _exact_poly_roots_in_domain(p, q, r, probe, domain)
            if beyond is not None and beyond > 0:
                return f"有理数抽样核验未通过：原函数在 {_fmt_domain(domain)} 内可取到 {probe}，超出了定稿值域 {_fmt_domain(rng)}。"
    return ""


def _verify_equation_roots(spec: dict[str, Any]) -> str:
    var = str(spec.get("variable") or "x").strip()
    lhs = str(spec.get("lhs") or "").strip()
    rhs = str(spec.get("rhs") or "0").strip()
    domain = spec.get("domain") if isinstance(spec.get("domain"), dict) else None
    roots = spec.get("roots")
    if not lhs or not isinstance(roots, list):
        return ""
    for raw_root in roots:
        rv = eval_rational_expr(str(raw_root))
        if rv is None:
            continue
        if domain is not None and not _rational_in_domain(rv, domain):
            return f"有理数抽样核验未通过：候选根 {var} = {rv} 不在定义域 {_fmt_domain(domain)} 内。"
        try:
            lv = eval_rational_expr(lhs, {var: rv})
            rv_rhs = eval_rational_expr(rhs, {var: rv})
        except ZeroDivisionError:
            return f"有理数抽样核验未通过：候选根 {var} = {rv} 代入原式使分母为 0，属于增根，必须舍去。"
        if lv is not None and rv_rhs is not None and lv != rv_rhs:
            return f"有理数抽样核验未通过：将 {var} = {rv} 代入原方程，左侧为 {lv}，右侧为 {rv_rhs}，两侧不相等。"
    return ""


def verify_structured_math_check(answer: str) -> str:
    blocks, parse_err = parse_math_check_blocks(answer)
    if parse_err:
        return parse_err
    for spec in blocks:
        kind = str(spec.get("type") or "").strip()
        if kind == "parametric_roots":
            issue = _verify_parametric_roots(spec)
        elif kind == "function_range":
            issue = _verify_function_range(spec)
        elif kind == "equation_roots":
            issue = _verify_equation_roots(spec)
        else:
            issue = ""
        if issue:
            return issue
    return ""


def inconsistent_equality(answer: str) -> str:
    prose = re.sub(r"```.*?(?:```|$)|`[^`\n]*`", "", str(answer or ""), flags=re.S)
    for match in _MATH.finditer(prose):
        # Quoted mistakes and hypothetical equalities may be deliberately false.
        before = re.split(r"[。！？\n]", prose[max(0, match.start() - 100):match.start()])[-1]
        after = re.split(r"[。！？\n，,；;]", prose[match.end():match.end() + 50])[0]
        if re.search(r"误写|错误|错写|反设|假设|假定|若|假如|不能写", before) or re.search(r"不成立|不正确|错[的误]|矛盾", after):
            continue
        expression = next(part for part in match.groups() if part is not None)
        pieces = re.split(r"(=|\\neq?|≠|<|>|≤|≥|\\leq?|\\geq?)", expression)
        for index in range(1, len(pieces), 2):
            if pieces[index] != "=":
                continue
            left, right = pieces[index - 1].strip(), pieces[index + 1].strip()
            if max(len(left), len(right)) > 120:
                continue
            try:
                a, b = eval_rational_expr(left), eval_rational_expr(right)
            except (ValueError, ZeroDivisionError):
                continue
            if a is not None and b is not None and a != b:
                return f"${left}={right}$ 左侧为 {a}，右侧为 {b}。"
    return verify_structured_math_check(answer)

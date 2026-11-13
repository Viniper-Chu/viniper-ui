"""Count distinct real roots in a rational interval, without floating-point square roots."""
from fractions import Fraction
import re


def rational(value):
    text = str(value)
    if len(text) > 64 or not re.fullmatch(r'[+-]?(?:\d+(?:/\d+|\.\d*)?|\.\d+)', text):
        raise ValueError('系数和端点须是整数、有限小数或分数字符串，例如 "-3/4"。')
    try:
        return Fraction(text)
    except ZeroDivisionError as exc:
        raise ValueError('分母不能为零。') from exc


def coefficients_and_interval(case):
    if not isinstance(case, dict) or not all(k in case for k in ('a', 'b', 'c')):
        raise ValueError('每组必须包含 a、b、c 三个系数。')
    a, b, c = (rational(case[k]) for k in ('a', 'b', 'c'))
    lo, hi = (rational(case[k]) if case.get(k) is not None else None for k in ('lower', 'upper'))
    left_open, right_open = (case.get(k, False) for k in ('lower_open', 'upper_open'))
    if not isinstance(left_open, bool) or not isinstance(right_open, bool):
        raise ValueError('端点开闭须用布尔值。')
    if lo is not None and hi is not None and lo > hi:
        raise ValueError('区间下端点大于上端点。')
    return a, b, c, lo, hi, left_open, right_open


def check(case):
    return branch_counts(*coefficients_and_interval(case))


def count_roots(a, b, c, lo, hi, left_open, right_open):
    singleton = lo is not None and lo == hi
    empty = singleton and (left_open or right_open)

    result = {'a': str(a), 'b': str(b), 'c': str(c),
              'lower': None if lo is None else str(lo), 'upper': None if hi is None else str(hi),
              'lower_open': left_open, 'upper_open': right_open}
    if a == b == 0:
        count = 0 if c or empty else 1 if singleton else 'infinite'
        return dict(result, distinct_roots=count)
    if a != 0:
        delta = b*b - 4*a*c
        result.update(discriminant=str(delta), axis=str(-b/(2*a)))
        if delta < 0:
            return dict(result, distinct_roots=0)
    if a == 0 or delta == 0:
        root = -c/b if a == 0 else -b/(2*a)
        inside = ((lo is None or root > lo or (root == lo and not left_open)) and
                  (hi is None or root < hi or (root == hi and not right_open)))
        return dict(result, root=str(root), distinct_roots=int(inside))

    def rank(x):
        # For two real roots, sign locates the inner interval; the vertex distinguishes its two sides.
        value = (a*x*x + b*x + c) * a
        left = x < -b/(2*a)
        if value == 0:
            return (0 if left else 1), 1
        if value < 0:
            return 1, 0
        return (0 if left else 2), 0

    before = 0
    if lo is not None:
        less, equal = rank(lo)
        before = less + (equal if left_open else 0)
    through = 2
    if hi is not None:
        less, equal = rank(hi)
        through = less + (0 if right_open else equal)
    return dict(result, distinct_roots=max(0, through-before))


def branch_counts(a, b, c, lo, hi, left_open, right_open):
    """Intersect the original interval with each closed half at the vertex."""
    total = count_roots(a, b, c, lo, hi, left_open, right_open)
    if not a:
        return total
    vertex = -b/(2*a)
    left = 0 if lo is not None and lo > vertex else count_roots(
        a, b, c, lo, min(hi, vertex) if hi is not None else vertex,
        left_open, right_open if hi is not None and hi <= vertex else False)['distinct_roots']
    right = 0 if hi is not None and hi < vertex else count_roots(
        a, b, c, max(lo, vertex) if lo is not None else vertex, hi,
        left_open if lo is not None and lo >= vertex else False, right_open)['distinct_roots']
    return dict(total, left_branch=left, right_branch=right,
                shared_vertex=left+right-total['distinct_roots'])


def check_cases(cases):
    if not isinstance(cases, list) or not cases or len(cases) > 64:
        raise ValueError('请提供 1 至 64 组系数与区间。')
    results = []
    for number, case in enumerate(cases, 1):
        try:
            results.append(check(case))
        except ValueError as error:
            raise ValueError(f'第 {number} 组：{error}') from error
    return {'ok': True, 'cases': results}


def affine_constant(text):
    # Also accept the familiar zero form A*x²+B*x+(offset+slope*p)=0.
    number = r'(?:\d+(?:/\d+|\.\d*)?|\.\d+)'
    atom = rf'(?:(?P<factor>{number})\*?)?(?P<parameter>[a-zA-Z])'
    value = ''.join(text.split()).replace('−', '-')
    if len(value) > 64:
        raise ValueError('含参数的常数项过长。')
    left = rf'(?P<offset>[+-]?{number})(?P<sign>[+-]){atom}'
    right = rf'(?P<sign>[+-]?){atom}(?P<offset>[+-]{number})?'
    term = re.fullmatch(left, value) or re.fullmatch(right, value)
    if not term or term['parameter'].lower() == 'x':
        raise ValueError('零式的常数项只支持一个有理常数与一个一次参数项；也可先把参数独立移至右边，再传三个有理系数。')
    slope = rational(term['factor'] or 1) * (-1 if term['sign'] == '-' else 1)
    if not slope:
        raise ValueError('参数的系数不能为零。')
    return rational(term['offset'] or 0), slope, term['parameter']


def level_counts(family):
    """The count can change only at a finite endpoint value or an interior extremum."""
    if not isinstance(family, dict):
        raise ValueError('level_family 必须包含 a、b、c 和可选的区间端点。')
    raw = family.get('c')
    symbolic = isinstance(raw, str) and re.search('[A-Za-z]', raw)
    parameter = 't'
    if symbolic:
        offset, slope, parameter = affine_constant(raw)
        a, b, _, lo, hi, left_open, right_open = coefficients_and_interval({**family, 'c': 0})
        a, b, c = -a/slope, -b/slope, -offset/slope
    else:
        a, b, c, lo, hi, left_open, right_open = coefficients_and_interval(family)
    def value(x):
        return (a*x + b)*x + c

    cuts = {value(x) for x in (lo, hi) if x is not None}
    geometry = {'endpoints': []}
    for side, x, excluded in [('lower', lo, left_open), ('upper', hi, right_open)]:
        if x is not None:
            geometry['endpoints'].append({'side': side, 'x': str(x), 'level': str(value(x)), 'included': not excluded})
    if a:
        vertex = -b/(2*a)
        in_closure = (lo is None or lo <= vertex) and (hi is None or vertex <= hi)
        in_domain = in_closure and not ((vertex == lo and left_open) or (vertex == hi and right_open))
        geometry['vertex'] = {'x': str(vertex), 'level': str(value(vertex)), 'in_domain': in_domain,
                              'kind': 'minimum' if a > 0 else 'maximum'}
        if in_closure:
            cuts.add(value(vertex))
    elif not b:
        cuts.add(c)

    def count_at(t):
        # All values are already validated Fractions. Shift the constant term to compare with t.
        counts = branch_counts(a, b, c-t, lo, hi, left_open, right_open)
        return {key: counts[key] for key in ('left_branch', 'right_branch', 'shared_vertex', 'distinct_roots') if key in counts}

    ordered = sorted(cuts)
    pieces = []
    for i in range(len(ordered)+1):
        left = ordered[i-1] if i else None
        right = ordered[i] if i < len(ordered) else None
        if left is None:
            sample = right-1 if right is not None else Fraction(0)
        else:
            sample = (left+right)/2 if right is not None else left+1
        pieces.append({'t_above': str(left) if left is not None else None,
                       't_below': str(right) if right is not None else None,
                       **count_at(sample)})
        if right is not None:
            pieces.append({'t_equals': str(right), **count_at(right)})
    result = {'ok': True, 'parameter': parameter, 'normalized_level_coefficients': [str(v) for v in (a, b, c)],
            'interpretation': '原多项式等于零，已移项解出参数' if symbolic else '多项式等于水平参数',
            'geometry': geometry, 'pieces': pieces,
            'basis': '区间端点的有限函数值与区间内顶点的函数值划分所有水平线；每一单调支在相邻临界值之间的交点个数恒定。'}

    if a:
        domain = (('(' if lo is None or left_open else '[')
                  + (str(lo) if lo is not None else '−∞') + ', '
                  + (str(hi) if hi is not None else '+∞')
                  + (')' if hi is None or right_open else ']'))
        def interval(low, high, low_open, high_open):
            if low == high and low is not None:
                return '∅' if low_open or high_open else str(low)
            return (('(' if low is None or low_open else '[')
                    + (str(low) if low is not None else '−∞') + ', '
                    + (str(high) if high is not None else '+∞')
                    + (')' if high is None or high_open else ']'))

        def describe_branch(left):
            if (left and lo is not None and lo > vertex) or (not left and hi is not None and hi < vertex):
                return '为空'
            start = lo if left or (lo is not None and lo >= vertex) else vertex
            end = hi if not left or (hi is not None and hi <= vertex) else vertex
            start_open = (start is None) or (start == lo and left_open) or (start == hi and right_open)
            end_open = (end is None) or (end == hi and right_open) or (end == lo and left_open)
            domain_label = interval(start, end, start_open, end_open)
            if domain_label == '∅':
                return '为空'
            if start == end:
                return f'仅含点 $x={start}$，函数值为 {value(start)}'
            increasing = (a < 0) if left else (a > 0)
            level_start = value(start) if start is not None else None
            level_end = value(end) if end is not None else None
            image = interval(level_start, level_end, start_open, end_open) if increasing else interval(level_end, level_start, end_open, start_open)
            return f'的定义域为 {domain_label}，严格{"递增" if increasing else "递减"}，值域为 {image}'

        def level_label(piece):
            if 't_equals' in piece:
                return f"{parameter} = {piece['t_equals']}"
            lower, upper = piece['t_above'], piece['t_below']
            if lower is None:
                return f'{parameter} < {upper}' if upper is not None else '全部实数'
            return f'{lower} < {parameter} < {upper}' if upper is not None else f'{parameter} > {lower}'
        lines = [f"在定义域 $x\\in {domain}$ 内，以 $x={vertex}$ 为分界。顶点若为解，左右列各含一次，总数扣除重复。",
                 "", "左支"+describe_branch(True)+"；右支"+describe_branch(False)+"。",
                 "", f"| 参数 {parameter} | 左支（$x\\le {vertex}$） | 右支（$x\\ge {vertex}$） | 共同顶点 | 不同实根数 |",
                 "|---|---:|---:|---:|---:|"]
        for piece in pieces:
            label = level_label(piece)
            lines.append(f"| ${label}$ | {piece['left_branch']} | {piece['right_branch']} | {piece['shared_vertex']} | {piece['distinct_roots']} |")
        result['branch_table'] = '\n'.join(lines)
    return result



def verify_request(request):
    options = [kind for kind in ('cases', 'level_family', 'level_families') if kind in request]
    if len(options) != 1:
        raise ValueError('请选择 cases、level_family 或 level_families 中的一种输入。')
    if options[0] == 'cases':
        return check_cases(request['cases'])
    if options[0] == 'level_family':
        return level_counts(request['level_family'])
    families = request['level_families']
    if not isinstance(families, list) or not 1 <= len(families) <= 64:
        raise ValueError('请一次传入 1 至 64 个需要分类的方程。')
    return {'ok': True, 'families': [level_counts(family) for family in families]}

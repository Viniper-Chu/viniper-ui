"""Evaluate small numerical checks as exact fractions, using arithmetic syntax only."""
import ast
from fractions import Fraction
import operator
import re

BINARY = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul,
          ast.Div: operator.truediv, ast.Pow: operator.pow}


def calculate(expression):
    if not isinstance(expression, str) or not 0 < len(expression) <= 200:
        raise ValueError('每个算式须为 1 至 200 个字符。')
    source = expression.strip().translate(str.maketrans({'−': '-', '×': '*', '÷': '/', '^': '**'}))
    if not re.fullmatch(r'[0-9.()+*/\- \t]+', source):
        raise ValueError('请先代入数值，仅保留十进制数、括号和四则运算或整数次幂。')
    tree = ast.parse(source, mode='eval')

    def value(node):
        if isinstance(node, ast.Constant) and type(node.value) in (int, float):
            return Fraction(ast.get_source_segment(source, node))
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.UAdd, ast.USub)):
            child = value(node.operand)
            return -child if isinstance(node.op, ast.USub) else child
        if isinstance(node, ast.BinOp) and type(node.op) in BINARY:
            left, right = value(node.left), value(node.right)
            if isinstance(node.op, ast.Pow):
                if right.denominator != 1 or abs(right) > 16:
                    raise ValueError('指数须为 −16 至 16 的整数。')
                right = int(right)
            result = BINARY[type(node.op)](left, right)
            if max(result.numerator.bit_length(), result.denominator.bit_length()) > 512:
                raise ValueError('数值超出课堂验算范围。')
            return result
        raise ValueError('算式中包含不支持的运算。')

    return str(value(tree.body))


def verify_arithmetic(request):
    expressions = request.get('expressions')
    if not isinstance(expressions, list) or not 1 <= len(expressions) <= 32:
        raise ValueError('请提交 1 至 32 个代入后的有理数算式。')
    return {'ok': True, 'results': [{'expression': expr, 'value': calculate(expr)} for expr in expressions]}

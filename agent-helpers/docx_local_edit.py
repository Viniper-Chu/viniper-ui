"""Small, standard-library DOCX inspector and format-preserving text editor.

All indices are zero-based. Table columns are physical w:tc cells, not an
expanded grid of merged cells. Tables are numbered in document order, including
nested tables; body paragraphs exclude table cells. Paragraph indices inside a
cell exclude nested tables. Document paragraph indices include titles/headings;
inspect exposes their style_id. Edit changes existing text runs, not their format.

Examples:
  python3 docx_local_edit.py inspect '资料/表格.docx'
  python3 docx_local_edit.py edit '资料/表格.docx' --table 1 --row 2 --col 0 \
      --paragraph 0 --expect '旧文字' --runs-json '{"1":"新","2":"文字"}'
  python3 docx_local_edit.py edit '资料/说明.docx' --paragraph 0 \
      --expect '旧内容' --runs-json '{"0":"新内容"}'
  python3 docx_local_edit.py replace '资料/说明.docx' --paragraph 0 \
      --expect '状态：草稿.' --old-text '草稿' --new-text '已确认'

The request command reads one JSON object from stdin. Use action=inspect,
replace or edit; provide path and the same named fields without CLI dashes.
For edit, run_texts is an object with string run-index keys. Paths and text in
JSON remain data, including apostrophes, dollar signs and backticks.
Replace preserves same-format spans automatically and maps equal-length text
across different formats by character position. Unequal-length replacements
across different formats require an explicit edit mapping.

Only UTF-8 document.xml is edited. Runs containing fields, drawings, tabs or
breaks can be inspected but cannot be changed by this text-only editor. No runs
are added or removed. Multiple w:t nodes in a run retain their original tags.
inspect reports original rPr XML as direct formatting, not resolved style inheritance.
"""
from __future__ import annotations

import argparse
from copy import copy
from dataclasses import dataclass, field
from io import BytesIO
import json
import os
from pathlib import Path
import re
import stat
import sys
import tempfile
from xml.parsers import expat
from xml.sax.saxutils import escape
from zipfile import BadZipFile, ZipFile


DOCUMENT = 'word/document.xml'
WORD_NAMESPACES = {
    'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
    'http://purl.oclc.org/ooxml/wordprocessingml/main',
}
MATH_NAMESPACES = {
    'http://schemas.openxmlformats.org/officeDocument/2006/math',
    'http://purl.oclc.org/ooxml/officeDocument/math',
}
OFFICE_NAMESPACE = 'urn:schemas-microsoft-com:office:office'
XML_SPACE = 'http://www.w3.org/XML/1998/namespace|space'


@dataclass
class Node:
    name: str
    attrs: dict
    start: int
    content_start: int
    self_closing: bool
    content_end: int = 0
    end: int = 0
    text: str = ''
    children: list = field(default_factory=list)

    def is_word(self, local):
        namespace, _, name = self.name.rpartition('|')
        return namespace in WORD_NAMESPACES and name == local


def _tag_end(xml, start):
    quote = None
    for index in range(start, len(xml)):
        char = xml[index]
        if quote:
            if char == quote:
                quote = None
        elif char in (34, 39):
            quote = char
        elif char == 62:
            return index + 1
    raise ValueError('Unterminated XML tag')


def _parse(xml):
    xml.decode('utf-8-sig')
    if b'\x00' in xml:
        raise ValueError('Only UTF-8 document.xml is supported')
    parser = expat.ParserCreate(namespace_separator='|')
    stack, roots = [], []

    def declaration(version, encoding, standalone):
        if encoding and encoding.lower().replace('-', '') != 'utf8':
            raise ValueError('Only UTF-8 document.xml is supported')

    def no_doctype(*args):
        raise ValueError('DOCTYPE is not supported in document.xml')

    def start(name, attrs):
        offset = parser.CurrentByteIndex
        end = _tag_end(xml, offset)
        node = Node(name, attrs, offset, end, xml[offset:end].endswith(b'/>'))
        (stack[-1].children if stack else roots).append(node)
        stack.append(node)

    def end(name):
        node = stack.pop()
        node.content_end = node.content_start if node.self_closing else parser.CurrentByteIndex
        node.end = node.content_start if node.self_closing else _tag_end(xml, node.content_end)

    def characters(text):
        if stack and stack[-1].is_word('t'):
            stack[-1].text += text

    parser.XmlDeclHandler = declaration
    parser.StartDoctypeDeclHandler = no_doctype
    parser.StartElementHandler = start
    parser.EndElementHandler = end
    parser.CharacterDataHandler = characters
    parser.Parse(xml, True)
    if len(roots) != 1 or not roots[0].is_word('document'):
        raise ValueError('Expected a Word document root')
    return roots[0]


def _contained(node, name, stops=()):
    for child in node.children:
        if child.is_word(name):
            yield child
        elif not any(child.is_word(stop) for stop in stops):
            yield from _contained(child, name, stops)


def _tables(node):
    for child in node.children:
        if child.is_word('tbl'):
            yield child
        yield from _tables(child)


def _structure(xml, root=None):
    root = _parse(xml) if root is None else root
    bodies = [child for child in root.children if child.is_word('body')]
    if len(bodies) != 1:
        raise ValueError('Expected exactly one document body')
    body = bodies[0]
    paragraphs = list(_contained(body, 'p', ('tbl',)))
    tables = []
    for table in _tables(body):
        tables.append([
            [list(_contained(cell, 'p', ('tbl',))) for cell in _contained(row, 'tc', ('tbl',))]
            for row in _contained(table, 'tr', ('tbl',))
        ])
    return paragraphs, tables


def _runs(paragraph):
    return list(_contained(paragraph, 'r', ('p', 'tbl')))


def _run_text(run):
    return ''.join(child.text if child.is_word('t') else
                   '\t' if child.is_word('tab') else
                   '\n' if child.is_word('br') or child.is_word('cr') else ''
                   for child in run.children)


def _editable(run):
    return any(c.is_word('t') for c in run.children) and all(
        c.is_word('t') or c.is_word('rPr') for c in run.children)


def _paragraph_view(paragraph, index, xml):
    runs = _runs(paragraph)
    style_id = None
    for properties in paragraph.children:
        if properties.is_word('pPr'):
            for item in properties.children:
                if item.is_word('pStyle'):
                    style_id = item.attrs.get(item.name.rpartition('|')[0] + '|val')
    return {'paragraph': index, 'style_id': style_id, 'text': ''.join(_run_text(r) for r in runs),
            'runs': [{'run': i, 'text': _run_text(r), 'editable': _editable(r),
                      'rpr_xml': ''.join(xml[c.start:c.end].decode('utf-8') for c in r.children if c.is_word('rPr'))}
                     for i, r in enumerate(runs)]}


def _read_package(data):
    with ZipFile(BytesIO(data)) as archive:
        entries = [(copy(info), archive.read(info)) for info in archive.infolist()]
        comment = archive.comment
    documents = [data for info, data in entries if info.filename == DOCUMENT]
    if len(documents) != 1:
        raise ValueError('Expected exactly one word/document.xml ZIP entry')
    return entries, comment, documents[0]


def _content_coverage(root):
    counts = dict(ole_objects=0, office_math=0, drawings=0, legacy_pictures=0)
    def visit(node):
        namespace, _, name = node.name.rpartition('|')
        if namespace == OFFICE_NAMESPACE and name == 'OLEObject':
            counts['ole_objects'] += 1
        elif namespace in MATH_NAMESPACES and name == 'oMath':
            counts['office_math'] += 1
        elif node.is_word('drawing'):
            counts['drawings'] += 1
        elif node.is_word('pict'):
            counts['legacy_pictures'] += 1
        for child in node.children:
            visit(child)
    visit(root)
    result = {'scope': DOCUMENT, 'text_view': 'ordinary_word_text_only',
              **counts, 'text_only_incomplete': any(counts.values())}
    if result['text_only_incomplete']:
        result['warning'] = ('本视图只提取普通文字，未读取检测到的公式、嵌入对象或图形内容；'
                             '不能据此认定原题完整，请核对对应原页面或已有TeX源码。'
                             '计数为XML节点，类别可能重叠；页眉页脚不在此视图内。')
    return result


def inspect_docx(path):
    path = Path(path).expanduser().resolve(strict=True)
    _, _, xml = _read_package(path.read_bytes())
    root = _parse(xml)
    paragraphs, tables = _structure(xml, root)
    return {'ok': True, 'path': str(path), 'index_base': 0, 'column_indexing': 'physical_cells',
            'paragraph_indexing': 'Document paragraphs include titles and headings but exclude table cells. Use style_id and content to locate user-described body paragraphs; paragraph is not a body paragraph number.',
            'format_note': 'rpr_xml is original direct run formatting, not formatting resolved through inherited styles.',
            'content_coverage': _content_coverage(root),
            'paragraphs': [_paragraph_view(p, i, xml) for i, p in enumerate(paragraphs)],
            'tables': [{'table': t, 'rows': [
                {'row': r, 'cells': [{'col': c, 'paragraphs': [_paragraph_view(p, i, xml) for i, p in enumerate(cell)]}
                                     for c, cell in enumerate(row)]}
                for r, row in enumerate(table)]} for t, table in enumerate(tables)]}


def _select(xml, paragraph, table=None, row=None, col=None):
    if any(value is not None and (type(value) is not int or value < 0)
           for value in (paragraph, table, row, col)) or paragraph is None:
        raise ValueError('Indices must be non-negative integers')
    if (table is None and (row is not None or col is not None)) or (
            table is not None and (row is None or col is None)):
        raise ValueError('Supply --table, --row and --col together, or omit all three')
    paragraphs, tables = _structure(xml)
    try:
        return paragraphs[paragraph] if table is None else tables[table][row][col][paragraph]
    except IndexError as error:
        raise ValueError('Document location is out of range; run inspect first') from error


def _text_edits(xml, node, text):
    if node.text == text:
        return []
    if any(not (char in '\t\n\r' or 0x20 <= ord(char) <= 0xD7FF or
                0xE000 <= ord(char) <= 0xFFFD or 0x10000 <= ord(char) <= 0x10FFFF) for char in text):
        raise ValueError('Run text contains an invalid XML character')
    encoded = escape(text).replace('\r', '&#13;').encode('utf-8')
    opening = xml[node.start:node.content_start]
    if text and (text[0].isspace() or text[-1].isspace()) and node.attrs.get(XML_SPACE) != 'preserve':
        if XML_SPACE in node.attrs:
            opening = re.sub(rb'(\bxml:space\s*=\s*)([\'"])(.*?)\2',
                             lambda m: m[1] + m[2] + b'preserve' + m[2], opening)
        else:
            offset = -2 if node.self_closing else -1
            opening = opening[:offset] + b' xml:space="preserve"' + opening[offset:]
    if node.self_closing:
        qname = re.match(rb'<([^\s/>]+)', opening)[1]
        return [(node.start, node.end, opening[:-2] + b'>' + encoded + b'</' + qname + b'>')]
    edits = [(node.content_start, node.content_end, encoded)]
    if opening != xml[node.start:node.content_start]:
        edits.append((node.start, node.content_start, opening))
    return edits


def _verify(path, entries, comment, expected_xml, location, expected_runs):
    actual, actual_comment, xml = _read_package(path.read_bytes())
    if actual_comment != comment or [i.filename for i, _ in actual] != [i.filename for i, _ in entries]:
        raise ValueError('Read-back ZIP entry list or archive comment differs')
    for (old_info, old_data), (_, new_data) in zip(entries, actual):
        expected = expected_xml if old_info.filename == DOCUMENT else old_data
        if new_data != expected:
            raise ValueError('Read-back part differs: ' + old_info.filename)
    paragraph = _select(xml, **location)
    if [_run_text(run) for run in _runs(paragraph)] != expected_runs:
        raise ValueError('Read-back run text differs')


def _replacement_runs(old_runs, old_text, new_text, run_formats):
    if not isinstance(old_text, str) or not old_text or not isinstance(new_text, str):
        raise ValueError('old_text must be non-empty and new_text must be a string')
    combined = ''.join(old_runs)
    start = combined.find(old_text)
    if start < 0 or combined.find(old_text, start + 1) >= 0:
        raise ValueError('old_text must occur exactly once in the selected paragraph')
    end = start + len(old_text)
    affected, position = [], 0
    for index, text in enumerate(old_runs):
        left, right = max(start, position), min(end, position + len(text))
        if left < right:
            affected.append((index, left-position, right-position, left-start, right-start))
        position += len(text)
    resize = len(new_text) != len(old_text)
    same_format = len({run_formats[item[0]] for item in affected}) == 1
    if len(affected) > 1 and new_text and resize and not same_format:
        raise ValueError('Unequal-length replacement spans multiple runs; use edit with an explicit format-preserving run_texts mapping')
    mapping = {}
    for order, (index, left, right, new_left, new_right) in enumerate(affected):
        piece = (new_text if order == 0 else '') if resize else new_text[new_left:new_right]
        mapping[index] = old_runs[index][:left] + piece + old_runs[index][right:]
    return mapping


def replace_docx(path, *, paragraph, expect, old_text, new_text, table=None, row=None, col=None):
    """Replace one occurrence without asking the caller to redistribute styles."""
    return edit_docx(path, paragraph=paragraph, expect=expect, old_text=old_text,
                     new_text=new_text, table=table, row=row, col=col)


def edit_docx(path, *, paragraph, expect, run_texts=None, table=None, row=None, col=None,
              old_text=None, new_text=None):
    path = Path(path).expanduser().resolve(strict=True)
    original = path.read_bytes()
    entries, comment, xml = _read_package(original)
    location = {'paragraph': paragraph, 'table': table, 'row': row, 'col': col}
    selected = _select(xml, **location)
    runs = _runs(selected)
    old_runs = [_run_text(run) for run in runs]
    paragraph_text = ''.join(old_runs)
    if not isinstance(expect, str) or paragraph_text != expect:
        raise ValueError('Expected paragraph text does not match; no file was written')
    if run_texts is None:
        formats, group = [], 0
        for index, run in enumerate(runs):
            # Matching appearance does not make links, bookmarks or field boundaries interchangeable.
            if index and (xml[runs[index-1].end:run.start].strip()
                          or not _editable(runs[index-1]) or not _editable(run)):
                group += 1
            rpr = ''.join(xml[c.start:c.end].decode('utf-8') for c in run.children if c.is_word('rPr'))
            formats.append((group, rpr))
        run_texts = _replacement_runs(old_runs, old_text, new_text, formats)
    elif old_text is not None or new_text is not None:
        raise ValueError('Use either run_texts or old_text/new_text, not both')
    if not isinstance(run_texts, dict) or not run_texts:
        raise ValueError('run_texts must be a non-empty mapping of run indices to strings')
    expected_runs, edits = list(old_runs), []
    for index, text in run_texts.items():
        if type(index) is not int or not 0 <= index < len(runs) or not isinstance(text, str):
            raise ValueError('Each run index must exist and each replacement must be a string')
        if text == old_runs[index]:
            continue
        run = runs[index]
        if not _editable(run):
            raise ValueError(f'Run {index} is not text-only or has no w:t; no file was written')
        expected_runs[index] = text
        nodes = [child for child in run.children if child.is_word('t')]
        offset = 0
        for i, node in enumerate(nodes):
            end = offset + len(node.text) if i < len(nodes) - 1 else len(text)
            edits.extend(_text_edits(xml, node, text[offset:end]))
            offset = end
    new_xml = xml
    for start, end, data in sorted(edits, reverse=True):
        new_xml = new_xml[:start] + data + new_xml[end:]
    result = {'ok': True, 'path': str(path), 'location': location, 'old_text': paragraph_text,
              'text': ''.join(expected_runs), 'changed': new_xml != xml, 'verified': True,
              'edited_runs': sorted(i for i in run_texts if old_runs[i] != expected_runs[i]),
              'changed_parts': [DOCUMENT] if new_xml != xml else []}
    if new_xml == xml:
        return result
    # Parse and check expected text before creating any temporary file.
    if [_run_text(run) for run in _runs(_select(new_xml, **location))] != expected_runs:
        raise ValueError('Replacement XML does not match the requested run text')
    fd, name = tempfile.mkstemp(prefix='.' + path.stem + '-', suffix='.docx', dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(fd, 'w+b') as output:
            with ZipFile(output, 'w') as archive:
                archive.comment = comment
                for info, data in entries:
                    archive.writestr(copy(info), new_xml if info.filename == DOCUMENT else data)
        os.chmod(temporary, stat.S_IMODE(path.stat().st_mode))
        _verify(temporary, entries, comment, new_xml, location, expected_runs)
        if path.read_bytes() != original:
            raise ValueError('Source changed during editing; no replacement was written')
        os.replace(temporary, path)
        _verify(path, entries, comment, new_xml, location, expected_runs)
    finally:
        temporary.unlink(missing_ok=True)
    return result


def _run_mapping(value):
    def pairs(items):
        result = {}
        for key, text in items:
            if not re.fullmatch(r'0|[1-9][0-9]*', key) or int(key) in result or not isinstance(text, str):
                raise ValueError('Run keys must be unique non-negative integers and values must be strings')
            result[int(key)] = text
        return result
    result = json.loads(value, object_pairs_hook=pairs)
    if not isinstance(result, dict) or not result:
        raise ValueError('--runs-json must be a non-empty JSON object, such as {"0":"new text"}')
    return result


def document_request(payload):
    """JSON data entry point: paths and replacement text never enter a shell."""
    if not isinstance(payload, dict) or not isinstance(payload.get('path'), str) or not payload['path']:
        raise ValueError('Request must be an object with a non-empty path string')
    action = payload.get('action')
    if action == 'inspect':
        return inspect_docx(payload['path'])
    location = {name:payload.get(name) for name in ('paragraph','table','row','col')}
    if action == 'replace':
        return replace_docx(payload['path'], expect=payload.get('expect'),
                            old_text=payload.get('old_text'), new_text=payload.get('new_text'), **location)
    if action == 'edit':
        mapping = _run_mapping(json.dumps(payload.get('run_texts'),ensure_ascii=False))
        return edit_docx(payload['path'], expect=payload.get('expect'), run_texts=mapping, **location)
    raise ValueError('action must be inspect, replace or edit')


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest='command', required=True)
    inspect = commands.add_parser('inspect', help='List body paragraphs, physical table cells and text runs')
    inspect.add_argument('path')
    edit = commands.add_parser('edit', help='Replace selected run texts in place after an exact paragraph-text check')
    replace_cmd = commands.add_parser('replace', help='Replace text while preserving existing run styles automatically')
    for command in (edit, replace_cmd):
        command.add_argument('path')
        for name in ('table', 'row', 'col', 'paragraph'):
            command.add_argument('--' + name, type=int, required=name == 'paragraph')
        command.add_argument('--expect', required=True, help='Exact current text of the selected paragraph')
    edit.add_argument('--runs-json', required=True, help='JSON object mapping run indices to new text; other runs stay unchanged')
    replace_cmd.add_argument('--old-text', required=True)
    replace_cmd.add_argument('--new-text', required=True)
    commands.add_parser('request', help='Read a single inspect/replace/edit JSON request from stdin')
    args = parser.parse_args(argv)
    try:
        if args.command == 'request':
            result = document_request(json.load(sys.stdin))
        elif args.command == 'inspect':
            result = inspect_docx(args.path)
        elif args.command == 'replace':
            result = replace_docx(args.path, paragraph=args.paragraph, table=args.table, row=args.row,
                                  col=args.col, expect=args.expect, old_text=args.old_text, new_text=args.new_text)
        else:
            result = edit_docx(args.path, paragraph=args.paragraph, table=args.table, row=args.row,
                               col=args.col, expect=args.expect, run_texts=_run_mapping(args.runs_json))
    except (ValueError, OSError, BadZipFile, expat.ExpatError) as error:
        print(json.dumps({'ok': False, 'error': str(error)}, ensure_ascii=False), file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

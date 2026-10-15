"""JSON-only, stdlib entrypoint for the Harness document/database tools.

The two operation modules are maintained in the local-model project and copied
at a reviewed revision for packaging. This entrypoint never imports Hermes.
"""
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from docx_local_edit import inspect_docx, edit_docx, replace_docx, _run_mapping
from sqlite_local_ops import inspect, query, apply


def dispatch(request):
    operation, path = request['operation'], request['path']
    if operation == 'docx.inspect':
        return inspect_docx(path)
    if operation == 'docx.edit':
        return edit_docx(path, paragraph=request['paragraph'],
                         table=request.get('table'), row=request.get('row'), col=request.get('col'),
                         expect=request['expect'], run_texts=_run_mapping(json.dumps(request['runs'], ensure_ascii=False)))
    if operation == 'docx.replace':
        return replace_docx(path, paragraph=request['paragraph'], expect=request['expect'],
                            old_text=request['old_text'], new_text=request['new_text'],
                            table=request.get('table'), row=request.get('row'), col=request.get('col'))
    if operation == 'sqlite.inspect':
        return inspect(path)
    if operation == 'sqlite.query':
        return {'ok': True, 'results': query(path, request['queries'])}
    if operation == 'sqlite.apply':
        return apply(path, request['transactions'], request.get('queries', []))
    raise ValueError('Unknown local file operation')


if __name__ == '__main__':
    try:
        result = dispatch(json.load(sys.stdin))
    except Exception as error:
        result = {'ok': False, 'error': str(error), 'error_type': type(error).__name__}
    print(json.dumps(result, ensure_ascii=False, default=lambda value: {'blob_hex': value.hex()}))
    raise SystemExit(0 if result.get('ok') else 1)

"""Small SQLite inspector and parameterized transaction runner for local agents.

Transactions accept INSERT/UPDATE/DELETE/REPLACE, bound parameters, optional
expected row counts, and explicitly allowed business failures. Schema changes
remain ordinary terminal tasks. Existing files are never silently created.
"""
import argparse
import json
from pathlib import Path
import re
import sqlite3
import sys


class RowCountMismatch(ValueError):
    pass


def connect(path, mode):
    con = sqlite3.connect(Path(path).expanduser().resolve().as_uri() + '?mode=' + mode, uri=True)
    con.execute('PRAGMA foreign_keys=ON')
    return con


def operation(value, verbs):
    if not isinstance(value, dict) or not isinstance(value.get('sql'), str):
        raise ValueError('Each operation needs sql and optional params')
    sql = value['sql'].strip()
    if not sql or sql.split(None, 1)[0].upper() not in verbs:
        raise ValueError('Unsupported SQL operation for this command')
    params = value.get('params', [])
    if not isinstance(params, (list, dict)):
        raise ValueError('params must be an array or object')
    return sql, params


def read_operation(value):
    sql, params = operation(value, {'SELECT', 'WITH', 'PRAGMA'})
    if sql.split(None, 1)[0].upper() == 'PRAGMA':
        # SQLite uses PRAGMA for both inspection and mutation. Accept the
        # ordinary read-only forms without permitting assignment/setters.
        match = re.fullmatch(
            r'PRAGMA\s+(?:(?:main|temp)\.)?(\w+)\s*'
            r'(?:\(\s*(\w+|\"(?:[^\"]|\"\")*\"|\'(?:[^\']|\'\')*\')\s*\))?\s*;?',
            sql, re.I)
        no_argument = {'foreign_keys', 'database_list', 'user_version', 'schema_version'}
        table_argument = {'foreign_key_check', 'foreign_key_list', 'table_info',
                          'table_xinfo', 'index_list', 'index_info', 'index_xinfo',
                          'quick_check', 'integrity_check'}
        if (not match or match[1].lower() not in no_argument | table_argument
                or (match[1].lower() in no_argument and match[2] is not None)):
            raise ValueError('Only read-only schema and integrity PRAGMAs are supported')
    return sql, params


def inspect(path, queries=()):
    con = connect(path, 'ro')
    try:
        rows = con.execute("SELECT type,name,tbl_name,sql FROM sqlite_master "
                           "WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").fetchall()
        result = {'ok': True, 'schema': [dict(zip(('type','name','table','sql'), r)) for r in rows]}
    finally:
        con.close()
    if queries:
        try:
            result['results'] = query(path, queries)
        except (ValueError, sqlite3.Error, OverflowError) as exc:
            # A bad optional query must not discard the schema just obtained.
            result.update(ok=False, query_error=str(exc), error_type=type(exc).__name__)
    return result


def query(path, queries):
    if not isinstance(queries, (list, tuple)):
        raise ValueError('queries must be an array')
    prepared = [read_operation(q) for q in queries]
    con = connect(path, 'ro')
    try:
        results = []
        for sql, params in prepared:
            cursor = con.execute(sql, params)
            results.append({'columns': [c[0] for c in cursor.description], 'rows': cursor.fetchall()})
        return results
    finally:
        con.close()


def apply(path, transactions, readback=()):
    if not isinstance(transactions, list) or not transactions:
        raise ValueError('transactions must be a nonempty array')
    prepared = []
    for group in transactions:
        if not isinstance(group, dict) or not isinstance(group.get('statements'), list) or not group['statements']:
            raise ValueError('Each transaction needs nonempty statements')
        if type(group.get('allow_failure', False)) is not bool:
            raise ValueError('allow_failure must be boolean')
        statements = []
        for item in group['statements']:
            sql, params = operation(item, {'INSERT', 'UPDATE', 'DELETE', 'REPLACE'})
            expected = item.get('expect_rows')
            if expected is not None and (type(expected) is not int or expected < 0):
                raise ValueError('expect_rows must be a nonnegative integer')
            statements.append((sql, params, expected))
        prepared.append((group.get('allow_failure', False), statements))
    # Check query shape before any mutation; the read-only connection enforces
    # that a WITH statement cannot hide a write in the readback stage.
    if not isinstance(readback, (list, tuple)):
        raise ValueError('queries must be an array')
    for q in readback:
        read_operation(q)
    con = connect(path, 'rw')
    results = []; ok = True
    try:
        for index, (allow_failure, statements) in enumerate(prepared):
            counts = []
            try:
                con.execute('BEGIN')
                for sql, params, expected in statements:
                    cursor = con.execute(sql, params)
                    counts.append(cursor.rowcount)
                    if expected is not None and cursor.rowcount != expected:
                        raise RowCountMismatch(f'Expected {expected} row(s), got {cursor.rowcount}')
                con.commit()
                results.append({'index': index, 'status': 'committed', 'row_counts': counts})
            except (sqlite3.Error, RowCountMismatch, OverflowError) as exc:
                con.rollback()
                accepted = allow_failure and isinstance(exc, (sqlite3.IntegrityError, RowCountMismatch))
                results.append({'index': index, 'status': 'rolled_back', 'allowed_failure': accepted,
                                'reason': str(exc), 'error_type': type(exc).__name__})
                if not accepted:
                    ok = False
                    break
    finally:
        con.close()
    result = {'ok': ok, 'transactions': results,
              'not_attempted_transactions': len(prepared) - len(results)}
    try:
        result['readback'] = query(path, readback)
    except (ValueError, sqlite3.Error, OverflowError) as exc:
        # Preserve committed transaction receipts even if a SELECT is wrong.
        # Repeating already committed work would be unsafe.
        result.update(ok=False, readback_error=str(exc))
    return result


def database_request(payload):
    """Keep filenames and bound values in JSON instead of shell syntax."""
    if not isinstance(payload, dict) or payload.keys() - {'action', 'path', 'queries', 'transactions'}:
        raise ValueError('request must be an object with action, path, queries and/or transactions')
    action, path = payload.get('action'), payload.get('path')
    if action not in ('inspect', 'query', 'apply'):
        raise ValueError('action must be inspect, query or apply')
    if not isinstance(path, str) or not path:
        raise ValueError('path must be a nonempty string')
    queries = payload.get('queries', [])
    if action == 'inspect':
        return inspect(path, queries)
    if action == 'query':
        return {'ok': True, 'results': query(path, queries)}
    return apply(path, payload.get('transactions'), queries)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('inspect', 'query', 'apply', 'request'))
    parser.add_argument('path', nargs='?')
    parser.add_argument('--queries-json')
    parser.add_argument('--transactions-json')
    parser.add_argument('--request-stdin', action='store_true',
                        help='Read {queries, transactions} JSON from stdin; preserves quotes in bound values')
    args = parser.parse_args()
    try:
        if args.command == 'request':
            if args.path is not None or args.request_stdin or args.queries_json is not None or args.transactions_json is not None:
                raise ValueError('request reads the complete action/path payload from stdin only')
            result = database_request(json.load(sys.stdin))
        elif not args.path:
            raise ValueError('The legacy inspect/query/apply commands require a path')
        elif args.request_stdin:
            if args.queries_json is not None or args.transactions_json is not None:
                raise ValueError('Use stdin or JSON arguments, not both')
            payload = json.load(sys.stdin)
            if not isinstance(payload, dict) or payload.keys() - {'queries', 'transactions'}:
                raise ValueError('stdin must be an object with queries and/or transactions')
            queries = payload.get('queries', [])
            transactions = payload.get('transactions')
        elif args.command != 'request':
            queries = json.loads(args.queries_json or '[]')
            transactions = json.loads(args.transactions_json or 'null')
        if args.command == 'inspect':
            result = inspect(args.path, queries)
        elif args.command == 'query': result = {'ok': True, 'results': query(args.path, queries)}
        elif args.command == 'apply': result = apply(args.path, transactions, queries)
    except (ValueError, sqlite3.Error, OverflowError) as exc:
        result = {'ok': False, 'error_type': type(exc).__name__, 'error': str(exc)}
    print(json.dumps(result, ensure_ascii=False, default=lambda value: {'blob_hex': value.hex()}))
    raise SystemExit(0 if result['ok'] else 1)


if __name__ == '__main__': main()

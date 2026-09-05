import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";

test("Claude desktop file browser reads bounded project text and rejects traversal, secrets, and linked escapes", () => {
  const resources = join(process.cwd(), "resources", "viniper-ui");
  const tempRoot = join(process.cwd(), "codex", "运行残留", "r28-native-project-browser");
  const script = `import sys\nsys.path.insert(0, ${JSON.stringify(resources)})\n` + String.raw`
import json, os, subprocess, tempfile
from pathlib import Path
from native_project_browser import browse_project_files, preview_project_file, ProjectBrowserError
temp_root = Path(${JSON.stringify(tempRoot)})
temp_root.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(dir=temp_root) as temporary:
    fixture = Path(temporary)
    project = fixture / 'project'
    project.mkdir()
    (project / 'src').mkdir()
    (project / 'src' / 'main.py').write_bytes('print("你好")\n'.encode('utf-8'))
    (project / 'Readme.md').write_text('Project readme', encoding='utf-8')
    (project / 'legacy.txt').write_bytes('中文'.encode('gb18030'))
    (project / 'windows.txt').write_bytes('Unicode text'.encode('utf-16'))
    (project / 'picture.bin').write_bytes(b'\x00\x01binary')
    (project / 'large.txt').write_bytes(b'x' * 2048)
    (project / '.env').write_text('PRIVATE=fixture', encoding='utf-8')
    (project / '.env.example').write_text('EXAMPLE=placeholder', encoding='utf-8')
    (project / '.git').mkdir()
    (project / '.git' / 'config').write_text('PRIVATE', encoding='utf-8')
    (project / 'node_modules').mkdir()
    (project / 'node_modules' / 'huge.js').write_text('dependency', encoding='utf-8')
    outside = fixture / 'outside'
    outside.mkdir()
    (outside / 'secret.txt').write_text('OUTSIDE', encoding='utf-8')
    link = project / 'linked-outside'
    if os.name == 'nt':
        created = subprocess.run(['cmd.exe','/d','/c','mklink','/J',str(link),str(outside)], capture_output=True)
        assert created.returncode == 0, 'Windows junction fixture could not be created'
    else:
        link.symlink_to(outside, target_is_directory=True)
    listed = browse_project_files(project)
    assert listed['engine'] == 'desktop-file-browser'
    paths = {entry['path'] for entry in listed['entries']}
    assert 'src/main.py' in paths and 'Readme.md' in paths and '.env.example' in paths
    assert '.env' not in paths and not any('.git/' in item or 'node_modules/' in item or 'linked-outside/' in item for item in paths)
    search = browse_project_files(project, query='MAIN.PY')
    assert [item['path'] for item in search['entries']] == ['src/main.py']
    assert preview_project_file(project, 'src\\main.py')['content'] == 'print("你好")\n'
    assert preview_project_file(project, 'legacy.txt')['content'] == '中文'
    assert preview_project_file(project, 'windows.txt')['content'] == 'Unicode text'
    assert preview_project_file(project, 'picture.bin')['status'] == 'binary'
    assert preview_project_file(project, 'large.txt', max_bytes=1024)['status'] == 'too-large'
    assert browse_project_files(project, max_scan_entries=2)['scanned_entries'] <= 2
    assert browse_project_files(project, limit=1)['truncated'] is True
    for path in ('../outside/secret.txt', '..\\outside\\secret.txt', str(outside / 'secret.txt'), 'C:\\outside.txt', 'Readme.md:stream', '.env', '.git/config', 'node_modules/huge.js', 'linked-outside/secret.txt', 'src/../Readme.md'):
        try: preview_project_file(project, path)
        except ProjectBrowserError: pass
        else: raise AssertionError('Forbidden path was read: ' + path)
    try: browse_project_files(link)
    except ProjectBrowserError: pass
    else: raise AssertionError('Linked project root accepted')
    print(json.dumps({'browser': 'PASS', 'junctionOrSymlinkEscape': 'rejected', 'providerCalls': 0}))
`;
  const result = spawnSync(process.platform === "win32" ? "py" : "python3", [
    ...(process.platform === "win32" ? ["-3"] : []), "-E", "-c", script,
  ], { encoding: "utf8", timeout: 20_000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /"browser": "PASS"/u);
});

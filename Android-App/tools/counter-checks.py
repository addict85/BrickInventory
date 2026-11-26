#!/usr/bin/env python3
"""Measure counter-checks: every patch under counter-checks/ breaks something, and the
test class named in its header must then be RED. A test that was never red is unproven
(CLAUDE.md).

Header of a patch (before the first `diff --git`; git apply skips it):

    Gegenprobe: what gets broken
    Modul: core-data
    Test: ch.brickinventoryapp.data.StockMigrationTest
    Rot: part of the test name that must fail      (optional)

Red means: the class's test report exists and names a failure (with `Rot:` in exactly
that test). No report — e.g. because the patch does not compile — does NOT count as red.

    python3 tools/counter-checks.py counter-checks [name.patch …]
    python3 tools/counter-checks.py --check counter-checks

`--check` only verifies, without Gradle, that every patch still applies (`git apply
--check`) and that its header names an existing module and test class.
COUNTER_CHECK_GRADLE replaces the Gradle command (for the tool's own test).
COUNTER_CHECK_BASIS=<commit> measures only the patches whose target, test or patch
changed since that commit; none affected is a success. COUNTER_CHECK_TEIL=„2/4“ takes
every fourth patch from the second on. COUNTER_CHECK_RESULTS=<file> appends one JSON
line per measured patch, so a long local run can be resumed.
Exit 0 only if every check passed and there was at least one patch.
"""
import glob
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import xml.etree.ElementTree as ET

REQUIRED = ('Gegenprobe', 'Modul', 'Test')


def header(path):
    values = {}
    with open(path, encoding='utf-8') as f:
        for line in f:
            if line.startswith('diff --git') or line.startswith('--- '):
                break
            if ':' in line:
                name, value = line.split(':', 1)
                if name.strip() in REQUIRED + ('Rot',):
                    values[name.strip()] = value.strip()
    return values


def git(root, *args):
    return subprocess.run(['git', *args], cwd=root, capture_output=True, text=True)


def failures(report):
    """Names of the failed tests in the JUnit report."""
    tree = ET.parse(report).getroot()
    return [case.get('name', '') for case in tree.iter('testcase')
            if case.find('failure') is not None or case.find('error') is not None]


def test_task(project, module):
    # Pure JVM modules (core-model) have `test` instead of `testDebugUnitTest`.
    script = os.path.join(project, module, 'build.gradle.kts')
    text = open(script, encoding='utf-8').read() if os.path.exists(script) else ''
    return 'test' if 'kotlin.jvm' in text or 'jvm.library' in text else 'testDebugUnitTest'


def applies(root, patch):
    k = header(patch)
    name = os.path.basename(patch)
    missing = [p for p in REQUIRED if not k.get(p)]
    if missing:
        return False, f'{name}: im Kopf fehlt {", ".join(missing)}'
    result = git(root, 'apply', '--check', os.path.abspath(patch))
    if result.returncode != 0:
        return False, f'{name}: Patch passt nicht mehr auf den Stand — {result.stderr.strip()}'
    return True, ''


def check(project, root, patch):
    """Without Gradle: header complete, patch applies, module and test class exist."""
    ok, text = applies(root, patch)
    if not ok:
        return ok, text
    k = header(patch)
    name = os.path.basename(patch)
    if not os.path.isdir(os.path.join(project, k['Modul'])):
        return False, f'{name}: Modul {k["Modul"]} gibt es nicht'
    cls = k['Test'].rsplit('.', 1)[-1]
    if not glob.glob(os.path.join(project, k['Modul'], 'src', 'test*', '**', cls + '.kt'), recursive=True):
        return False, f'{name}: Testklasse {k["Test"]} gibt es in {k["Modul"]} nicht'
    return True, f'{name}: passt'


def measure(project, root, patch, gradle):
    ok, text = applies(root, patch)
    if not ok:
        return ok, text
    k = header(patch)
    name = os.path.basename(patch)
    cls = k['Test']
    task = test_task(project, k['Modul'])
    report = os.path.join(project, k['Modul'], 'build', 'test-results', task, f'TEST-{cls}.xml')
    if os.path.exists(report):
        os.remove(report)
    git(root, 'apply', os.path.abspath(patch))
    command = gradle + [f':{k["Modul"]}:{task}', '--rerun', '--tests', cls]
    try:
        run = subprocess.run(command, cwd=project, capture_output=True, text=True)
        # After a patch in an upstream module KSP sporadically loses its classes („… could
        # not be resolved“) or Hilt finds stale outputs („Attempt to recreate a file“) —
        # never in a fresh build. The Gradle plugin registry itself also drops out
        # sporadically. Retry once with empty KSP state; a real compile error stays.
        # Gradle remembers a missing plugin for 24 h, so that retry has to ask again.
        output = run.stdout + run.stderr
        plugin_missing = 'could not resolve plugin artifact' in output
        if not os.path.exists(report) and ('could not be resolved' in output
                                           or 'Attempt to recreate a file' in output
                                           or plugin_missing):
            for stale in glob.glob(os.path.join(project, '*', 'build', 'kspCaches')) + \
                    glob.glob(os.path.join(project, '*', 'build', 'generated', 'ksp')):
                shutil.rmtree(stale, ignore_errors=True)
            retry = command + ['--refresh-dependencies'] if plugin_missing else command
            run = subprocess.run(retry, cwd=project, capture_output=True, text=True)
    finally:
        back = git(root, 'apply', '-R', os.path.abspath(patch))
    if back.returncode != 0:
        return False, f'{name}: Patch liess sich nicht zurücknehmen — {back.stderr.strip()}'
    if not os.path.exists(report):
        lines = (run.stdout + run.stderr).splitlines()
        # The actual cause (compiler, KSP) stands far before Gradle's closing lines.
        cause = [z for z in lines if z.startswith(('e: ', 'w: [ksp]')) or '[ksp]' in z or 'error:' in z][:20]
        tail = '\n'.join(cause + lines[-15:])
        return False, f'{name}: kein Testbericht für {cls} — der Test lief nicht (übersetzt der Patch?)\n{tail}'.rstrip()
    red = failures(report)
    expected = k.get('Rot')
    if expected and not any(expected in t for t in red):
        return False, f'{name}: „{expected}“ blieb grün (rot: {red or "nichts"}) — {k["Gegenprobe"]}'
    if not red:
        return False, f'{name}: {cls} blieb grün — die Gegenprobe „{k["Gegenprobe"]}“ greift nicht'
    return True, f'{name}: rot wie verlangt ({", ".join(red)}) — {k["Gegenprobe"]}'


def affected(project, root, patches, basis):
    """The patches touching a file changed since `basis`; None if the base is unknown."""
    run = git(root, 'diff', '--name-only', basis, 'HEAD')
    if run.returncode != 0:
        return None
    changed = set(run.stdout.split())
    prefix = os.path.relpath(project, root).replace(os.sep, '/')
    # The test fixtures and this tool carry every counter-check.
    if any(p.startswith(prefix + '/core-testing/') or p == prefix + '/tools/counter-checks.py' for p in changed):
        return patches
    selection = []
    for patch in patches:
        with open(patch, encoding='utf-8') as f:
            targets = set(re.findall(r'^\+\+\+ b/(\S+)', f.read(), re.M))
        targets.add(os.path.relpath(os.path.abspath(patch), root).replace(os.sep, '/'))
        k = header(patch)
        cls = k.get('Test', '').rsplit('.', 1)[-1]
        if cls and k.get('Modul'):
            pattern = os.path.join(project, k['Modul'], 'src', 'test', '**', cls + '.kt')
            targets |= {os.path.relpath(t, root).replace(os.sep, '/') for t in glob.glob(pattern, recursive=True)}
        if targets & changed:
            selection.append(patch)
    return selection


def report_lines(results, title, ok_word):
    lines = [(ok_word if ok else 'FEHLT') + ' ' + text for ok, text in results]
    print('\n'.join(lines))
    summary = os.environ.get('GITHUB_STEP_SUMMARY')
    if summary:
        with open(summary, 'a', encoding='utf-8') as f:
            f.write(f'## {title}\n\n' + '\n'.join(f'- {z.splitlines()[0]}' for z in lines) + '\n')
    for ok, text in results:
        if not ok:
            print(f'::error title=Gegenprobe greift nicht::{text.splitlines()[0]}')


def main():
    args = sys.argv[1:]
    only_check = '--check' in args
    args = [a for a in args if a != '--check']
    folder = args[0] if args else 'counter-checks'
    names = set(args[1:])
    project = os.path.dirname(os.path.abspath(folder))
    root = git(project, 'rev-parse', '--show-toplevel').stdout.strip()
    patches = sorted(glob.glob(os.path.join(folder, '*.patch')))
    if names:
        patches = [p for p in patches if os.path.basename(p) in names]
    if not patches:
        print(f'Keine Gegenproben unter {folder}/ — ohne sie prüft dieser Schritt nichts.')
        return 1
    if only_check:
        results = [check(project, root, p) for p in patches]
        report_lines(results, 'Gegenproben passen', 'ok')
        bad = sum(1 for ok, _ in results if not ok)
        print(f'{len(results) - bad} von {len(results)} Gegenproben passen auf den Stand.')
        return 0 if not bad else 1
    # With a daemon: all patches of a part run in the same Gradle instead of restarting per patch.
    gradle = shlex.split(os.environ.get('COUNTER_CHECK_GRADLE', './gradlew --no-build-cache -Pksp.incremental=false'))
    basis = os.environ.get('COUNTER_CHECK_BASIS', '').strip()
    if basis:
        selection = affected(project, root, patches, basis)
        if selection is None:
            print(f'Basis {basis} unbekannt — alle {len(patches)} Gegenproben.')
        elif not selection:
            print(f'Keine der {len(patches)} Gegenproben berührt eine seit {basis[:12]} geänderte Datei.')
            return 0
        else:
            print(f'{len(selection)} von {len(patches)} Gegenproben betroffen.')
            patches = selection
    part = os.environ.get('COUNTER_CHECK_TEIL')
    if part:
        # CI splits the patches over parallel jobs; each takes every n-th, so every part
        # stays below its time limit.
        nr, count = (int(x) for x in part.split('/'))
        patches = patches[nr - 1::count]
        if not patches:
            print(f'Teil {part}: keine der betroffenen Gegenproben fällt auf diesen Teil.')
            return 0
    # One module after the other: the daemon keeps its compiled state between patches.
    patches.sort(key=lambda p: (header(p).get('Modul', ''), os.path.basename(p)))
    results_file = os.environ.get('COUNTER_CHECK_RESULTS')
    results = []
    for p in patches:
        ok, text = measure(project, root, p, gradle)
        results.append((ok, text))
        if results_file:
            with open(results_file, 'a', encoding='utf-8') as f:
                f.write(json.dumps({'patch': os.path.basename(p), 'red': ok, 'text': text}, ensure_ascii=False) + '\n')
    report_lines(results, 'Gegenproben', 'rot')
    return 0 if all(ok for ok, _ in results) else 1


if __name__ == '__main__':
    sys.exit(main())

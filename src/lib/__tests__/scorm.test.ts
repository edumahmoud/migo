import { describe, expect, test } from 'bun:test';
import { parseScormManifest, buildResourceTree, flattenResourceTree } from '../scorm-manifest';
import { mapLessonStatus12, parseScormTime, addTimes, cleanScore, formatClock } from '../scorm-runtime';
import { safeZipPath, signContentToken, verifyContentToken } from '../scorm-content';
import { createScorm12Api, createScorm2004Api } from '../scorm-api-adapter';

const MANIFEST = `<?xml version="1.0"?>
<manifest identifier="m1" xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2" xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2">
  <metadata><schema>ADL SCORM</schema><schemaversion>1.2</schemaversion></metadata>
  <organizations default="org1">
    <organization identifier="org1">
      <title>Course</title>
      <item identifier="mod1"><title>Module 1</title>
        <item identifier="l1" identifierref="r1"><title>Lesson 1</title></item>
        <item identifier="l2" identifierref="r2"><title>Lesson 2</title></item>
      </item>
      <item identifier="l3" identifierref="r3"/>
    </organization>
  </organizations>
  <resources>
    <resource identifier="r1" type="webcontent" adlcp:scormtype="sco" href="a/one.html"/>
    <resource identifier="r2" type="webcontent" adlcp:scormtype="sco" href="a/two.html"/>
    <resource identifier="r3" type="webcontent" adlcp:scormtype="sco" href="three.html"/>
  </resources>
</manifest>`;

describe('manifest parser', () => {
  const m = parseScormManifest(MANIFEST);
  test('keeps every item of a nested folder', () => {
    const ids = m.nodes.map(n => n.identifier);
    expect(ids).toContain('l1');
    expect(ids).toContain('l2');
    expect(ids).toContain('l3');
  });
  test('sets parents and folders', () => {
    const l1 = m.nodes.find(n => n.identifier === 'l1')!;
    const mod = m.nodes.find(n => n.identifier === 'mod1')!;
    expect(l1.parentIdentifier).toBe('mod1');
    expect(mod.scormType).toBe('organization');
    expect(l1.href).toBe('a/one.html');
  });
  test('handles a self-closing item', () => {
    expect(m.nodes.find(n => n.identifier === 'l3')!.href).toBe('three.html');
  });
  test('counts launchable items', () => {
    expect(m.totalLaunchable).toBe(3);
  });
});

describe('resource tree', () => {
  test('nests children and flattens with depth', () => {
    const rows = [
      { identifier: 'a', parent_identifier: null },
      { identifier: 'b', parent_identifier: 'a' },
      { identifier: 'c', parent_identifier: 'b' },
    ];
    const flat = flattenResourceTree(buildResourceTree(rows));
    expect(flat.map(r => [r.identifier, r.depth])).toEqual([['a', 0], ['b', 1], ['c', 2]]);
  });
  test('survives cycles and unknown parents', () => {
    const rows = [
      { identifier: 'x', parent_identifier: 'y' },
      { identifier: 'y', parent_identifier: 'x' },
      { identifier: 'z', parent_identifier: 'missing' },
    ];
    expect(flattenResourceTree(buildResourceTree(rows)).length).toBe(3);
  });
});

describe('runtime helpers', () => {
  test('maps 1.2 statuses', () => {
    expect(mapLessonStatus12('passed')).toEqual({ completion: 'completed', success: 'passed' });
    expect(mapLessonStatus12('failed').success).toBe('failed');
    expect(mapLessonStatus12('not attempted').completion).toBe('not_attempted');
  });
  test('parses and adds times', () => {
    expect(parseScormTime('0001:02:03.5')).toBe(3723.5);
    expect(parseScormTime('PT1H2M3S')).toBe(3723);
    expect(Number.isNaN(parseScormTime('junk'))).toBe(true);
    expect(addTimes('00:10:00', 'PT5M')).toBe('00:15:00');
    expect(formatClock(3661)).toBe('01:01:01');
  });
  test('cleans scores', () => {
    expect(cleanScore('85.555')).toBe(85.56);
    expect(cleanScore('abc')).toBeNull();
    expect(cleanScore('')).toBeNull();
  });
});

describe('content paths and tokens', () => {
  test('rejects traversal', () => {
    expect(safeZipPath(['..', 'etc'])).toBeNull();
    expect(safeZipPath('a/../../b')).toBeNull();
  });
  test('accepts normal paths', () => {
    expect(safeZipPath(['a', 'b.html'])).toBe('a/b.html');
  });
  test('signs and verifies tokens, rejects tampering and expiry', () => {
    const now = 1_000_000;
    const t = signContentToken({ p: 'pkg', u: 'user', e: now + 100, m: 0 }, 'k');
    expect(verifyContentToken(t, now, 'k')?.p).toBe('pkg');
    expect(verifyContentToken(t, now + 101, 'k')).toBeNull();
    expect(verifyContentToken(t, now, 'other')).toBeNull();
    expect(verifyContentToken('x' + t, now, 'k')).toBeNull();
  });
});

describe('SCORM 1.2 engine', () => {
  test('init, set status/score, commit, finish', () => {
    const commits: boolean[] = [];
    const api = createScorm12Api({}, { onCommit: (_s, final) => commits.push(final) });
    expect(api.LMSInitialize('')).toBe('true');
    expect(api.LMSSetValue('cmi.core.lesson_status', 'passed')).toBe('true');
    expect(api.LMSSetValue('cmi.core.score.raw', '90')).toBe('true');
    expect(api.LMSGetValue('cmi.core.lesson_status')).toBe('passed');
    expect(api.LMSSetValue('cmi.core.lesson_status', 'bogus')).toBe('false');
    expect(api.LMSGetLastError()).toBe('405');
    expect(api.LMSSetValue('cmi.core.student_id', 'x')).toBe('false');
    expect(api.LMSGetLastError()).toBe('403');
    expect(api.LMSCommit('')).toBe('true');
    expect(api.LMSFinish('')).toBe('true');
    expect(commits).toEqual([false, true]);
  });
  test('refuses calls before init', () => {
    const api = createScorm12Api({});
    expect(api.LMSGetValue('cmi.core.lesson_status')).toBe('');
    expect(api.LMSGetLastError()).toBe('301');
  });
});

describe('SCORM 2004 engine', () => {
  test('init, set values, terminate', () => {
    const api = createScorm2004Api({});
    expect(api.Initialize('')).toBe('true');
    expect(api.SetValue('cmi.completion_status', 'completed')).toBe('true');
    expect(api.GetValue('cmi.completion_status')).toBe('completed');
    expect(api.Commit('')).toBe('true');
    expect(api.Terminate('')).toBe('true');
  });
});

describe('sandbox shim bundle (public/scorm-shim.js)', () => {
  test('installs a working SCORM 1.2 API and reports to the parent', async () => {
    const { readFileSync } = await import('node:fs');
    const code = readFileSync(new URL('../../../public/scorm-shim.js', import.meta.url), 'utf8');
    const messages: Array<{ source: string; type: string; final: boolean; snapshot: { lesson_status?: string } }> = [];
    const fakeWindow: Record<string, unknown> = {
      __SCORM_BOOT: { version: '1.2', cmi: { cmi_core_lesson_status: 'incomplete' } },
      parent: { postMessage: (m: (typeof messages)[number]) => messages.push(m) },
    };
    new Function('window', code)(fakeWindow);
    const api = fakeWindow.API as Record<string, (...a: string[]) => string>;
    expect(api.LMSInitialize('')).toBe('true');
    expect(api.LMSGetValue('cmi.core.lesson_status')).toBe('incomplete');
    api.LMSSetValue('cmi.core.lesson_status', 'passed');
    api.LMSFinish('');
    expect(messages.some(m => m.source === 'scorm-shim' && m.type === 'commit' && m.final && m.snapshot.lesson_status === 'passed')).toBe(true);
  });
});

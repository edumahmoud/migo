import { describe, test, expect, beforeEach } from 'bun:test';
import {
  NavigationHistory,
  type NavigationHistoryAdapter,
} from '../navigation-history';

/**
 * In-memory history stack that behaves like the browser's joint session
 * history in a fresh PWA launch: the app starts as the first (and only)
 * entry, replaceState overwrites the current entry, pushState truncates
 * forward entries, and both user backs and programmatic back() deliver a
 * popstate through the wired callback. Pressing back on the first entry
 * makes the platform leave the app ('exit').
 */
class FakeHistory implements NavigationHistoryAdapter {
  entries: unknown[] = [{ app: 'initial' }];
  current = 0;
  onPop: ((state: unknown) => void) | null = null;

  replaceState(state: unknown): void {
    this.entries[this.current] = state;
  }

  pushState(state: unknown): void {
    this.entries.length = this.current + 1;
    this.entries.push(state);
    this.current += 1;
  }

  /** Programmatic back (used by the core for guard transparency). */
  back(): void {
    if (this.current === 0) return;
    this.current -= 1;
    this.onPop?.(this.entries[this.current]);
  }

  /**
   * Simulate the user pressing the system back button.
   * Returns 'exit' when the platform would leave the app (first entry).
   */
  userBack(): 'exit' | 'navigated' {
    if (this.current === 0) return 'exit';
    this.current -= 1;
    this.onPop?.(this.entries[this.current]);
    return 'navigated';
  }

  currentState(): unknown {
    return this.entries[this.current];
  }
}

function makeCore(history: FakeHistory) {
  const restored: string[] = [];
  let warnings = 0;
  let rearmFn: (() => void) | null = null;
  const core = new NavigationHistory({
    adapter: history,
    onRestore: (snap) => restored.push(snap),
    onExitWarning: () => {
      warnings += 1;
    },
    schedule: (fn) => {
      rearmFn = fn;
      return () => {
        rearmFn = null;
      };
    },
  });
  history.onPop = (state) => core.handlePop(state);
  // Access through the object: destructuring a getter would freeze its value.
  return {
    core,
    restored,
    get warnings() {
      return warnings;
    },
    fireRearm() {
      rearmFn?.();
    },
    hasRearm: () => rearmFn !== null,
  };
}

const GUARD = { __attendoGuard: true };

describe('NavigationHistory', () => {
  let history: FakeHistory;
  let h: ReturnType<typeof makeCore>;

  beforeEach(() => {
    history = new FakeHistory();
    h = makeCore(history);
  });

  test('start anchors the current entry and arms a guard on top', () => {
    h.core.start('root');
    expect(history.entries.length).toBe(2); // root (replaced initial), guard
    expect(history.entries[0]).toEqual({ __attendoNav: true, i: 0 });
    expect(history.entries[1]).toEqual(GUARD);
    expect(history.current).toBe(1);
  });

  test('first back at root warns instead of exiting; second back exits', () => {
    h.core.start('root');

    expect(history.userBack()).toBe('navigated'); // pops the guard onto root
    expect(h.warnings).toBe(1);
    expect(h.restored).toEqual([]);
    expect(history.current).toBe(0); // now on the first (root) entry

    // Second back within the window: no guard in the way, platform exits.
    expect(history.userBack()).toBe('exit');
    expect(h.warnings).toBe(1); // no second warning
  });

  test('guard re-arms after the exit window', () => {
    h.core.start('root');
    history.userBack(); // warning, guard popped
    h.fireRearm(); // window expired
    expect(history.currentState()).toEqual(GUARD);
    expect(history.current).toBe(1);
  });

  test('navigation from a guarded root converts the guard (no dead entry)', () => {
    h.core.start('root');
    h.core.navigate('a');
    expect(history.entries.length).toBe(2); // root, a (guard replaced)
    expect(history.currentState()).toEqual({ __attendoNav: true, i: 1 });
    h.core.navigate('b');
    expect(history.entries.length).toBe(3);
    expect(history.currentState()).toEqual({ __attendoNav: true, i: 2 });
  });

  test('back steps through locations and restores their snapshots', () => {
    h.core.start('root');
    h.core.navigate('a');
    h.core.navigate('b');

    history.userBack(); // b -> a
    expect(h.restored).toEqual(['a']);
    history.userBack(); // a -> root
    expect(h.restored).toEqual(['a', 'root']);
    // Root got guarded again: one more back warns, does not exit.
    expect(history.currentState()).toEqual(GUARD);
  });

  test('after returning to root, first back warns and does not restore', () => {
    h.core.start('root');
    h.core.navigate('a');
    history.userBack(); // back to root, guard armed
    expect(h.restored).toEqual(['root']);

    history.userBack(); // pops the guard: warn, stay
    expect(h.warnings).toBe(1);
    expect(h.restored).toEqual(['root']);
  });

  test('navigating with the current snapshot is a no-op (restore echo)', () => {
    h.core.start('root');
    h.core.navigate('a');
    const before = history.entries.length;
    h.core.navigate('a'); // e.g. the restore echo of the current location
    expect(history.entries.length).toBe(before);
    expect(history.currentState()).toEqual({ __attendoNav: true, i: 1 });
  });

  test('in-app navigation while the exit window is armed cancels the re-arm', () => {
    h.core.start('root');
    history.userBack(); // warning armed, guard popped
    expect(h.hasRearm()).toBe(true);
    h.core.navigate('a');
    expect(h.hasRearm()).toBe(false);
    // Current entry is the new location; back goes to a guarded root.
    expect(history.currentState()).toEqual({ __attendoNav: true, i: 1 });
    history.userBack();
    expect(h.restored).toEqual(['root']);
    expect(history.currentState()).toEqual(GUARD);
  });

  test('a buried guard entry is transparent (steps through it)', () => {
    h.core.start('root'); // [root, guard]
    // Stale entry of ours above the guard (e.g. left over from a reload):
    history.pushState({ __attendoNav: true, i: 1 });
    history.userBack(); // lands on the buried guard -> steps back to root
    // Root was already the tracker's location: this reads as a back press
    // at the root, so it warns (never exits silently) and re-arms.
    expect(h.restored).toEqual([]);
    expect(h.warnings).toBe(1);
    expect(history.current).toBe(0);
    h.fireRearm();
    expect(history.currentState()).toEqual(GUARD);
  });

  test('foreign history entries are ignored', () => {
    h.core.start('root');
    h.core.navigate('a');
    h.core.handlePop(null);
    h.core.handlePop({ something: 'else' });
    expect(h.restored).toEqual([]);
    expect(h.warnings).toBe(0);
    expect(history.currentState()).toEqual({ __attendoNav: true, i: 1 });
  });

  test('stop prevents further handling', () => {
    h.core.start('root');
    h.core.stop();
    h.core.navigate('a');
    h.core.handlePop({ __attendoNav: true, i: 0 });
    expect(h.restored).toEqual([]);
    expect(h.warnings).toBe(0);
    expect(history.entries.length).toBe(2); // unchanged after stop
  });
});

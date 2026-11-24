import { describe, test, expect, beforeEach } from 'bun:test';
import {
  NavigationHistory,
  type NavigationHistoryAdapter,
} from '../navigation-history';

/**
 * In-memory history stack that behaves like the browser's joint session
 * history: one entry before the app (E0), replaceState overwrites the current
 * entry, pushState truncates forward entries, and both user backs and
 * programmatic back() deliver a popstate through the wired callback.
 */
class FakeHistory implements NavigationHistoryAdapter {
  entries: unknown[] = [{ external: true }];
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

describe('NavigationHistory', () => {
  let history: FakeHistory;

  beforeEach(() => {
    history = new FakeHistory();
  });

  test('start anchors the current entry and arms a guard on top', () => {
    const { core } = makeCore(history);
    core.start('root');
    expect(history.entries.length).toBe(3); // E0, root, guard
    expect(history.entries[1]).toEqual({ __attendoNav: true, i: 0 });
    expect(history.entries[2]).toEqual({ __attendoGuard: true });
    expect(history.current).toBe(2);
  });

  test('first back at root warns instead of exiting; second back exits', () => {
    const { core, warnings, restored } = makeCore(history);
    core.start('root');

    expect(history.userBack()).toBe('navigated'); // pops the guard onto root
    expect(warnings).toBe(1);
    expect(restored).toEqual([]);
    expect(history.current).toBe(1); // now on the first app entry

    // Second back within the window: no guard in the way, platform exits.
    expect(history.userBack()).toBe('navigated'); // lands on E0 (foreign)
    expect(warnings).toBe(1); // no second warning
    expect(history.current).toBe(0);
  });

  test('guard re-arms after the exit window', () => {
    const { core, fireRearm } = makeCore(history);
    core.start('root');
    history.userBack(); // warning, guard popped
    fireRearm(); // window expired
    expect(history.currentState()).toEqual({ __attendoGuard: true });
    expect(history.current).toBe(2);
  });

  test('navigation from a guarded root converts the guard (no dead entry)', () => {
    const { core } = makeCore(history);
    core.start('root');
    core.navigate('a');
    expect(history.entries.length).toBe(3); // E0, root, a (guard replaced)
    expect(history.currentState()).toEqual({ __attendoNav: true, i: 1 });
    core.navigate('b');
    expect(history.entries.length).toBe(4);
    expect(history.currentState()).toEqual({ __attendoNav: true, i: 2 });
  });

  test('back steps through locations and restores their snapshots', () => {
    const { core, restored } = makeCore(history);
    core.start('root');
    core.navigate('a');
    core.navigate('b');

    history.userBack(); // b -> a
    expect(restored).toEqual(['a']);
    history.userBack(); // a -> root
    expect(restored).toEqual(['a', 'root']);
    // Root got guarded again: one more back warns, does not exit.
    expect(history.currentState()).toEqual({ __attendoGuard: true });
  });

  test('after returning to root, first back warns and does not restore', () => {
    const { core, restored, warnings } = makeCore(history);
    core.start('root');
    core.navigate('a');
    history.userBack(); // back to root, guard armed
    expect(restored).toEqual(['root']);

    history.userBack(); // pops the guard: warn, stay
    expect(warnings).toBe(1);
    expect(restored).toEqual(['root']);
  });

  test('navigating with the current snapshot is a no-op (restore echo)', () => {
    const { core } = makeCore(history);
    core.start('root');
    core.navigate('a');
    const before = history.entries.length;
    core.navigate('a'); // e.g. the restore echo of the current location
    expect(history.entries.length).toBe(before);
    expect(history.currentState()).toEqual({ __attendoNav: true, i: 1 });
  });

  test('in-app navigation while the exit window is armed cancels the re-arm', () => {
    const { core, hasRearm } = makeCore(history);
    core.start('root');
    history.userBack(); // warning armed, guard popped
    expect(hasRearm()).toBe(true);
    core.navigate('a');
    expect(hasRearm()).toBe(false);
    // Current entry is the new location (guard slot replaced), back goes to root.
    expect(history.currentState()).toEqual({ __attendoNav: true, i: 1 });
    history.userBack();
    expect(history.currentState()).toEqual({ __attendoGuard: true });
  });

  test('a buried guard entry is transparent (steps through it)', () => {
    const { core, restored } = makeCore(history);
    core.start('root');
    core.navigate('a');
    // Craft an impossible-in-practice buried guard above 'a' and land on it.
    history.pushState({ __attendoGuard: true });
    history.userBack(); // lands on the buried guard -> core steps back again
    expect(restored).toEqual(['root']);
    expect(history.current).toBe(1); // root entry
  });

  test('foreign history entries are ignored', () => {
    const { core, restored, warnings } = makeCore(history);
    core.start('root');
    core.navigate('a');
    core.handlePop(null);
    core.handlePop({ something: 'else' });
    expect(restored).toEqual([]);
    expect(warnings).toBe(0);
    expect(history.currentState()).toEqual({ __attendoNav: true, i: 1 });
  });

  test('stop prevents further handling', () => {
    const { core, restored, warnings } = makeCore(history);
    core.start('root');
    core.stop();
    core.navigate('a');
    core.handlePop({ __attendoNav: true, i: 0 });
    expect(restored).toEqual([]);
    expect(warnings).toBe(0);
    expect(history.entries.length).toBe(3); // unchanged after stop
  });
});

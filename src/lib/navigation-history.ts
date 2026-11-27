/**
 * Navigation history for the single-page dashboard shell.
 *
 * The whole app lives on one URL ('/'); "pages" and sections are client-side
 * state, so the browser history stack has a single entry and the system back
 * button (Android / installed PWA) exits the app instead of going back to the
 * previous screen. This module keeps a logical navigation stack mirrored onto
 * the real history stack:
 *
 * - Every logical location change records a history entry carrying its index.
 * - A popstate targeting an older entry restores that location instead of
 *   leaving the app.
 * - At the root location a "guard" entry sits on top of the stack. The first
 *   back press pops the guard (staying in the app) and asks the UI to warn
 *   ("press back again to exit"); a second press within the window leaves the
 *   app through the platform's default behavior. Once the window expires the
 *   guard is re-armed.
 *
 * The module is DOM-free: the caller supplies a NavigationHistoryAdapter, so
 * the logic is unit-testable without a browser.
 */

export interface NavigationHistoryAdapter {
  replaceState(state: unknown): void;
  pushState(state: unknown): void;
  back(): void;
}

export interface NavigationHistoryOptions {
  adapter: NavigationHistoryAdapter;
  /** Called with the serialized snapshot of the location to restore. */
  onRestore: (snapshot: string) => void;
  /** Called when the user presses back while on the root location. */
  onExitWarning: () => void;
  /** Window (ms) during which a second back press exits. Default 2500. */
  exitWindowMs?: number;
  now?: () => number;
  /**
   * Native exit (Capacitor App.exitApp). When given, the second back press
   * inside the window calls it instead of relying on the WebView's own history
   * (which can hold earlier pages from login, so a plain back would not leave).
   */
  exit?: () => void;
  /** setTimeout-like; must return a cancel function. */
  schedule?: (fn: () => void, ms: number) => () => void;
}

interface NavEntryState {
  __attendoNav: true;
  i: number;
}

interface GuardEntryState {
  __attendoGuard: true;
}

function isNavState(state: unknown): state is NavEntryState {
  return (
    !!state &&
    typeof state === 'object' &&
    (state as NavEntryState).__attendoNav === true &&
    typeof (state as NavEntryState).i === 'number'
  );
}

function isGuardState(state: unknown): state is GuardEntryState {
  return !!state && typeof state === 'object' && (state as GuardEntryState).__attendoGuard === true;
}

const DEFAULT_EXIT_WINDOW_MS = 2500;

export class NavigationHistory {
  private readonly adapter: NavigationHistoryAdapter;
  private readonly onRestore: (snapshot: string) => void;
  private readonly onExitWarning: () => void;
  private readonly exitWindowMs: number;
  private readonly exitFn?: () => void;
  private readonly nowFn: () => number;
  private lastWarnAt = 0;
  private readonly scheduleFn: (fn: () => void, ms: number) => () => void;

  private stack: string[] = [];
  private index = 0;
  private topIsGuard = false;
  private cancelGuardRearm: (() => void) | null = null;
  private started = false;

  constructor(options: NavigationHistoryOptions) {
    this.adapter = options.adapter;
    this.onRestore = options.onRestore;
    this.onExitWarning = options.onExitWarning;
    this.exitWindowMs = options.exitWindowMs ?? DEFAULT_EXIT_WINDOW_MS;
    this.exitFn = options.exit;
    this.nowFn = options.now ?? (() => Date.now());
    const schedule = options.schedule;
    this.scheduleFn =
      schedule ??
      ((fn, ms) => {
        const id = setTimeout(fn, ms);
        return () => clearTimeout(id);
      });
  }

  /** Anchor the tracker on the current history entry and arm the root guard. */
  start(initialSnapshot: string): void {
    if (this.started) return;
    this.started = true;
    this.stack = [initialSnapshot];
    this.index = 0;
    this.adapter.replaceState({ __attendoNav: true, i: 0 } satisfies NavEntryState);
    this.pushGuard();
  }

  /** The current logical location changed (in-app navigation). */
  navigate(snapshot: string): void {
    if (!this.started) return;
    if (snapshot === this.stack[this.index]) return;
    // Real navigation cancels a pending guard re-arm.
    this.cancelGuardRearm?.();
    this.cancelGuardRearm = null;
    this.index += 1;
    this.stack.length = this.index;
    this.stack[this.index] = snapshot;
    const state: NavEntryState = { __attendoNav: true, i: this.index };
    if (this.topIsGuard) {
      // The guard is the current top entry: turn it into the new location so
      // no dead guard entry is left buried in the stack.
      this.adapter.replaceState(state);
      this.topIsGuard = false;
    } else {
      this.adapter.pushState(state);
    }
  }

  /**
   * Handle a popstate event. `state` is the state of the history entry the
   * user landed on.
   */
  handlePop(state: unknown): void {
    if (!this.started) return;
    if (isGuardState(state)) {
      // A guard entry below the top (shouldn't normally happen — guards are
      // converted on navigation — but stay safe): treat it as transparent
      // and keep moving back. The popstate from this programmatic back is
      // handled normally, restoring whatever location it lands on.
      this.adapter.back();
      return;
    }
    if (!isNavState(state)) {
      // An entry we didn't create (e.g. the page that opened the app in a
      // browser tab). Leave the platform's default behavior alone.
      return;
    }
    this.topIsGuard = false;
    if (state.i === this.index) {
      // The guard above the current (root) location was popped: the user
      // pressed back at the root. Warn once; a second press within the
      // window exits through the platform's default behavior (the current
      // entry is now the first one, so back leaves the app). When the
      // window expires, re-arm the guard.
      if (this.exitFn && this.lastWarnAt > 0 && this.nowFn() - this.lastWarnAt < this.exitWindowMs) {
        // Second press inside the window: leave natively. Keep a guard in place
        // in case the platform refuses, so back never lands on a stale page.
        this.lastWarnAt = 0;
        this.pushGuard();
        this.exitFn();
        return;
      }
      this.lastWarnAt = this.nowFn();
      this.onExitWarning();
      if (this.exitFn) {
        // Native exit available: keep the guard so the second press is seen here.
        this.pushGuard();
        return;
      }
      this.cancelGuardRearm?.();
      this.cancelGuardRearm = this.scheduleFn(() => {
        this.cancelGuardRearm = null;
        if (this.started && this.index === 0 && !this.topIsGuard) {
          this.pushGuard();
        }
      }, this.exitWindowMs);
      return;
    }
    this.index = state.i;
    this.onRestore(this.stack[state.i]);
    if (this.index === 0) {
      // Returned to the root: guard it so the next back warns instead of
      // exiting immediately.
      this.pushGuard();
    }
  }

  /** Stop tracking (e.g. signed out). History entries already written stay. */
  stop(): void {
    this.started = false;
    this.cancelGuardRearm?.();
    this.cancelGuardRearm = null;
  }

  private pushGuard(): void {
    this.adapter.pushState({ __attendoGuard: true } satisfies GuardEntryState);
    this.topIsGuard = true;
  }
}

import type { ErrorEvent } from '@sentry/nextjs';

// Errors only. Never send request bodies, headers, cookies, user identities,
// console breadcrumbs, AI prompts, payment details or arbitrary error messages.
export function scrubErrorEvent(event: ErrorEvent): ErrorEvent {
  delete event.user;
  delete event.request;
  delete event.extra;
  delete event.contexts;
  delete event.breadcrumbs;
  delete event.message;
  delete event.logentry;
  delete event.transaction;
  event.tags = { source: 'attendo' };
  for (const exception of event.exception?.values ?? []) {
    exception.value = 'Application error (details withheld for privacy)';
    exception.type = 'Error';
    delete exception.mechanism;
    if (exception.stacktrace) {
      exception.stacktrace.frames = exception.stacktrace.frames?.map(frame => ({
        filename: frame.filename?.split(/[?#]/)[0],
        function: frame.function,
        lineno: frame.lineno,
        colno: frame.colno,
        in_app: frame.in_app,
      }));
    }
  }
  return event;
}

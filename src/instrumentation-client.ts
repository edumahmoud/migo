import * as Sentry from '@sentry/nextjs';
import { scrubErrorEvent } from './lib/error-monitoring';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
  sendDefaultPii: false,
  defaultIntegrations: false,
  integrations: [Sentry.globalHandlersIntegration(), Sentry.dedupeIntegration()],
  tracesSampleRate: 0,
  beforeSend: scrubErrorEvent,
});

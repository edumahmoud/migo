'use client';

/**
 * ThemeSettingsButton — v134n
 *
 * Small button shown next to ThemeToggle in the app header.
 * Opens the ThemeSettingsPanel modal where the user can pick
 * their color identity (8 options) and mode (light/dark/system).
 */

import { useState } from 'react';
import { Palette } from 'lucide-react';
import ThemeSettingsPanel from '@/components/shared/theme-settings-panel';

export default function ThemeSettingsButton() {
  const [opened, setOpened] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpened(true)}
        className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-muted/50 active:bg-muted/80 transition-colors"
        title="إعدادات المظهر"
        aria-label="إعدادات المظهر"
      >
        <Palette className="h-4 w-4 text-muted-foreground" />
        المظهر
      </button>
      <ThemeSettingsPanel opened={opened} onClose={() => setOpened(false)} />
    </>
  );
}

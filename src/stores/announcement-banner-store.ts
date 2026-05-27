import { create } from 'zustand';

/**
 * Tiny store to communicate the active banner announcement height
 * from PlatformAnnouncementPopup (which renders the banner) to the
 * dashboard <main> elements (which need extra top margin so the
 * banner doesn't overlap content).
 *
 * When the banner is visible, each dashboard's <main> adds the
 * reported height as extra margin-top. When dismissed, the margin
 * animates back to 0 via CSS transition for a smooth slide-up.
 */
interface AnnouncementBannerState {
  /** Pixels of the currently visible banner. 0 = no banner. */
  bannerHeight: number;
  /** Set by the BannerDisplay component on mount / resize / unmount. */
  setBannerHeight: (height: number) => void;
}

export const useAnnouncementBannerStore = create<AnnouncementBannerState>((set) => ({
  bannerHeight: 0,
  setBannerHeight: (height) => set({ bannerHeight: height }),
}));

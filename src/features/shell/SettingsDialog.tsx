import { Dialog } from "@base-ui/react/dialog";
import { Tabs } from "@base-ui/react/tabs";
import { useCallback, useEffect, useState } from "react";
import { revealMainLog } from "../../ipc";
import { LastfmSettings } from "../lastfm/LastfmSettings";
import { LibraryFolderSettings } from "../library/LibraryFolderSettings";
import { WatchFolderSettings } from "../library/WatchFolderSettings";
import { useDynamicBackgroundStore } from "./dynamicBackgroundStore";
import { useLookupStore } from "./lookupStore";
import { report } from "./statusStore";
import { THEME_LABELS, THEME_PREFERENCES, type ThemePreference } from "./theme";
import { useThemeStore } from "./themeStore";
import { formatZoom, MAX_ZOOM, MIN_ZOOM } from "./zoom";
import { useZoomStore } from "./zoomStore";

export type SettingsCategory = "appearance" | "library" | "online" | "about";

const CATEGORIES: { value: SettingsCategory; label: string }[] = [
  { value: "appearance", label: "Appearance" },
  { value: "library", label: "Library" },
  { value: "online", label: "Online" },
  { value: "about", label: "About" },
];

/**
 * Settings, reachable from Edit ▸ Settings… and, opened on Online, from
 * Account ▸ Connect to last.fm…
 *
 * `Dialog` rather than `AlertDialog`: nothing here is a decision that cannot be
 * taken back, so clicking the backdrop to leave is the right way out. The
 * opposite choice - and the reason it is worth stating - is the crash notice,
 * which is an `AlertDialog` precisely because it must be acknowledged.
 *
 * A rail of categories beside the one that is open, in order of how far each
 * reaches: how the app looks, what it does to the library on its own, what
 * leaves the machine, and the one row that is not a preference at all. The
 * popup is the `Tabs.Root` so that the rail and the open panel can both be its
 * direct children - the panel is the paned dialog's `.modal-body`, and only
 * one is mounted at a time, so switching category starts it at the top.
 *
 * Interface zoom is the same control the status bar carries, deliberately: the
 * design puts Settings in the Edit menu and the stepper in the corner, and both
 * write the same store. A setting reachable two ways is not a setting
 * duplicated. last.fm is reachable twice on the same terms - the Account menu
 * names the connected user and disconnects in one click, and sends Connect
 * here, where there is room to say what a scrobble carries.
 *
 * The one piece of state held here rather than inside a section is the folder
 * the Library folder and music folder sections have to agree about - the root
 * is a watch folder that cannot be removed while the filing is on, and a value
 * two siblings read has to come from above them.
 */
export function SettingsDialog({
  category = "appearance",
  onClose,
}: {
  /** Where it opens; it is remounted on every open, so this is read once. */
  category?: SettingsCategory;
  onClose: () => void;
}) {
  const factor = useZoomStore((s) => s.factor);
  const step = useZoomStore((s) => s.step);
  const themePreference = useThemeStore((s) => s.preference);
  const setTheme = useThemeStore((s) => s.set);
  const dynamicBackground = useDynamicBackgroundStore((s) => s.enabled);
  const setDynamicBackground = useDynamicBackgroundStore((s) => s.set);
  const unattendedLookup = useLookupStore((s) => s.enabled);
  const setUnattendedLookup = useLookupStore((s) => s.set);
  const loadUnattendedLookup = useLookupStore((s) => s.load);
  const [lockedRoot, setLockedRoot] = useState<string | null>(null);
  // Stable, so the section below does not re-read the folder on every render
  // of this dialog.
  const lock = useCallback((root: string | null) => setLockedRoot(root), []);

  // Read here rather than at startup: nothing outside this dialog draws from
  // it, and the backend reads the setting itself between releases. The dialog
  // is mounted only while it is open, so this runs each time it is opened.
  useEffect(() => {
    void loadUnattendedLookup();
  }, [loadUnattendedLookup]);

  // Reported on the status bar rather than in the dialog: the failure is a
  // file manager that would not open, which is neither about the log nor
  // worth a line of its own inside Settings.
  const showLog = async () => {
    try {
      await revealMainLog();
    } catch (cause) {
      report(cause);
    }
  };

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="modal-backdrop" />
        <Dialog.Popup
          className="modal paned settings"
          render={<Tabs.Root orientation="vertical" defaultValue={category} />}
        >
          {/* biome-ignore lint/a11y/useHeadingContent: the heading's content is this component's children, which Base UI puts inside the rendered <h2> - the rule only sees the empty element literal. */}
          <Dialog.Title render={<h2 />}>Settings</Dialog.Title>

          <Tabs.List className="settings-rail">
            {CATEGORIES.map(({ value, label }) => (
              <Tabs.Tab key={value} value={value} className="settings-tab">
                {label}
              </Tabs.Tab>
            ))}
          </Tabs.List>

          <Tabs.Panel value="appearance" className="modal-body settings-pane">
            <h3>Appearance</h3>

            <div className="settings-row">
              <span>Interface Zoom</span>
              {/* No group label: each button already says what it does, and a
                  plain span cannot carry one without inventing a role for it. */}
              <span className="statusbar-zoom">
                <button
                  type="button"
                  aria-label="Zoom out"
                  disabled={factor <= MIN_ZOOM}
                  onClick={() => void step(-1)}
                >
                  −
                </button>
                <span className="statusbar-zoom-value" aria-live="polite">
                  {formatZoom(factor)}
                </span>
                <button
                  type="button"
                  aria-label="Zoom in"
                  disabled={factor >= MAX_ZOOM}
                  onClick={() => void step(1)}
                >
                  +
                </button>
              </span>
            </div>

            {/* Three values rather than a switch, because "System" is one of
                them: a two-state control could not say "follow the OS" and
                would have no way back to it once touched. Native `<select>`,
                like the smart-playlist editor's - the design's own Select is
                still ahead of us. */}
            <div className="settings-row">
              <label htmlFor="theme">Theme</label>
              <select
                id="theme"
                value={themePreference}
                onChange={(event) => void setTheme(event.target.value as ThemePreference)}
              >
                {THEME_PREFERENCES.map((preference) => (
                  <option key={preference} value={preference}>
                    {THEME_LABELS[preference]}
                  </option>
                ))}
              </select>
            </div>

            {/* A native checkbox rather than a Base UI switch: it is a plain
                on/off preference in a dialog, which is what the platform
                control is for, and `<label>` gives it its own hit target and
                name without a `role` or an `aria-label`. */}
            <div className="settings-row">
              <label htmlFor="dynamic-background">Colour From Album Art</label>
              <input
                id="dynamic-background"
                type="checkbox"
                checked={dynamicBackground}
                onChange={(event) => void setDynamicBackground(event.target.checked)}
              />
            </div>
          </Tabs.Panel>

          <Tabs.Panel value="library" className="modal-body settings-pane">
            <h3>Library</h3>
            <LibraryFolderSettings onLockChange={lock} />
            <WatchFolderSettings lockedRoot={lockedRoot} />
          </Tabs.Panel>

          {/* The lookup is here rather than under Library, beside the other
              things the app does to the library unasked, because it is the one
              of them that also leaves the machine. */}
          <Tabs.Panel value="online" className="modal-body settings-pane">
            <h3>Online</h3>
            <div className="settings-row">
              <label htmlFor="unattended-lookup">Look Up Releases Online</label>
              <input
                id="unattended-lookup"
                type="checkbox"
                checked={unattendedLookup}
                onChange={(event) => void setUnattendedLookup(event.target.checked)}
              />
            </div>
            <LastfmSettings />
          </Tabs.Panel>

          {/* The one row that is not a preference: it opens the file every
              backend operation is written down in. Settings is where somebody
              already goes when the app has done something they cannot account
              for, and a log nobody can find is not one. */}
          <Tabs.Panel value="about" className="modal-body settings-pane">
            <h3>About</h3>
            <div className="settings-row">
              <span>Activity Log</span>
              <button type="button" onClick={() => void showLog()}>
                Show Log File
              </button>
            </div>
          </Tabs.Panel>

          <div className="modal-actions">
            <Dialog.Close render={<button type="button" className="primary" />}>Done</Dialog.Close>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

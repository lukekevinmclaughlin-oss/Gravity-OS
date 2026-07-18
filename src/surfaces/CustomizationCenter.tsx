import { useRef, useState } from "react";
import type { CSSProperties } from "react";
import { GridIcon, WindowsIcon } from "../components/Icons";
import {
  ACCENTS,
  DEFAULT_PERSONALIZATION,
  GRID_LAYOUTS,
  distributeWindowsToWells,
  removeCustomWallpaper,
  saveCustomWallpaper,
  snapWindowsToGrid,
  usePersonalization,
} from "../lib/customization";
import type { AccentId, DockMaterial, DockMotion, GridLayoutId, PersonalizationPreferences } from "../lib/customization";
import { WALLPAPERS, wallpaperSource } from "../lib/wallpapers";
import { colorForWell, sendWellCommand, useDesktopWells, WELL_CAPACITY, WELL_COLORS, WELL_KINDS } from "../lib/wells";
import { useShell } from "../shell/context";
import type { AppearanceMode } from "../shell/types";
import "./customization-center.css";

type Tab = "desktop" | "dock" | "wells";

interface CustomizationCenterProps {
  open: boolean;
  onClose: () => void;
}

export function CustomizationCenter({ open, onClose }: CustomizationCenterProps) {
  const { state, actions } = useShell();
  const wells = useDesktopWells();
  const [preferences, setPreferences] = usePersonalization();
  const [tab, setTab] = useState<Tab>("desktop");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const importTheme = useRef<"light" | "dark">(state.appearance.resolved);
  const fileInput = useRef<HTMLInputElement>(null);

  if (!open) return null;

  const patchPreferences = (patch: Partial<PersonalizationPreferences>) => {
    setPreferences((current) => ({ ...current, ...patch }));
  };
  const patchDock = (patch: Partial<PersonalizationPreferences["dock"]>) => {
    setPreferences((current) => ({ ...current, dock: { ...current.dock, ...patch } }));
  };
  const patchWallpaper = (patch: Partial<PersonalizationPreferences["wallpaper"]>) => {
    setPreferences((current) => ({ ...current, wallpaper: { ...current.wallpaper, ...patch } }));
  };
  const patchDesktop = (patch: Partial<PersonalizationPreferences["desktop"]>) => {
    setPreferences((current) => ({ ...current, desktop: { ...current.desktop, ...patch } }));
  };

  const chooseAppearance = async (mode: AppearanceMode) => {
    try {
      await actions.setAppearance(mode);
    } catch (error) {
      setMessage(String(error));
    }
  };

  const importWallpaper = (theme: "light" | "dark") => {
    importTheme.current = theme;
    fileInput.current?.click();
  };

  const onWallpaperFile = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    try {
      const theme = importTheme.current;
      await saveCustomWallpaper(theme, file);
      setPreferences((current) => ({
        ...current,
        wallpaper: {
          ...current.wallpaper,
          useCustom: true,
          customDarkName: theme === "dark" ? file.name : current.wallpaper.customDarkName,
          customLightName: theme === "light" ? file.name : current.wallpaper.customLightName,
          revision: Date.now(),
        },
      }));
      setMessage(`${theme === "dark" ? "Dark" : "Light"} wallpaper set to ${file.name}.`);
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const resetPersonalization = async () => {
    setBusy(true);
    try {
      await removeCustomWallpaper();
      patchPreferences(structuredClone(DEFAULT_PERSONALIZATION));
      await actions.setWallpaper("deep-field");
      setMessage("Desktop and Dock appearance restored to Gravity defaults.");
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  };

  const applyLayout = async (layout: GridLayoutId) => {
    setBusy(true);
    try {
      const count = await snapWindowsToGrid(state.windows, actions, layout);
      setMessage(count ? `${count} window${count === 1 ? "" : "s"} snapped to the selected grid.` : "There are no desktop windows to arrange.");
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  };

  const fillWells = async () => {
    setBusy(true);
    try {
      const result = await distributeWindowsToWells(state.windows, wells, actions);
      setMessage(result.remaining
        ? `${result.stored} windows stored; ${result.remaining} remain because every Well is full.`
        : `${result.stored} window${result.stored === 1 ? "" : "s"} distributed across available Gravity Wells.`);
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="customization" role="dialog" aria-modal="true" aria-label="Gravity customization">
      <button className="customization__scrim" aria-label="Close customization" onClick={onClose} />
      <section className="customization__window">
        <header className="customization__header">
          <span className="customization__mark"><i /><b /></span>
          <span><small>GRAVITY OS</small><strong>Customize your desktop</strong><em>Wallpaper, window layouts, Gravity Wells, and Orbit Dock</em></span>
          <button className="customization__close" onClick={onClose} aria-label="Close customization">×</button>
        </header>

        <div className="customization__body">
          <nav className="customization__sidebar" aria-label="Customization sections">
            {(["desktop", "dock", "wells"] as const).map((id) => (
              <button key={id} className={tab === id ? "is-active" : ""} onClick={() => setTab(id)}>
                <span>{id === "desktop" ? "◫" : id === "dock" ? "▱" : "◇"}</span>
                {id === "desktop" ? "Desktop & windows" : id === "dock" ? "Orbit Dock" : "Gravity Wells"}
              </button>
            ))}
            <span className="customization__sidebarSpacer" />
            <button onClick={() => void actions.setShellActive(false)}><WindowsIcon size={16} />Windows 11</button>
            <button className="is-reset" disabled={busy} onClick={() => void resetPersonalization()}>↺ Restore defaults</button>
          </nav>

          <main className="customization__content">
            {tab === "desktop" && (
              <>
                <section className="customization__section">
                  <div className="customization__title"><span><strong>Appearance</strong><small>Choose an automatic, light, or dark desktop</small></span></div>
                  <div className="customization__segments">
                    {(["system", "light", "dark"] as const).map((mode) => <button key={mode} className={state.appearance.mode === mode ? "is-selected" : ""} onClick={() => void chooseAppearance(mode)}>{mode}</button>)}
                  </div>
                </section>

                <section className="customization__section">
                  <div className="customization__title"><span><strong>Accent</strong><small>Recolors selection, toggles, and focus across every surface</small></span></div>
                  <div className="customization__accents" role="radiogroup" aria-label="Accent color">
                    {(Object.keys(ACCENTS) as Array<Exclude<AccentId, "auto">>).map((id) => (
                      <button
                        key={id}
                        role="radio"
                        aria-checked={preferences.desktop.accent === id}
                        className={preferences.desktop.accent === id ? "is-selected" : ""}
                        title={ACCENTS[id].label}
                        aria-label={ACCENTS[id].label}
                        style={{ "--swatch": ACCENTS[id].hex } as CSSProperties}
                        onClick={() => patchDesktop({ accent: id })}
                      />
                    ))}
                    <button
                      role="radio"
                      aria-checked={preferences.desktop.accent === "auto"}
                      className={`is-auto ${preferences.desktop.accent === "auto" ? "is-selected" : ""}`}
                      title="Auto — sampled from the current wallpaper"
                      aria-label="Automatic accent from wallpaper"
                      onClick={() => patchDesktop({ accent: "auto" })}
                    >A</button>
                  </div>
                  <div className="customization__toggles">
                    <Toggle label="Reduce transparency" checked={preferences.desktop.reduceTransparency} onChange={(reduceTransparency) => patchDesktop({ reduceTransparency })} />
                  </div>
                </section>

                <section className="customization__section">
                  <div className="customization__title"><span><strong>Gravity wallpapers</strong><small>Every curated image includes coordinated light and dark artwork</small></span></div>
                  <div className="customization__wallpaperGrid">
                    {WALLPAPERS.map((wallpaper) => {
                      const preview = wallpaperSource(wallpaper, state.appearance.resolved);
                      return <button key={wallpaper.id} className={state.appearance.wallpaperId === wallpaper.id && !preferences.wallpaper.useCustom ? "is-selected" : ""} onClick={() => {
                        patchWallpaper({ useCustom: false });
                        void actions.setWallpaper(wallpaper.id).catch((error) => setMessage(String(error)));
                      }}>
                        <span style={{ backgroundImage: preview ? `url(${preview})` : wallpaper.preview }} />
                        <strong>{wallpaper.name}</strong><small>{wallpaper.kind === "live" ? "Live, battery aware" : "Light + dark pair"}</small>
                      </button>;
                    })}
                  </div>
                </section>

                <section className="customization__section">
                  <div className="customization__title"><span><strong>Personal wallpapers</strong><small>Images are stored locally and can be removed at any time</small></span><label className="customization__switch"><input type="checkbox" checked={preferences.wallpaper.useCustom} disabled={!preferences.wallpaper.customDarkName && !preferences.wallpaper.customLightName} onChange={(event) => patchWallpaper({ useCustom: event.target.checked })} /><i /></label></div>
                  <input ref={fileInput} className="sr-only" type="file" accept="image/png,image/jpeg,image/webp,image/avif,image/bmp" onChange={(event) => void onWallpaperFile(event.target.files?.[0])} />
                  <div className="customization__imports">
                    {(["dark", "light"] as const).map((theme) => {
                      const name = theme === "dark" ? preferences.wallpaper.customDarkName : preferences.wallpaper.customLightName;
                      return <button key={theme} disabled={busy} onClick={() => importWallpaper(theme)}><span className={`is-${theme}`}>＋</span><strong>{theme === "dark" ? "Dark mode image" : "Light mode image"}</strong><small>{name ?? "Choose a local image…"}</small></button>;
                    })}
                  </div>
                  <div className="customization__controlGrid">
                    <label><span>Image fit</span><select value={preferences.wallpaper.fit} onChange={(event) => patchWallpaper({ fit: event.target.value as PersonalizationPreferences["wallpaper"]["fit"] })}><option value="cover">Fill display</option><option value="contain">Fit whole image</option><option value="fill">Stretch</option></select></label>
                    <label><span>Position</span><select value={preferences.wallpaper.position} onChange={(event) => patchWallpaper({ position: event.target.value as PersonalizationPreferences["wallpaper"]["position"] })}><option value="center">Center</option><option value="top">Top</option><option value="bottom">Bottom</option></select></label>
                    <Range label="Dim" value={preferences.wallpaper.dim} min={0} max={.65} step={.01} format={(value) => `${Math.round(value * 100)}%`} onChange={(value) => patchWallpaper({ dim: value })} />
                    <Range label="Blur" value={preferences.wallpaper.blur} min={0} max={18} step={1} format={(value) => `${value}px`} onChange={(value) => patchWallpaper({ blur: value })} />
                    <Range label="Saturation" value={preferences.wallpaper.saturation} min={.4} max={1.6} step={.05} format={(value) => `${Math.round(value * 100)}%`} onChange={(value) => patchWallpaper({ saturation: value })} />
                    <label><span>Tint</span><div className="customization__color"><input type="color" value={preferences.wallpaper.tint} onChange={(event) => patchWallpaper({ tint: event.target.value })} /><input type="range" min="0" max=".55" step=".01" value={preferences.wallpaper.tintStrength} onChange={(event) => patchWallpaper({ tintStrength: Number(event.target.value) })} /></div></label>
                  </div>
                </section>

                <section className="customization__section">
                  <div className="customization__title"><span><strong>Desktop gestures</strong><small>Direct manipulation on the bare wallpaper</small></span></div>
                  <div className="customization__toggles">
                    <Toggle label="Double-click wallpaper shows the desktop" checked={preferences.desktop.doubleClickShowsDesktop} onChange={(doubleClickShowsDesktop) => patchDesktop({ doubleClickShowsDesktop })} />
                  </div>
                </section>

                <section className="customization__section">
                  <div className="customization__title"><span><strong>Singularity Quick Keys</strong><small>Abbreviations that expand into commands, e.g. tl → snap left-half</small></span></div>
                  <div className="customization__quickKeys">
                    {Object.entries(preferences.search.quickKeys).map(([key, expansion]) => (
                      <div className="customization__quickKey" key={key}>
                        <code>{key}</code>
                        <span>{expansion}</span>
                        <button aria-label={`Remove Quick Key ${key}`} onClick={() => {
                          const next = { ...preferences.search.quickKeys };
                          delete next[key];
                          setPreferences((current) => ({ ...current, search: { quickKeys: next } }));
                        }}>✕</button>
                      </div>
                    ))}
                    <form
                      className="customization__quickKeyAdd"
                      onSubmit={(event) => {
                        event.preventDefault();
                        const data = new FormData(event.currentTarget);
                        const key = String(data.get("key") ?? "").trim().toLocaleLowerCase();
                        const expansion = String(data.get("expansion") ?? "").trim();
                        if (!/^[a-z0-9]{1,12}$/.test(key) || !expansion || expansion.length > 64) {
                          setMessage("Quick Keys need a short alphanumeric key and a command up to 64 characters.");
                          return;
                        }
                        setPreferences((current) => ({
                          ...current,
                          search: { quickKeys: { ...current.search.quickKeys, [key]: expansion } },
                        }));
                        event.currentTarget.reset();
                      }}
                    >
                      <input name="key" placeholder="tl" maxLength={12} aria-label="Quick Key abbreviation" />
                      <input name="expansion" placeholder="snap left-half" maxLength={64} aria-label="Quick Key command" />
                      <button type="submit">Add</button>
                    </form>
                  </div>
                </section>

                <section className="customization__section">
                  <div className="customization__title"><span><strong>Snap every window to a grid</strong><small>Applies a real native frame to each open application window</small></span><GridIcon size={18} /></div>
                  <div className="customization__layoutGrid">
                    {GRID_LAYOUTS.map((layout) => <button key={layout.id} disabled={busy} onClick={() => void applyLayout(layout.id)}><span className={`layoutGlyph is-${layout.id}`}>{Array.from({ length: layout.id === "nine-grid" ? 9 : layout.id === "six-pack" ? 6 : layout.id === "quarters" ? 4 : 3 }, (_, index) => <i key={index} />)}</span><strong>{layout.name}</strong><small>{layout.description}</small></button>)}
                  </div>
                </section>
              </>
            )}

            {tab === "dock" && (
              <>
                <section className="customization__section">
                  <div className="customization__title"><span><strong>Dock material</strong><small>Floating is the new default—no continuous shelf behind the icons</small></span></div>
                  <div className="customization__materialGrid">
                    {(["floating", "glass", "solid"] as DockMaterial[]).map((material) => <button key={material} className={preferences.dock.material === material ? "is-selected" : ""} onClick={() => patchDock({ material })}><span className={`dockPreview is-${material}`}><i /><i /><i /><i /></span><strong>{material}</strong><small>{material === "floating" ? "Icons without a background shelf" : material === "glass" ? "Luminous orbital glass" : "High-contrast graphite"}</small></button>)}
                  </div>
                </section>
                <section className="customization__section">
                  <div className="customization__title"><span><strong>Size & magnification</strong><small>Changes apply live to Orbit on every display</small></span></div>
                  <div className="customization__controlGrid">
                    <Range label="Icon size" value={preferences.dock.size} min={38} max={72} step={1} format={(value) => `${value}px`} onChange={(value) => patchDock({ size: value })} />
                    <Range label="Magnification" value={preferences.dock.magnification} min={1} max={2.35} step={.05} format={(value) => `${value.toFixed(2)}×`} onChange={(value) => patchDock({ magnification: value })} />
                    <Range label="Effect radius" value={preferences.dock.magnifyRadius} min={36} max={140} step={2} format={(value) => `${value}px`} onChange={(value) => patchDock({ magnifyRadius: value })} />
                    <Range label="Item spacing" value={preferences.dock.spacing} min={0} max={14} step={1} format={(value) => `${value}px`} onChange={(value) => patchDock({ spacing: value })} />
                    <Range label="Material opacity" value={preferences.dock.opacity} min={.45} max={1} step={.01} format={(value) => `${Math.round(value * 100)}%`} onChange={(value) => patchDock({ opacity: value })} />
                  </div>
                </section>
                <section className="customization__section">
                  <div className="customization__title"><span><strong>Motion personality</strong><small>The same damped spring remains continuous at every setting</small></span></div>
                  <div className="customization__segments">
                    {(["gentle", "fluid", "expressive"] as DockMotion[]).map((motion) => <button key={motion} className={preferences.dock.motion === motion ? "is-selected" : ""} onClick={() => patchDock({ motion })}>{motion}</button>)}
                  </div>
                  <div className="customization__toggles">
                    <Toggle label="Application labels" checked={preferences.dock.showLabels} onChange={(showLabels) => patchDock({ showLabels })} />
                    <Toggle label="Running indicators" checked={preferences.dock.showIndicators} onChange={(showIndicators) => patchDock({ showIndicators })} />
                    <Toggle label="Notification badges" checked={preferences.dock.showBadges} onChange={(showBadges) => patchDock({ showBadges })} />
                    <Toggle label="Open unpinned applications" checked={preferences.dock.showOpenApps} onChange={(showOpenApps) => patchDock({ showOpenApps })} />
                  </div>
                </section>
              </>
            )}

            {tab === "wells" && (
              <>
                <section className="customization__hero">
                  <span className="customization__wellHero"><i /><b /></span>
                  <span><small>WINDOW ORBITAL SYSTEM</small><strong>{wells.length} Gravity Well{wells.length === 1 ? "" : "s"} · {wells.reduce((sum, well) => sum + WELL_CAPACITY[well.kind], 0)} total slots</strong><em>Drop windows and application icons into any Well, then pull them back out by their orbiting faces.</em></span>
                  <button disabled={busy} onClick={() => void sendWellCommand("add-well")}>Create new Well</button>
                </section>
                <section className="customization__section">
                  <div className="customization__title"><span><strong>Automatic window assignment</strong><small>Fills each Well to capacity before moving to the next available Well</small></span></div>
                  <div className="customization__actions"><button disabled={busy || !wells.length} onClick={() => void fillWells()}>Snap all windows to Gravity Wells</button><button disabled={busy} onClick={() => void actions.releaseAllParkedWindows().then(() => setMessage("Every stored window was released to the desktop.")).catch((error) => setMessage(String(error)))}>Release all to desktop</button><button onClick={() => void sendWellCommand("toggle-wells")}>Show or hide Wells</button><button onClick={() => void sendWellCommand("equalize-wells")}>Equalize sizes</button></div>
                </section>
                <section className="customization__section">
                  <div className="customization__title"><span><strong>Orbital geometry</strong><small>A broad palette of capacity-aware desktop forms</small></span></div>
                  <div className="customization__geometryPalette">{WELL_KINDS.map((kind) => <span key={kind}><i className={`is-${kind}`} /><strong>{kind}</strong><small>{WELL_CAPACITY[kind]} slots</small></span>)}</div>
                </section>
                <section className="customization__section">
                  <div className="customization__title"><span><strong>Color spectrum</strong><small>Every Well can use a preset or any custom color</small></span></div>
                  <div className="customization__swatches">{WELL_COLORS.filter((color) => color !== "custom").map((color) => <span key={color} style={{ "--swatch": colorForWell({ color }) } as CSSProperties} title={color} />)}<span className="is-spectrum" title="Any custom color" /></div>
                  <p className="customization__note">Right-click an individual Well to change its shape, color, size, rotation, name, stored windows, and release behavior.</p>
                </section>
              </>
            )}
          </main>
        </div>

        {message && <button className="customization__message" role="status" onClick={() => setMessage(null)}>{message}</button>}
      </section>
    </div>
  );
}

function Range({ label, value, min, max, step, format, onChange }: { label: string; value: number; min: number; max: number; step: number; format: (value: number) => string; onChange: (value: number) => void }) {
  return <label><span>{label}<b>{format(value)}</b></span><input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="customization__toggle"><span>{label}</span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><i /></label>;
}

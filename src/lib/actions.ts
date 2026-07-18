import type { MediaControlKind, ShellActions, ShellState, WindowAction } from "../shell/types";
import { ACCENTS, readPersonalization, writePersonalization } from "./customization";
import type { AccentId } from "./customization";
import { WALLPAPERS } from "./wallpapers";
import { fuzzyScore, rank } from "./search";

/** Singularity's command registry (NS-6.2): every action is a verb phrase,
 *  optionally with one typed parameter. Typing `accent coral` or `volume 40`
 *  expands into directly runnable results; typing a bare verb offers a
 *  template that completes the query. Every run() path calls a real
 *  ShellActions implementation — nothing here is cosmetic. */

export interface ActionContext {
  state: ShellState;
  actions: ShellActions;
  /** The window focused before Singularity opened. */
  targetWindowId?: string;
  toggleTheme?: () => void | Promise<void>;
  openConstellation?: () => void;
}

interface ParameterSpec {
  placeholder: string;
  /** Fixed or state-derived choices; omit for a numeric 0–100 parameter. */
  options?: (context: ActionContext) => Array<{ value: string; label: string; sub?: string }>;
}

interface CommandSpec {
  id: string;
  verb: string;
  title: string;
  sub: string;
  parameter?: ParameterSpec;
  run(context: ActionContext, parameter?: string): Promise<void>;
}

export interface CommandResult {
  id: string;
  title: string;
  sub: string;
  /** A string result replaces the query (template completion) instead of
   *  running and closing. */
  run(): Promise<string | void>;
}

const SNAP_ZONES: Array<{ value: WindowAction; label: string }> = [
  { value: "left-half", label: "Left Half" },
  { value: "right-half", label: "Right Half" },
  { value: "top-half", label: "Top Half" },
  { value: "bottom-half", label: "Bottom Half" },
  { value: "top-left", label: "Top-Left Quarter" },
  { value: "top-right", label: "Top-Right Quarter" },
  { value: "bottom-left", label: "Bottom-Left Quarter" },
  { value: "bottom-right", label: "Bottom-Right Quarter" },
  { value: "maximize", label: "Fill" },
  { value: "almost-maximize", label: "Almost Fill" },
  { value: "center", label: "Center" },
  { value: "restore", label: "Restore" },
];

function requireTarget(context: ActionContext): string {
  const target = context.targetWindowId;
  if (!target) throw new Error("Open an application window first.");
  return target;
}

function parsePercent(raw: string | undefined): number | null {
  if (!raw) return null;
  const value = Number(raw.replace("%", "").trim());
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

const COMMANDS: CommandSpec[] = [
  {
    id: "snap",
    verb: "snap",
    title: "Snap Window",
    sub: "Place the focused window into a zone",
    parameter: {
      placeholder: "zone",
      options: () => SNAP_ZONES.map(({ value, label }) => ({ value, label: `Snap: ${label}`, sub: "Focused window" })),
    },
    run: async (context, parameter) => {
      const zone = SNAP_ZONES.find((candidate) => candidate.value === parameter);
      if (!zone) throw new Error("Choose a snap zone.");
      await context.actions.windowActionFor(requireTarget(context), zone.value);
    },
  },
  {
    id: "accent",
    verb: "accent",
    title: "Set Accent",
    sub: "Recolor Gravity's accent across every surface",
    parameter: {
      placeholder: "color",
      options: () => [
        ...(Object.keys(ACCENTS) as Array<Exclude<AccentId, "auto">>).map((id) => ({
          value: id,
          label: `Accent: ${ACCENTS[id].label}`,
          sub: ACCENTS[id].hex,
        })),
        { value: "auto", label: "Accent: Auto", sub: "Sampled from the wallpaper" },
      ],
    },
    run: async (_context, parameter) => {
      const accent = parameter as AccentId;
      if (accent !== "auto" && !(accent in ACCENTS)) throw new Error("Choose an accent color.");
      const preferences = readPersonalization();
      writePersonalization({ ...preferences, desktop: { ...preferences.desktop, accent } });
    },
  },
  {
    id: "wallpaper",
    verb: "wallpaper",
    title: "Set Wallpaper",
    sub: "Switch the Deep Field artwork",
    parameter: {
      placeholder: "name",
      options: () => WALLPAPERS.map((wallpaper) => ({
        value: wallpaper.id,
        label: `Wallpaper: ${wallpaper.name}`,
        sub: wallpaper.kind === "live" ? "Live" : "Light + dark pair",
      })),
    },
    run: async (context, parameter) => {
      if (!WALLPAPERS.some((wallpaper) => wallpaper.id === parameter)) throw new Error("Choose a wallpaper.");
      await context.actions.setWallpaper(parameter!);
    },
  },
  {
    id: "volume",
    verb: "volume",
    title: "Set Volume",
    sub: "0–100",
    parameter: { placeholder: "0–100" },
    run: async (context, parameter) => {
      const percent = parsePercent(parameter);
      if (percent === null) throw new Error("Give a volume between 0 and 100.");
      await context.actions.setVolume(percent / 100);
    },
  },
  {
    id: "brightness",
    verb: "brightness",
    title: "Set Brightness",
    sub: "0–100 on supported displays",
    parameter: { placeholder: "0–100" },
    run: async (context, parameter) => {
      const percent = parsePercent(parameter);
      if (percent === null) throw new Error("Give a brightness between 0 and 100.");
      await context.actions.setBrightness(percent / 100);
    },
  },
  {
    id: "orbit",
    verb: "orbit",
    title: "Switch Orbit",
    sub: "Jump to a workspace",
    parameter: {
      placeholder: "workspace",
      options: (context) => context.state.orbits.map((orbit, index) => ({
        value: String(index + 1),
        label: `Orbit: ${orbit.name}`,
        sub: context.state.activeOrbit === orbit.id ? "Current" : "Workspace",
      })),
    },
    run: async (context, parameter) => {
      const index = Number(parameter) - 1;
      const orbit = context.state.orbits[index];
      if (!orbit) throw new Error("Choose a workspace.");
      await context.actions.switchOrbit(orbit.id);
    },
  },
  {
    id: "scene",
    verb: "scene",
    title: "Restore Scene",
    sub: "Bring back a saved desktop layout",
    parameter: {
      placeholder: "name",
      options: (context) => context.state.windowing.scenes.map((scene) => ({
        value: scene.id,
        label: `Scene: ${scene.name}`,
        sub: `${scene.windows.length} windows`,
      })),
    },
    run: async (context, parameter) => {
      if (!context.state.windowing.scenes.some((scene) => scene.id === parameter)) {
        throw new Error("Choose a saved scene.");
      }
      await context.actions.restoreScene(parameter!);
    },
  },
];

const SIMPLE_COMMANDS: Array<{ id: string; title: string; sub: string; run(context: ActionContext): Promise<void> }> = [
  {
    id: "show-desktop",
    title: "Show Desktop",
    sub: "Minimize every window, or bring them back",
    run: async (context) => void (await context.actions.toggleShowDesktop()),
  },
  {
    id: "media-play-pause",
    title: "Play / Pause Media",
    sub: "Drive the current media session",
    run: (context) => context.actions.mediaControl("play-pause" as MediaControlKind),
  },
  {
    id: "media-next",
    title: "Next Track",
    sub: "Drive the current media session",
    run: (context) => context.actions.mediaControl("next" as MediaControlKind),
  },
  {
    id: "lock",
    title: "Lock",
    sub: "Lock this PC",
    run: (context) => context.actions.powerAction("lock"),
  },
  {
    id: "sleep",
    title: "Sleep",
    sub: "Put this PC to sleep",
    run: (context) => context.actions.powerAction("sleep"),
  },
];

/** Quick Keys (NS-6.3): an exact abbreviation expands into its stored command
 *  and runs the registry against the expansion, badged so the origin is clear. */
export function quickKeyResults(
  query: string,
  quickKeys: Record<string, string>,
  context: ActionContext,
): CommandResult[] {
  const expansion = quickKeys[query.trim().toLocaleLowerCase()];
  if (!expansion) return [];
  return commandResults(expansion, context).map((result) => ({
    ...result,
    sub: `Quick Key → ${expansion}`,
  }));
}

/** Rank the registry against a query. Verb-prefixed queries expand a
 *  command's parameter space; anything else fuzzy-matches titles. */
export function commandResults(query: string, context: ActionContext): CommandResult[] {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const lower = trimmed.toLocaleLowerCase();

  for (const command of COMMANDS) {
    if (lower !== command.verb && !lower.startsWith(`${command.verb} `)) continue;
    const remainder = trimmed.slice(command.verb.length).trim();
    const options = command.parameter?.options?.(context);
    if (options) {
      const matched = remainder
        ? rank(remainder, options, (option) => `${option.value} ${option.label}`)
        : options;
      return matched.slice(0, 8).map((option) => ({
        id: `${command.id}-${option.value}`,
        title: option.label,
        sub: option.sub ?? command.sub,
        run: async () => void (await command.run(context, option.value)),
      }));
    }
    // Numeric parameter: a valid number runs directly, otherwise show the
    // template so the hint stays visible while typing.
    const percent = parsePercent(remainder);
    if (percent !== null) {
      return [{
        id: `${command.id}-${percent}`,
        title: `${command.title}: ${percent}%`,
        sub: command.sub,
        run: async () => void (await command.run(context, String(percent))),
      }];
    }
    return [{
      id: `${command.id}-template`,
      title: `${command.title}: …`,
      sub: `Type ${command.parameter?.placeholder ?? "a value"}`,
      run: async () => `${command.verb} `,
    }];
  }

  const out: CommandResult[] = [];
  // Bare-verb templates surface when their verb or title matches.
  for (const command of COMMANDS) {
    if (fuzzyScore(lower, `${command.verb} ${command.title}`) !== null) {
      out.push({
        id: `${command.id}-template`,
        title: `${command.title}…`,
        sub: command.sub,
        run: async () => `${command.verb} `,
      });
    }
  }
  for (const simple of rank(trimmed, SIMPLE_COMMANDS, (command) => command.title)) {
    out.push({
      id: simple.id,
      title: simple.title,
      sub: simple.sub,
      run: async () => void (await simple.run(context)),
    });
  }
  return out;
}

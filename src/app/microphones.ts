/** Where the microphone picked is remembered, in this browser only. */
export const MICROPHONE_KEY = "nico-agent.microphone";

/** A microphone as the picker shows it: its device id ("" for the system default) and its name. */
export interface Microphone {
  id: string;
  label: string;
}

/** The system default: no device asked for, so the browser records on whichever it prefers. */
export const SYSTEM_DEFAULT: Microphone = { id: "", label: "System default" };

/** A device as `navigator.mediaDevices.enumerateDevices` lists it: a microphone, a speaker or a camera. */
export type BrowserDevice = Pick<MediaDeviceInfo, "kind" | "deviceId" | "label">;

/** Chromium's own aliases for the default and the communications device, which the picker's System default already covers. */
const ALIASES = new Set(["default", "communications"]);

/** The microphones among `devices`. */
const inputs = (devices: BrowserDevice[]) => devices.filter((d) => d.kind === "audioinput");

/** The microphones among `devices` that can be asked for by id, by name: not the browser's aliases, nor hidden ones (no id until the page may use one). */
function listed(devices: BrowserDevice[]): Microphone[] {
  return inputs(devices)
    .filter((d) => d.deviceId && !ALIASES.has(d.deviceId))
    .map((d, i) => ({ id: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
}

/**
 * The picker's choices for `devices` (null until the browser lists them):
 * System default first, then each audio input by name. The one picked
 * (`picked`, named `label`), when it is unplugged, stays at the end marked
 * not connected, so plugging it back in needs no new choice; while the
 * browser hides which devices there are, it shows as itself.
 */
export function microphoneOptions(devices: BrowserDevice[] | null, picked: string, label = ""): Microphone[] {
  const mics = listed(devices ?? []);
  if (!picked || mics.some((m) => m.id === picked)) return [SYSTEM_DEFAULT, ...mics];
  const known = devices !== null && !needsPermission(devices);
  return [SYSTEM_DEFAULT, ...mics, { id: picked, label: known ? `${label || "Microphone"} (not connected)` : label }];
}

/** Whether the browser hides the microphones' names until the page may use one, so the picker must ask first. */
export function needsPermission(devices: BrowserDevice[]): boolean {
  const mics = inputs(devices);
  return mics.length > 0 && mics.every((d) => !d.label);
}

/** The microphone remembered, as stored under MICROPHONE_KEY; the system default for nothing, or for anything not one. */
export function rememberedMicrophone(stored: string | null): Microphone {
  try {
    const value: unknown = JSON.parse(stored ?? "null");
    if (value && typeof value === "object" && "id" in value && "label" in value && typeof value.id === "string" && typeof value.label === "string") {
      return { id: value.id, label: value.label || (value.id ? "Microphone" : SYSTEM_DEFAULT.label) };
    }
  } catch {
    // Not one.
  }
  return SYSTEM_DEFAULT;
}

/** `picked` under the name the browser gives it now, as one picked before the browser named any is saved as "Microphone 1". */
export function named(picked: Microphone, devices: BrowserDevice[]): Microphone {
  const label = inputs(devices).find((d) => picked.id && d.deviceId === picked.id)?.label;
  return label ? { ...picked, label } : picked;
}

/** The first microphone the browser lists, by id: what records when even the system default is gone; null when it hides them. */
export function firstMicrophone(devices: BrowserDevice[]): Microphone | null {
  return listed(devices)[0] ?? null;
}

/** What to ask `getUserMedia` for: one channel, cleaned up for speech, on the device `id` exactly, or the default for "". */
export function audioConstraints(id: string): MediaTrackConstraints {
  return {
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    ...(id && { deviceId: { exact: id } }),
  };
}

/** Whether `getUserMedia` failed because the device asked for is not there: then the default records instead. */
export function missingDevice(e: unknown): boolean {
  return e instanceof Error && (e.name === "NotFoundError" || e.name === "OverconstrainedError");
}

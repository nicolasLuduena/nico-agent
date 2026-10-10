/** Where the microphone picked is remembered, in this browser only. */
export const MICROPHONE_KEY = "nico-agent.microphone";

/** A microphone as the picker shows it: its device id ("" for the system default) and its name. */
export interface Microphone {
  id: string;
  label: string;
}

/** The system default: no device asked for, so the browser records on whichever it prefers. */
export const SYSTEM_DEFAULT: Microphone = { id: "", label: "System default" };

/** A device as `navigator.mediaDevices.enumerateDevices` lists it. */
type Device = Pick<MediaDeviceInfo, "kind" | "deviceId" | "label">;

/** Chromium's own aliases for the default and the communications device, which the picker's System default already covers. */
const ALIASES = new Set(["default", "communications"]);

const inputs = (devices: Device[]) => devices.filter((d) => d.kind === "audioinput");

/**
 * The picker's choices for `devices` (null until the browser lists them):
 * System default first, then each audio input by name. The one picked
 * (`picked`, named `label`), when it is unplugged, stays at the end marked
 * not connected, so plugging it back in needs no new choice; while the
 * browser hides which devices there are, it shows as itself.
 */
export function microphoneOptions(devices: Device[] | null, picked: string, label = ""): Microphone[] {
  const listed = inputs(devices ?? [])
    .filter((d) => d.deviceId && !ALIASES.has(d.deviceId))
    .map((d, i) => ({ id: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
  if (!picked || listed.some((m) => m.id === picked)) return [SYSTEM_DEFAULT, ...listed];
  const known = devices !== null && !needsPermission(devices);
  return [SYSTEM_DEFAULT, ...listed, { id: picked, label: known ? `${label || "Microphone"} (not connected)` : label }];
}

/** Whether the browser hides the microphones' names until the page may use one, so the picker must ask first. */
export function needsPermission(devices: Device[]): boolean {
  const mics = inputs(devices);
  return mics.length > 0 && mics.every((d) => !d.label);
}

/** The microphone remembered, as stored under MICROPHONE_KEY; the system default for nothing, or for anything not one. */
export function rememberedMicrophone(stored: string | null): Microphone {
  try {
    const value: unknown = JSON.parse(stored ?? "null");
    if (value && typeof value === "object" && "id" in value && "label" in value && typeof value.id === "string" && typeof value.label === "string") {
      return { id: value.id, label: value.label };
    }
  } catch {
    // Not one.
  }
  return SYSTEM_DEFAULT;
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

import { useEffect, useRef, useState } from "react";
import { MICROPHONE_KEY, type Microphone, SYSTEM_DEFAULT, microphoneOptions, missingDevice, named, needsPermission, rememberedMicrophone } from "./microphones";

/** Remember `picked` in this browser; a browser that will not keeps it for this visit only. */
function remember(picked: Microphone) {
  try {
    localStorage.setItem(MICROPHONE_KEY, JSON.stringify(picked));
  } catch {
    // Kept for this visit only.
  }
}

/**
 * The microphones the browser has, and the one picked for the talk button,
 * remembered in this browser; the list follows devices plugged in and out,
 * and `refresh` lists them again (once recording has let the page use one,
 * the browser names them). It names them only once the page may use one,
 * so the picker asks once (`ask`) when it is first opened without names.
 */
export function useMicrophones() {
  const [picked, setPicked] = useState<Microphone>(() => {
    try {
      return rememberedMicrophone(localStorage.getItem(MICROPHONE_KEY));
    } catch {
      return SYSTEM_DEFAULT;
    }
  });
  const [devices, setDevices] = useState<MediaDeviceInfo[] | null>(null);
  const asked = useRef(false);
  const refresh = () => navigator.mediaDevices?.enumerateDevices().then(setDevices, () => {});
  useEffect(() => {
    const media = navigator.mediaDevices;
    if (!media) return;
    void refresh();
    media.addEventListener("devicechange", refresh);
    return () => media.removeEventListener("devicechange", refresh);
  }, []);
  // One picked before the browser named any takes its real name once it does.
  useEffect(() => {
    if (!devices) return;
    const renamed = named(picked, devices);
    if (renamed.label === picked.label) return;
    setPicked(renamed);
    remember(renamed);
  }, [devices]);
  const ask = async () => {
    if (asked.current || !devices || !needsPermission(devices)) return;
    asked.current = true;
    try {
      (await navigator.mediaDevices.getUserMedia({ audio: true })).getTracks().forEach((t) => t.stop());
    } catch (e) {
      // The browser's preferred microphone gone is no answer: the next open asks again. Blocked, recording says why.
      if (missingDevice(e)) asked.current = false;
      return;
    }
    await refresh();
  };
  const options = microphoneOptions(devices, picked.id, picked.label);
  const pick = (id: string) => {
    const next = id === picked.id ? picked : options.find((o) => o.id === id) ?? SYSTEM_DEFAULT;
    setPicked(next);
    remember(next);
  };
  return { options, picked, pick, ask, refresh };
}

/**
 * Which microphone the talk button records on, beside it: System default,
 * then each one the browser has, by name. A native select, drawn as a small
 * pill with a chevron, so the list is the browser's own.
 */
export function MicrophonePicker({ microphones: { options, picked, pick, ask } }: { microphones: ReturnType<typeof useMicrophones> }) {
  const shown = options.find((o) => o.id === picked.id) ?? SYSTEM_DEFAULT;
  return (
    <span className="mic-picker" title={`Microphone: ${shown.label}`}>
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 6.5 8 10l3.5-3.5" /></svg>
      <select aria-label="Microphone" value={picked.id} onChange={(e) => pick(e.target.value)} onPointerDown={() => void ask()} onFocus={() => void ask()}>
        {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
    </span>
  );
}

import { describe, expect, test } from "bun:test";
import { audioConstraints, firstMicrophone, microphoneOptions, missingDevice, named, needsPermission, rememberedMicrophone } from "../src/app/microphones";

/** A device as `enumerateDevices` lists it. */
const device = (kind: MediaDeviceKind, deviceId: string, label: string) => ({ kind, deviceId, label });

const SOLOCAST = device("audioinput", "a1", "HyperX SoloCast (0951:16f9)");
const BUILT_IN = device("audioinput", "b2", "Built-in Audio Analog Stereo");
const DEVICES = [
  device("audioinput", "default", "Default - HyperX SoloCast (0951:16f9)"),
  device("audioinput", "communications", "Communications - Built-in Audio"),
  SOLOCAST,
  device("audiooutput", "c3", "Speakers"),
  BUILT_IN,
  device("videoinput", "d4", "Webcam"),
];

describe("the microphone picker", () => {
  test("lists System default first, then each audio input by name, without the browser's own aliases", () => {
    expect(microphoneOptions(DEVICES, "")).toEqual([
      { id: "", label: "System default" },
      { id: "a1", label: "HyperX SoloCast (0951:16f9)" },
      { id: "b2", label: "Built-in Audio Analog Stereo" },
    ]);
  });

  test("a chosen microphone that is unplugged stays listed, marked not connected, so plugging it back in needs no new choice", () => {
    expect(microphoneOptions([BUILT_IN], "a1", "HyperX SoloCast (0951:16f9)")).toEqual([
      { id: "", label: "System default" },
      { id: "b2", label: "Built-in Audio Analog Stereo" },
      { id: "a1", label: "HyperX SoloCast (0951:16f9) (not connected)" },
    ]);
  });

  test("without the microphone permission the browser gives no names, so the picker asks for it once", () => {
    const unnamed = [device("audioinput", "", ""), device("audioinput", "", "")];
    expect(needsPermission(unnamed)).toBe(true);
    expect(needsPermission(DEVICES)).toBe(false);
    expect(needsPermission([])).toBe(false);
  });

  test("before the permission, or before the browser lists anything, the one picked shows as itself, not as unplugged", () => {
    const unnamed = [device("audioinput", "", "")];
    expect(microphoneOptions(unnamed, "a1", "HyperX SoloCast")).toEqual([{ id: "", label: "System default" }, { id: "a1", label: "HyperX SoloCast" }]);
    expect(microphoneOptions(null, "a1", "HyperX SoloCast")).toEqual([{ id: "", label: "System default" }, { id: "a1", label: "HyperX SoloCast" }]);
    expect(microphoneOptions(null, "")).toEqual([{ id: "", label: "System default" }]);
  });
});

describe("the remembered microphone", () => {
  test("is read back as it was stored, and as System default when nothing or garbage was stored", () => {
    expect(rememberedMicrophone(JSON.stringify({ id: "a1", label: "HyperX SoloCast" }))).toEqual({ id: "a1", label: "HyperX SoloCast" });
    expect(rememberedMicrophone(null)).toEqual({ id: "", label: "System default" });
    expect(rememberedMicrophone("{nope")).toEqual({ id: "", label: "System default" });
    expect(rememberedMicrophone(JSON.stringify({ id: 4 }))).toEqual({ id: "", label: "System default" });
    expect(rememberedMicrophone(JSON.stringify({ id: "a1", label: "" }))).toEqual({ id: "a1", label: "Microphone" });
  });

  test("picked before the browser gave names, it takes its real name once the browser gives it", () => {
    expect(named({ id: "a1", label: "Microphone 1" }, DEVICES)).toEqual({ id: "a1", label: "HyperX SoloCast (0951:16f9)" });
    expect(named({ id: "a1", label: "HyperX SoloCast" }, [BUILT_IN])).toEqual({ id: "a1", label: "HyperX SoloCast" });
    expect(named({ id: "a1", label: "HyperX SoloCast" }, [device("audioinput", "a1", "")])).toEqual({ id: "a1", label: "HyperX SoloCast" });
    expect(named({ id: "", label: "System default" }, DEVICES)).toEqual({ id: "", label: "System default" });
  });

  test("when the system default itself is gone, the first microphone the browser lists records instead", () => {
    expect(firstMicrophone(DEVICES)).toEqual({ id: "a1", label: "HyperX SoloCast (0951:16f9)" });
    expect(firstMicrophone([device("audiooutput", "c3", "Speakers")])).toBeNull();
    // Without the permission the browser hides the ids, so there is none to ask for.
    expect(firstMicrophone([device("audioinput", "", "")])).toBeNull();
  });

  test("records on the chosen microphone exactly, or on the default when none is chosen", () => {
    expect(audioConstraints("a1").deviceId).toEqual({ exact: "a1" });
    expect(audioConstraints("").deviceId).toBeUndefined();
    expect(audioConstraints("").echoCancellation).toBe(true);
  });

  test("the browser not finding the chosen microphone is a reason to fall back to the default; a blocked one is not", () => {
    expect(missingDevice(new DOMException("Requested device not found", "NotFoundError"))).toBe(true);
    expect(missingDevice(Object.assign(new Error("Constraints could be not satisfied."), { name: "OverconstrainedError" }))).toBe(true);
    expect(missingDevice(new DOMException("Permission denied", "NotAllowedError"))).toBe(false);
    expect(missingDevice("nope")).toBe(false);
  });

});

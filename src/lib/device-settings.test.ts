import { describe, expect, it } from "vitest";
import {
  DEFAULT_DEVICE_SETTINGS,
  parseDeviceSettings,
  resetDeviceSettingsForTests,
  wheelChangesValues,
  writeDeviceSettings,
} from "./device-settings";

describe("device settings", () => {
  it("keeps network sidebar widths within the visible resize handle's limits", () => {
    const width = (value: unknown) =>
      parseDeviceSettings(JSON.stringify({ networkSidebarWidth: value })).networkSidebarWidth;
    expect(width(420)).toBe(420);
    expect(width(20)).toBe(240);
    expect(width(1000)).toBe(640);
    expect(width("wide")).toBe(300);
  });
  it("starts at the mod's defaults: names on, problem outlines on, scroll changes values, items on the right, Board section", () => {
    expect(DEFAULT_DEVICE_SETTINGS).toEqual({
      zoomedOutNames: true,
      zoomedOutAt: 0.65,
      problemOutlines: true,
      scrollChangesValues: true,
      itemsLeft: false,
      overviewWidth: 336,
      itemsWidth: 256,
      networkSidebarWidth: 300,
      settingsSection: "Board",
    });
    expect(parseDeviceSettings(null)).toBe(DEFAULT_DEVICE_SETTINGS);
    expect(parseDeviceSettings("not json")).toBe(DEFAULT_DEVICE_SETTINGS);
  });

  it("keeps a saved value, and an absent key falls back to its default", () => {
    const read = parseDeviceSettings(JSON.stringify({ zoomedOutNames: false }));
    expect(read.zoomedOutNames).toBe(false);
    expect(read.settingsSection).toBe("Board");
    // Only an explicit false means off: a missing names key is on.
    expect(parseDeviceSettings("{}").zoomedOutNames).toBe(true);
    expect(parseDeviceSettings("{}").problemOutlines).toBe(true);
    expect(parseDeviceSettings(JSON.stringify({ problemOutlines: false })).problemOutlines).toBe(
      false,
    );
  });

  it("keeps a zoomed-out zoom inside the slider's range and drops one outside it", () => {
    expect(parseDeviceSettings(JSON.stringify({ zoomedOutAt: 0.9 })).zoomedOutAt).toBe(0.9);
    expect(parseDeviceSettings(JSON.stringify({ zoomedOutAt: 0.35 })).zoomedOutAt).toBe(0.35);
    expect(parseDeviceSettings(JSON.stringify({ zoomedOutAt: 1 })).zoomedOutAt).toBe(1);
    expect(parseDeviceSettings(JSON.stringify({ zoomedOutAt: 0.1 })).zoomedOutAt).toBe(0.65);
    expect(parseDeviceSettings(JSON.stringify({ zoomedOutAt: 3 })).zoomedOutAt).toBe(0.65);
    expect(parseDeviceSettings(JSON.stringify({ zoomedOutAt: "0.9" })).zoomedOutAt).toBe(0.65);
  });

  it("reads Scroll changes values: on unless saved off, and only a real boolean counts", () => {
    expect(parseDeviceSettings("{}").scrollChangesValues).toBe(true);
    expect(
      parseDeviceSettings(JSON.stringify({ scrollChangesValues: false })).scrollChangesValues,
    ).toBe(false);
    expect(
      parseDeviceSettings(JSON.stringify({ scrollChangesValues: "no" })).scrollChangesValues,
    ).toBe(true);
  });

  it("wheelChangesValues follows the setting at the moment it is asked", () => {
    resetDeviceSettingsForTests();
    expect(wheelChangesValues()).toBe(true);
    writeDeviceSettings({ scrollChangesValues: false });
    expect(wheelChangesValues()).toBe(false);
    writeDeviceSettings({ scrollChangesValues: true });
    expect(wheelChangesValues()).toBe(true);
    resetDeviceSettingsForTests();
  });

  it("keeps the side columns' widths the player dragged, held inside their limits, and drops a wrong kind", () => {
    const read = parseDeviceSettings(JSON.stringify({ overviewWidth: 300, itemsWidth: 180 }));
    expect([read.overviewWidth, read.itemsWidth]).toEqual([300, 180]);
    // Outside the limits the value is held to them (a width kept before they moved still opens).
    const wild = parseDeviceSettings(JSON.stringify({ overviewWidth: 40, itemsWidth: 9000 }));
    expect([wild.overviewWidth, wild.itemsWidth]).toEqual([224, 420]);
    const wrong = parseDeviceSettings(JSON.stringify({ overviewWidth: "wide", itemsWidth: null }));
    expect([wrong.overviewWidth, wrong.itemsWidth]).toEqual([336, 256]);
    expect(parseDeviceSettings("{}").overviewWidth).toBe(336);
  });

  it("ignores values of the wrong kind", () => {
    const read = parseDeviceSettings(JSON.stringify({ zoomedOutNames: "yes", settingsSection: 4 }));
    expect(read).toEqual(DEFAULT_DEVICE_SETTINGS);
  });

  it("forgets the old Circuit as an input switch: the circuit is always on the card", () => {
    const read = parseDeviceSettings(
      JSON.stringify({ circuitAsInput: false, zoomedOutNames: false }),
    );
    expect(read).toEqual({
      zoomedOutNames: false,
      zoomedOutAt: 0.65,
      problemOutlines: true,
      scrollChangesValues: true,
      itemsLeft: false,
      overviewWidth: 336,
      itemsWidth: 256,
      networkSidebarWidth: 300,
      settingsSection: "Board",
    });
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { createConsentManager } from "../src/consent.js";

describe("ConsentManager", () => {
  beforeEach(() => {
    // Clean up any existing indicators and session storage
    const existing = document.querySelector("[data-trustloop-indicator]");
    existing?.remove();
    sessionStorage.removeItem("trustloop_recording");
  });

  it("starts in non-recording state", () => {
    const consent = createConsentManager();
    expect(consent.isRecording()).toBe(false);
    consent.destroy();
  });

  it("toggles recording state with startRecording/stopRecording", () => {
    const consent = createConsentManager();

    consent.startRecording();
    expect(consent.isRecording()).toBe(true);

    consent.stopRecording();
    expect(consent.isRecording()).toBe(false);

    consent.destroy();
  });

  it("creates indicator element when recording starts", () => {
    const consent = createConsentManager();

    consent.startRecording();

    const indicator = document.querySelector("[data-trustloop-indicator]");
    expect(indicator).not.toBeNull();
    expect(indicator?.tagName.toLowerCase()).toBe("div");

    consent.stopRecording();
    consent.destroy();
  });

  it("removes indicator element when recording stops", () => {
    const consent = createConsentManager();

    consent.startRecording();
    expect(document.querySelector("[data-trustloop-indicator]")).not.toBeNull();

    consent.stopRecording();
    expect(document.querySelector("[data-trustloop-indicator]")).toBeNull();

    consent.destroy();
  });

  it("persists recording state in sessionStorage", () => {
    const consent = createConsentManager();

    consent.startRecording();
    expect(sessionStorage.getItem("trustloop_recording")).toBe("1");

    consent.stopRecording();
    expect(sessionStorage.getItem("trustloop_recording")).toBe("0");

    consent.destroy();
  });

  it("restores recording state from sessionStorage", () => {
    sessionStorage.setItem("trustloop_recording", "1");

    const consent = createConsentManager();
    expect(consent.isRecording()).toBe(true);

    // Indicator should be created from restored state
    expect(document.querySelector("[data-trustloop-indicator]")).not.toBeNull();

    consent.destroy();
  });

  it("startRecording is idempotent", () => {
    const consent = createConsentManager();

    consent.startRecording();
    consent.startRecording();
    consent.startRecording();

    const indicators = document.querySelectorAll("[data-trustloop-indicator]");
    expect(indicators).toHaveLength(1);

    consent.destroy();
  });

  it("cleans up on destroy", () => {
    const consent = createConsentManager();
    consent.startRecording();

    consent.destroy();

    expect(document.querySelector("[data-trustloop-indicator]")).toBeNull();
  });
});

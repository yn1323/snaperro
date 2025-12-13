import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "./logger.js";

describe("logger", () => {
  const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

  beforeEach(() => {
    consoleSpy.mockClear();
    logger.setVerbose(false);
  });

  afterEach(() => {
    logger.setVerbose(false);
  });

  describe("info", () => {
    it("logs message with INFO prefix", () => {
      logger.info("Test message");

      expect(consoleSpy).toHaveBeenCalledTimes(1);
      const output = consoleSpy.mock.calls[0][0];
      expect(output).toContain("INFO");
      expect(output).toContain("Test message");
    });

    it("includes timestamp in output", () => {
      logger.info("Timestamped message");

      const output = consoleSpy.mock.calls[0][0];
      // Match time format like [12:34:56]
      expect(output).toMatch(/\[\d{1,2}:\d{2}:\d{2}\]/);
    });
  });

  describe("debug", () => {
    it("does not log when verbose is false", () => {
      logger.setVerbose(false);
      logger.debug("Debug message");

      expect(consoleSpy).not.toHaveBeenCalled();
    });

    it("logs when verbose is true", () => {
      logger.setVerbose(true);
      logger.debug("Debug message");

      expect(consoleSpy).toHaveBeenCalledTimes(1);
      const output = consoleSpy.mock.calls[0][0];
      expect(output).toContain("DEBUG");
      expect(output).toContain("Debug message");
    });
  });

  describe("warn", () => {
    it("logs message with WARN prefix", () => {
      logger.warn("Warning message");

      expect(consoleSpy).toHaveBeenCalledTimes(1);
      const output = consoleSpy.mock.calls[0][0];
      expect(output).toContain("WARN");
      expect(output).toContain("Warning message");
    });
  });

  describe("error", () => {
    it("logs message with ERROR prefix", () => {
      logger.error("Error message");

      expect(consoleSpy).toHaveBeenCalledTimes(1);
      const output = consoleSpy.mock.calls[0][0];
      expect(output).toContain("ERROR");
      expect(output).toContain("Error message");
    });

    it("logs stack trace when verbose is true and error provided", () => {
      logger.setVerbose(true);
      const error = new Error("Test error");
      logger.error("Error occurred", error);

      expect(consoleSpy).toHaveBeenCalledTimes(2);
      const stackOutput = consoleSpy.mock.calls[1][0];
      expect(stackOutput).toContain("Test error");
    });

    it("does not log stack trace when verbose is false", () => {
      logger.setVerbose(false);
      const error = new Error("Test error");
      logger.error("Error occurred", error);

      expect(consoleSpy).toHaveBeenCalledTimes(1);
    });

    it("does not log stack trace when error is not provided", () => {
      logger.setVerbose(true);
      logger.error("Error message only");

      expect(consoleSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("debugHeaders", () => {
    it("does not log when verbose is false", () => {
      logger.setVerbose(false);
      logger.debugHeaders({ "Content-Type": "application/json" });

      expect(consoleSpy).not.toHaveBeenCalled();
    });

    it("logs headers when verbose is true", () => {
      logger.setVerbose(true);
      logger.debugHeaders({
        "Content-Type": "application/json",
        Accept: "application/json",
      });

      expect(consoleSpy).toHaveBeenCalled();
      const outputs = consoleSpy.mock.calls.map((call) => call[0]);
      expect(outputs.join(" ")).toContain("Headers:");
      expect(outputs.join(" ")).toContain("Content-Type: application/json");
    });

    it("masks sensitive headers containing 'key'", () => {
      logger.setVerbose(true);
      logger.debugHeaders({ "X-Api-Key": "sk-1234567890" });

      const outputs = consoleSpy.mock.calls.map((call) => call[0]);
      const headerOutput = outputs.join(" ");
      expect(headerOutput).toContain("X-Api-Key");
      expect(headerOutput).toContain("sk-1");
      expect(headerOutput).not.toContain("sk-1234567890");
    });

    it("masks sensitive headers containing 'secret'", () => {
      logger.setVerbose(true);
      logger.debugHeaders({ "X-Client-Secret": "secret123456" });

      const outputs = consoleSpy.mock.calls.map((call) => call[0]);
      const headerOutput = outputs.join(" ");
      expect(headerOutput).toContain("X-Client-Secret");
      expect(headerOutput).toContain("secr");
      expect(headerOutput).not.toContain("secret123456");
    });

    it("masks sensitive headers containing 'token'", () => {
      logger.setVerbose(true);
      logger.debugHeaders({ "X-Access-Token": "token12345678" });

      const outputs = consoleSpy.mock.calls.map((call) => call[0]);
      const headerOutput = outputs.join(" ");
      expect(headerOutput).toContain("X-Access-Token");
      expect(headerOutput).toContain("toke");
      expect(headerOutput).not.toContain("token12345678");
    });

    it("masks Authorization header", () => {
      logger.setVerbose(true);
      logger.debugHeaders({ Authorization: "Bearer abcdefghijklmn" });

      const outputs = consoleSpy.mock.calls.map((call) => call[0]);
      const headerOutput = outputs.join(" ");
      expect(headerOutput).toContain("Authorization");
      expect(headerOutput).toContain("Bear");
      expect(headerOutput).not.toContain("Bearer abcdefghijklmn");
    });

    it("does not mask non-sensitive headers", () => {
      logger.setVerbose(true);
      logger.debugHeaders({
        "Content-Type": "application/json",
        Accept: "text/html",
      });

      const outputs = consoleSpy.mock.calls.map((call) => call[0]);
      const headerOutput = outputs.join(" ");
      expect(headerOutput).toContain("Content-Type: application/json");
      expect(headerOutput).toContain("Accept: text/html");
    });
  });

  describe("setVerbose", () => {
    it("enables verbose mode", () => {
      logger.setVerbose(true);
      logger.debug("Should appear");

      expect(consoleSpy).toHaveBeenCalled();
    });

    it("disables verbose mode", () => {
      logger.setVerbose(true);
      logger.setVerbose(false);
      logger.debug("Should not appear");

      expect(consoleSpy).not.toHaveBeenCalled();
    });
  });
});

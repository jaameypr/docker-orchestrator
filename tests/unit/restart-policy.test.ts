import { describe, it, expect } from "vitest";
import { buildRestartPolicy } from "../../src/core/restart-policy.js";
import { InvalidResourceConfigError } from "../../src/errors/base.js";

describe("buildRestartPolicy", () => {
  it("should transform string 'no' to API format", () => {
    const result = buildRestartPolicy("no");
    expect(result).toEqual({ Name: "no", MaximumRetryCount: 0 });
  });

  it("should transform string 'always' to API format", () => {
    const result = buildRestartPolicy("always");
    expect(result).toEqual({ Name: "always", MaximumRetryCount: 0 });
  });

  it("should transform string 'unless-stopped' to API format", () => {
    const result = buildRestartPolicy("unless-stopped");
    expect(result).toEqual({ Name: "unless-stopped", MaximumRetryCount: 0 });
  });

  it("should transform string 'on-failure' to API format", () => {
    const result = buildRestartPolicy("on-failure");
    expect(result).toEqual({ Name: "on-failure", MaximumRetryCount: 0 });
  });

  it("should transform object with on-failure and maxRetries", () => {
    const result = buildRestartPolicy({ type: "on-failure", maxRetries: 3 });
    expect(result).toEqual({ Name: "on-failure", MaximumRetryCount: 3 });
  });

  it("should transform object without maxRetries", () => {
    const result = buildRestartPolicy({ type: "always" });
    expect(result).toEqual({ Name: "always", MaximumRetryCount: 0 });
  });

  it("should throw when maxRetries used with 'always'", () => {
    expect(() => buildRestartPolicy({ type: "always", maxRetries: 3 })).toThrow(
      InvalidResourceConfigError,
    );
  });

  it("should throw when maxRetries used with 'no'", () => {
    expect(() => buildRestartPolicy({ type: "no", maxRetries: 5 })).toThrow(
      InvalidResourceConfigError,
    );
  });

  it("should throw when maxRetries used with 'unless-stopped'", () => {
    expect(() => buildRestartPolicy({ type: "unless-stopped", maxRetries: 2 })).toThrow(
      InvalidResourceConfigError,
    );
  });
});

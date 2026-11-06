import { describe, expect, it } from "bun:test";
import { executeWithModelFallback, isFallbackEligibleError } from "../src/ai/model-fallback";

describe("Model Fallback Engine", () => {
  it("executes primary model successfully when no error occurs", async () => {
    const models = ["gemini-2.5-flash", "gemini-2.5-pro"];
    const outcome = await executeWithModelFallback(models, async (model) => {
      return `Response from ${model}`;
    });

    expect(outcome.activeModel).toBe("gemini-2.5-flash");
    expect(outcome.attempts).toBe(1);
    expect(outcome.result).toBe("Response from gemini-2.5-flash");
  });

  it("falls back to secondary model on 429 quota exhaustion", async () => {
    const models = ["gemini-2.5-flash", "gemini-2.5-pro"];
    const fallbackEvents: Array<{ from: string; to: string }> = [];

    const outcome = await executeWithModelFallback(
      models,
      async (model) => {
        if (model === "gemini-2.5-flash") {
          const err = new Error("RESOURCE_EXHAUSTED: quota exceeded for current project");
          (err as any).status = 429;
          throw err;
        }
        return `Healthy response from ${model}`;
      },
      {
        onFallback: (from, to) => {
          fallbackEvents.push({ from, to });
        },
      }
    );

    expect(outcome.activeModel).toBe("gemini-2.5-pro");
    expect(outcome.attempts).toBe(2);
    expect(outcome.result).toBe("Healthy response from gemini-2.5-pro");
    expect(fallbackEvents).toEqual([{ from: "gemini-2.5-flash", to: "gemini-2.5-pro" }]);
  });

  it("fails immediately and does NOT fallback on 401/403 permission errors", async () => {
    const models = ["gemini-2.5-flash", "gemini-2.5-pro"];
    let secondModelCalled = false;

    expect(
      executeWithModelFallback(models, async (model) => {
        if (model === "gemini-2.5-flash") {
          const err = new Error("PERMISSION_DENIED: API key not valid");
          (err as any).status = 403;
          throw err;
        }
        secondModelCalled = true;
        return "Should never reach here";
      })
    ).rejects.toThrow("PERMISSION_DENIED");

    expect(secondModelCalled).toBe(false);
  });

  it("throws last error when all models in the fallback chain fail", async () => {
    const models = ["gemini-2.5-flash", "gemini-2.0-flash"];

    expect(
      executeWithModelFallback(models, async (model) => {
        const err = new Error(`503 Service Unavailable for ${model}`);
        (err as any).status = 503;
        throw err;
      })
    ).rejects.toThrow("503 Service Unavailable");
  });

  it("correctly identifies fallback-eligible vs non-eligible errors", () => {
    expect(isFallbackEligibleError({ status: 429, message: "Too many requests" })).toBe(true);
    expect(isFallbackEligibleError({ status: 503, message: "Unavailable" })).toBe(true);
    expect(isFallbackEligibleError({ message: "model gemini-3.5 not found" })).toBe(true);
    expect(isFallbackEligibleError({ status: 401, message: "Unauthorized" })).toBe(false);
    expect(isFallbackEligibleError({ status: 403, message: "Permission Denied" })).toBe(false);
    expect(isFallbackEligibleError({ status: 400, message: "Bad Request" })).toBe(false);
  });
});

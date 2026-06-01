import { describe, expect, it } from "vitest";
import { formatReviewPeriodLabel } from "./utils";

describe("formatReviewPeriodLabel", () => {
  it("shows the historical end date for a past review period", () => {
    const reviewEndAt = new Date("2026-04-03T09:00:00.000Z");
    const nowMs = new Date("2026-04-04T09:00:00.000Z").getTime();

    expect(formatReviewPeriodLabel({ reviewEndAt }, nowMs)).toBe(
      "Ended (Apr 3, 2026, 3:00 AM)",
    );
  });

  it("shows the countdown for a future review period", () => {
    const reviewEndAt = new Date("2026-04-03T09:00:00.000Z");
    const nowMs = new Date("2026-04-03T08:15:00.000Z").getTime();

    expect(formatReviewPeriodLabel({ reviewEndAt }, nowMs)).toBe(
      "45m (Apr 3, 2026, 3:00 AM)",
    );
  });

  it("shows no expiration when the version has no review end date", () => {
    expect(formatReviewPeriodLabel({ reviewEndAt: null }, Date.now())).toBe(
      "No expiration",
    );
  });
});

import { describe, expect, it } from "vitest";
import { nextAction, statuses, topics } from "../tickets";

describe("tickets domain helpers", () => {
  it("maps topic and status ids to human labels", () => {
    expect(topics.access).toBe("Проблема с доступом");
    expect(statuses.in_progress).toBe("В работе");
  });

  it("admin accepts new tickets without a required comment", () => {
    expect(nextAction("admin", "new")).toMatchObject({ status: "in_progress", required: false });
  });

  it("admin completes in-progress tickets and requires a result", () => {
    expect(nextAction("admin", "in_progress")).toMatchObject({ status: "done", required: true });
  });

  it("user can only reopen completed tickets with a reason", () => {
    expect(nextAction("user", "done")).toMatchObject({ status: "in_progress", required: true });
    expect(nextAction("user", "new")).toBeNull();
    expect(nextAction("admin", "done")).toBeNull();
  });
});

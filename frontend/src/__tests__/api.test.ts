import { afterEach, describe, expect, it, vi } from "vitest";
import { request } from "../api";

afterEach(() => vi.unstubAllGlobals());
describe("API failure handling", () => {
  it("surfaces business errors without treating them as success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Статус уже изменился" }), { status: 409 })));
    await expect(request("/admin/tickets/1/status", { status: "done", comment: "Готово" })).rejects.toThrow("Статус уже изменился");
  });
  it("handles proxy HTML during a notification outage", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Bad Gateway", { status: 502 })));
    await expect(request("/notifications")).rejects.toThrow("Сервис временно недоступен");
  });
  it("handles network failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(request("/user/tickets")).rejects.toThrow("Нет соединения");
  });
});

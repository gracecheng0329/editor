import { createHmac, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

function capability(room: string, role: "owner" | "viewer") {
  const secret = process.env.G0_TEST_SECRET;
  if (!secret) throw new Error("G0_TEST_SECRET is required");
  const payload = Buffer.from(JSON.stringify({ room, role, generation: 0, exp: Math.floor(Date.now() / 1000) + 300 })).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

test("TV-02: viewer's forged WebSocket write is discarded and owner reopens unchanged content", async ({ browser }) => {
  const room = randomUUID();
  const ownerContext = await browser.newContext();
  const viewerContext = await browser.newContext();
  try {
    const owner = await ownerContext.newPage();
    const viewer = await viewerContext.newPage();
    let forgedFramesSent = 0;
    viewer.on("websocket", (socket) => socket.on("framesent", ({ payload }) => {
      // Observe that the attack left the browser, without depending on SDK protocol fields.
      if (payload.toString().includes("FORGED-TV02")) forgedFramesSent++;
    }));
    await owner.goto(`/g0?room=${room}#${capability(room, "owner")}`);
    await expect(owner.getByLabel("同步狀態")).toHaveText("online");
    await owner.getByRole("button", { name: "新增節點", exact: true }).click();
    await expect(owner.getByLabel("物件數")).toHaveText("1");

    await viewer.goto(`/g0?room=${room}#${capability(room, "viewer")}`);
    await expect(viewer.getByLabel("物件數")).toHaveText("1");
    await viewer.getByRole("button", { name: "嘗試未授權寫入" }).click();
    await expect.poll(() => forgedFramesSent).toBeGreaterThan(0);
    // A reverted optimistic edit proves the server processed the attempted write.
    await expect(viewer.getByLabel("物件數")).toHaveText("1");
    await expect(viewer.getByLabel("節點內容")).not.toContainText("FORGED-TV02");

    await owner.reload();
    await expect(owner.getByLabel("同步狀態")).toHaveText("online");
    await expect(owner.getByLabel("物件數")).toHaveText("1");
    await expect(owner.getByLabel("節點內容")).toHaveText("OWNER-TV02");
    await expect(viewer.getByLabel("存取模式")).toHaveText("唯讀");
    await expect(viewer.getByRole("button", { name: "新增節點", exact: true })).toBeDisabled();
  } finally {
    await ownerContext.close();
    await viewerContext.close();
  }
});

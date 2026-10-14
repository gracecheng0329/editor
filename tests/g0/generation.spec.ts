import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { openCollaborator } from "./helpers";

test("TV-05b: restore rejects old-generation writes and retains the live page's pending content", async ({ browser, request }) => {
  const owner = await openCollaborator(browser);
  const online = await openCollaborator(browser, owner.room);
  let offline;
  const origin = { Origin: "http://127.0.0.1:3100" };
  try {
    await owner.add("RESTORE-TARGET");
    await expect(online.page.getByLabel("節點內容")).toHaveText("RESTORE-TARGET");
    await owner.page.getByRole("button", { name: "建立權威快照" }).click();
    await expect(owner.page.getByLabel("保存狀態")).toHaveText("已確認持久化");
    const versionId = await owner.page.getByLabel("版本ID").textContent();
    offline = await openCollaborator(browser, owner.room);
    await expect(offline.page.getByLabel("物件數")).toHaveText("1");
    await offline.disconnect();
    await offline.add("PENDING-OLD");
    await owner.add("PRE-RESTORE");
    await expect(online.page.getByLabel("節點內容")).toHaveText("PRE-RESTORE,RESTORE-TARGET");
    await owner.page.getByRole("button", { name: "建立權威快照" }).click();
    await expect(owner.page.getByLabel("保存狀態")).toHaveText("已確認持久化");

    const operationId = randomUUID();
    const restoreUrl = `http://127.0.0.1:8787/rooms/${owner.room}/restore?token=${owner.token}`;
    const restored = await request.post(restoreUrl, { headers: origin, data: { versionId, operationId } });
    expect(restored.status()).toBe(200);
    const outcome = await restored.json();
    expect(outcome.generation).toBe(1);
    expect(outcome.preRestoreId).toBeTruthy();
    // An online old connection must also stop, not keep writing to the replacement canvas.
    await expect(owner.page.getByLabel("世代衝突")).toBeVisible();
    await expect(online.page.getByLabel("世代衝突")).toBeVisible();
    await offline.reconnect();
    await expect(offline.page.getByLabel("世代衝突")).toHaveText("世代已變更，待同步內容已保留");
    await expect(offline.page.getByLabel("節點內容")).toHaveText("PENDING-OLD,RESTORE-TARGET");
    await expect(offline.page.getByRole("button", { name: "新增節點", exact: true })).toBeDisabled();
    const [download] = await Promise.all([
      offline.page.waitForEvent("download"),
      offline.page.getByRole("button", { name: "下載保留內容" }).click(),
    ]);
    const stream = await download.createReadStream();
    if (!stream) throw new Error("Missing retained-content download");
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const exported = Buffer.concat(chunks).toString("utf8");
    const backup = JSON.parse(exported);
    expect(backup.sourceRoom).toBe(owner.room);
    expect(backup.generation).toBe(0);
    expect(backup.labels).toEqual(["PENDING-OLD", "RESTORE-TARGET"]);
    expect(exported).toContain("PENDING-OLD");

    const refused = await request.get(`http://127.0.0.1:8787/rooms/${owner.room}?token=${offline.token}&sessionId=${randomUUID()}`, {
      headers: { ...origin, Upgrade: "websocket", Connection: "Upgrade", "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": Buffer.from(randomUUID().slice(0, 16)).toString("base64") },
    });
    expect(refused.status()).toBe(409);
    expect((await refused.json()).code).toBe("GENERATION_MISMATCH");
    const retry = await request.post(restoreUrl, { headers: origin, data: { versionId, operationId } });
    expect(retry.status()).toBe(200);
    expect(await retry.json()).toEqual(outcome);

    const current = await openCollaborator(browser, owner.room, "owner", 1);
    try {
      await expect(current.page.getByLabel("節點內容")).toHaveText("RESTORE-TARGET");
      const before = await request.get(`http://127.0.0.1:8787/rooms/${owner.room}/snapshots/${outcome.preRestoreId}?token=${current.token}`, { headers: origin });
      expect(before.status()).toBe(200);
      expect((await before.json()).labels).toEqual(["PRE-RESTORE", "RESTORE-TARGET"]);
    } finally { await current.context.close(); }
    await owner.context.close();
    await online.context.close();
    await offline.context.close();
    const restart = await request.post("http://127.0.0.1:8788/restart", { headers: { Authorization: `Bearer ${process.env.G0_TEST_SECRET}` } });
    expect(restart.status()).toBe(200);
    const reopened = await openCollaborator(browser, owner.room, "owner", 1);
    try { await expect(reopened.page.getByLabel("節點內容")).toHaveText("RESTORE-TARGET"); }
    finally { await reopened.context.close(); }
  } finally { await owner.context.close(); await online.context.close(); await offline?.context.close(); }
});

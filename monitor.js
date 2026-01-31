import { chromium } from "playwright";
import fs from "fs";
import fetch from "node-fetch";
import { login } from "./login.js";

const WEBHOOK_URL = "https://discord.com/api/webhooks/1462854392570183702/fNoEyNK3qJ8XqEovBjL76rTn3WZoIU_Rpv5b5j5aVRLXACg3wB1PqMLjyg4P7E5R7MVd";
const CHECK_INTERVAL = 30_000; // 30 сек
const NOTIFIED_FILE = "./notified_ids.json";

if (!fs.existsSync(NOTIFIED_FILE)) {
  fs.writeFileSync(NOTIFIED_FILE, JSON.stringify([]));
}

const notifiedIds = new Set(JSON.parse(fs.readFileSync(NOTIFIED_FILE, "utf8")));

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  await login(page);

  console.log("✅ Бот запущен и мониторит жалобы");

  while (true) {
    try {
      await page.goto("https://grnd.gg/admin/complaints", { waitUntil: "networkidle" });

      const complaints = await page.$$eval(".complaint", els =>
        els.map(el => ({ id: el.getAttribute("data-id"), text: el.innerText }))
      );

      for (const c of complaints) {
        if (notifiedIds.has(c.id)) continue;

        await fetch(WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: `🚨 **Новая жалоба**\n\`\`\`\n${c.text}\n\`\`\`` })
        });

        notifiedIds.add(c.id);
        fs.writeFileSync(NOTIFIED_FILE, JSON.stringify([...notifiedIds], null, 2));
      }

    } catch (err) {
      console.error("❌ Ошибка:", err.message);
    }

    await new Promise(r => setTimeout(r, CHECK_INTERVAL));
  }
})();
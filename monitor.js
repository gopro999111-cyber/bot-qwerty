import { chromium } from "playwright";
import fs from "fs";
import fetch from "node-fetch";

const WEBHOOK_URL =
  "https://discord.com/api/webhooks/1462854392570183702/fNoEyNK3qJ8XqEovBjL76rTn3WZoIU_Rpv5b5j5aVRLXACg3wB1PqMLjyg4P7E5R7MVd";

const CHECK_INTERVAL = 30_000; // 30 сек
const NOTIFIED_FILE = "./notified_ids.json";

// создаём файл с уведомлёнными ID, если его нет
if (!fs.existsSync(NOTIFIED_FILE)) {
  fs.writeFileSync(NOTIFIED_FILE, JSON.stringify([]));
}

const notifiedIds = new Set(
  JSON.parse(fs.readFileSync(NOTIFIED_FILE, "utf8"))
);

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  // --- Логинимся через auth.json или переменные окружения ---
  const AUTH_FILE = "./auth.json";
  if (fs.existsSync(AUTH_FILE)) {
    console.log("🔐 Использую сохранённую сессию");
    const cookies = JSON.parse(fs.readFileSync(AUTH_FILE));
    await context.addCookies(cookies);
  } else {
    console.log("🔑 Логин в Discord");

    await page.goto("https://discord.com/login");
    await page.fill('input[name="email"]', process.env.DISCORD_EMAIL);
    await page.fill('input[name="password"]', process.env.DISCORD_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForTimeout(10_000);

    const cookies = await context.cookies();
    fs.writeFileSync(AUTH_FILE, JSON.stringify(cookies, null, 2));
    console.log("✅ Сессия сохранена");
  }

  console.log("✅ Бот запущен и мониторит жалобы 24/7");

  while (true) {
    try {
      await page.goto("https://grnd.gg/admin/complaints", {
        waitUntil: "networkidle"
      });

      // === берём жалобы так же, как в расширении ===
      const complaints = await page.$$eval(
        ".table-component-index table tbody tr",
        rows =>
          rows
            .map(row => {
              const tds = row.querySelectorAll("td");
              if (tds.length < 4) return null;
              return {
                id: tds[0].innerText.trim(),
                from: tds[1].innerText.trim(),
                on: tds[2].innerText.trim(),
                date: tds[3].innerText.trim()
              };
            })
            .filter(Boolean)
      );

      console.log(`Найдено жалоб: ${complaints.length}`);

      for (const c of complaints) {
        if (notifiedIds.has(c.id)) continue;

        await fetch(WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: `🚨 **Новая жалоба**\n<@865670632847048708> <@1257048208891449346> <@1204869793791086665>`,
            allowed_mentions: {
              users: [
                "1466921240718606418"
              ]
            },
            embeds: [
              {
                title: "🚨 Новая жалоба",
                color: 15158332,
                fields: [
                  { name: "ID", value: `#${c.id}`, inline: true },
                  { name: "От", value: c.from || "—", inline: true },
                  { name: "На", value: c.on || "—", inline: true },
                  { name: "Дата", value: c.date || "—" }
                ],
                footer: { text: "grnd.gg • admin panel" },
                timestamp: new Date().toISOString()
              }
            ]
          })
        });

        notifiedIds.add(c.id);
        fs.writeFileSync(
          NOTIFIED_FILE,
          JSON.stringify([...notifiedIds], null, 2)
        );
      }
    } catch (err) {
      console.error("❌ Ошибка:", err.message);
    }

    await new Promise(r => setTimeout(r, CHECK_INTERVAL));
  }
})();

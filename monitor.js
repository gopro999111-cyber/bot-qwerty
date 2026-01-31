import { chromium } from "playwright";
import fs from "fs";
import fetch from "node-fetch";

// ====== НАСТРОЙКИ ======
const URL = "https://grnd.gg/admin/complaints";
const CHECK_INTERVAL = 30_000; // 30 секунд
const STORAGE_FILE = "notified_ids.json";
const DEBUG_HTML = "debug.html";

// ====== DISCORD ======
const DISCORD_WEBHOOK =
  "https://discord.com/api/webhooks/1462854392570183702/fNoEyNK3qJ8XqEovBjL76rTn3WZoIU_Rpv5b5j5aVRLXACg3wB1PqMLjyg4P7E5R7MVd";

const DISCORD_USER_IDS = [
  "1466921240718606418"
];

// ====== ЗАГРУЗКА ID ======
const notified = fs.existsSync(STORAGE_FILE)
  ? new Set(JSON.parse(fs.readFileSync(STORAGE_FILE, "utf8")))
  : new Set();

function saveNotified() {
  fs.writeFileSync(STORAGE_FILE, JSON.stringify([...notified], null, 2));
}

// ====== DISCORD SEND ======
async function sendDiscord(c) {
  await fetch(DISCORD_WEBHOOK, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content: DISCORD_USER_IDS.map(id => `<@${id}>`).join(" "),
      allowed_mentions: { users: DISCORD_USER_IDS },
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
}

// ====== MAIN ======
(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  const context = await browser.newContext({
    storageState: "auth.json"
  });

  const page = await context.newPage();

  console.log("🤖 Бот запущен, мониторинг начат");

  const firstRun = notified.size === 0;
  if (firstRun) console.log("🚀 Первый запуск — отправляю все существующие жалобы");

  while (true) {
    try {
      await page.goto(URL, { waitUntil: "networkidle" });

      // ждём таблицу с жалобами (до 15 секунд)
      await page.waitForSelector(".table-component-index table tbody tr", { timeout: 15_000 }).catch(() => {});

      // сохраняем HTML для отладки
      fs.writeFileSync(DEBUG_HTML, await page.content());

      const complaints = await page.evaluate(() => {
        return [...document.querySelectorAll(
          ".table-component-index table tbody tr"
        )]
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
          .filter(Boolean);
      });

      console.log(`Найдено жалоб: ${complaints.length}`);

      let sent = 0;

      for (const c of complaints) {
        if (notified.has(c.id) && !firstRun) continue; // если не первый запуск — только новые

        await sendDiscord(c);
        notified.add(c.id);
        sent++;
      }

      if (sent > 0) {
        saveNotified();
        console.log(`✅ Отправлено жалоб: ${sent}`);
      } else {
        console.log("⏳ Новых жалоб нет");
      }

    } catch (err) {
      console.error("❌ Ошибка:", err.message);
    }

    // после первого цикла больше не первый запуск
    firstRun && (firstRun = false);

    await new Promise(r => setTimeout(r, CHECK_INTERVAL));
  }
})();

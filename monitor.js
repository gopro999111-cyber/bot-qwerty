import { chromium } from "playwright";
import fs from "fs";
import fetch from "node-fetch";

// ====== НАСТРОЙКИ ======
const URL = "https://grnd.gg/admin/complaints";
const CHECK_INTERVAL = 30_000; // 30 секунд
const STORAGE_FILE = "notified_ids.json";

// ====== DISCORD ======
const DISCORD_WEBHOOK =
  "https://discord.com/api/webhooks/1462854392570183702/fNoEyNK3qJ8XqEovBjL76rTn3WZoIU_Rpv5b5j5aVRLXACg3wB1PqMLjyg4P7E5R7MVd";

const DISCORD_USER_IDS = [
  "865670632847048708",
  "1257048208891449346",
  "1204869793791086665"
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

// ====== ИЗВЛЕЧЕНИЕ ЖАЛОБ ======
async function getComplaints(page) {
  await page.waitForSelector(".table-component-index table");

  const complaints = await page.evaluate(() => {
    return [...document.querySelectorAll(
      ".table-component-index table tbody tr"
    )].map(row => {
      const tds = row.querySelectorAll("td");
      if (tds.length < 4) return null;

      return {
        id: tds[0].innerText.trim(),
        from: tds[1].innerText.trim(),
        on: tds[2].innerText.trim(),
        date: tds[3].innerText.trim()
      };
    }).filter(Boolean);
  });

  return complaints;
}

// ====== MAIN ======
(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    storageState: "auth.json"
  });

  const page = await context.newPage();

  console.log("🤖 Бот запущен, мониторинг начат");

  while (true) {
    try {
      await page.goto(URL, { waitUntil: "networkidle" });

      const complaints = await getComplaints(page);

      let sent = 0;
      for (const c of complaints) {
        if (notified.has(c.id)) continue;

        await sendDiscord(c);
        notified.add(c.id);
        sent++;
      }

      if (sent > 0) {
        saveNotified();
        console.log(`✅ Отправлено новых жалоб: ${sent}`);
      } else {
        console.log("⏳ Новых жалоб нет");
      }
    } catch (err) {
      console.error("❌ Ошибка:", err.message);
    }

    // ждем перед следующим обновлением страницы
    await new Promise(r => setTimeout(r, CHECK_INTERVAL));
  }
})();

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

// ====== БЕЗОПАСНОСТЬ ПРОЦЕССА (чтобы Railway не убивал из-за unhandled) ======
process.on("unhandledRejection", err => {
  console.error("❌ UNHANDLED REJECTION:", err?.stack || err);
});
process.on("uncaughtException", err => {
  console.error("❌ UNCAUGHT EXCEPTION:", err?.stack || err);
});

// ====== ЗАГРУЗКА ID ======
const notified = fs.existsSync(STORAGE_FILE)
  ? new Set(JSON.parse(fs.readFileSync(STORAGE_FILE, "utf8")))
  : new Set();

function saveNotified() {
  fs.writeFileSync(STORAGE_FILE, JSON.stringify([...notified], null, 2));
}

// ====== DISCORD SEND (с проверкой статуса и ретраями) ======
async function sendDiscord(c) {
  const payload = {
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
  };

  for (let attempt = 1; attempt <= 5; attempt++) {
    const res = await fetch(DISCORD_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      return; // ✅ отправлено
    }

    // ⚠️ Rate limit
    if (res.status === 429) {
      // discord может вернуть retry-after в секундах
      const retryAfterHeader = res.headers.get("retry-after");
      const retryAfterMs = retryAfterHeader
        ? Math.ceil(Number(retryAfterHeader) * 1000)
        : 3000;

      console.warn(`⚠️ Discord 429 (attempt ${attempt}/5), жду ${retryAfterMs}ms`);
      await new Promise(r => setTimeout(r, retryAfterMs));
      continue;
    }

    // ❌ Любая другая ошибка — логируем и падаем в catch выше
    const text = await res.text().catch(() => "");
    throw new Error(
      `Discord webhook error ${res.status} ${res.statusText}: ${text}`.slice(0, 800)
    );
  }

  throw new Error("Discord webhook failed after retries (429)");
}

// ====== ИЗВЛЕЧЕНИЕ ЖАЛОБ ======
async function getComplaints(page) {
  await page.waitForSelector(".table-component-index table", { timeout: 15000 });

  const complaints = await page.evaluate(() => {
    return [...document.querySelectorAll(".table-component-index table tbody tr")]
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
      console.log(`📄 Найдено жалоб на странице: ${complaints.length}`);

      let sent = 0;

      for (const c of complaints) {
        if (!c?.id) continue;
        if (notified.has(c.id)) continue;

        // ВАЖНО: notified.add только после успешной отправки
        await sendDiscord(c);
        notified.add(c.id);
        sent++;

        // Небольшая пауза, чтобы меньше упираться в лимиты
        await new Promise(r => setTimeout(r, 400));
      }

      if (sent > 0) {
        saveNotified();
        console.log(`✅ Отправлено новых жалоб: ${sent}`);
      } else {
        console.log("⏳ Новых жалоб нет");
      }
    } catch (err) {
      console.error("❌ Ошибка:", err?.message || err);
    }

    await new Promise(r => setTimeout(r, CHECK_INTERVAL));
  }
})();

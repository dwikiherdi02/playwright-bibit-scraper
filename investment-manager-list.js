/**
 * Bibit Reksadana Scraper — Playwright
 * Mendapatkan semua data tabel dengan pagination otomatis
 *
 * Install deps:
 *   npm install playwright
 *   npx playwright install chromium
 */

const { chromium } = require("playwright");
const fs = require("fs");

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const BASE_URL =
  // "https://bibit.id/reksadana?limit=20&page={PAGE}&sort=asc&sort_by=7&tradable=1&syariah=1";
  "https://bibit.id/reksadana?limit=20&page={PAGE}&sort=asc&sort_by=7&tradable=1&syariah=1&type=3%2C2%2C1";

const COLUMNS = [
  "im_name",
  "im_type",
  "1d",
  "1m",
  "3m",
  "ytd",
  "1y",
  "3y",
  "5y",
  "10y",
  "last_nav",
  "drawdown_1y",
  "aum",
];

// ─── HELPERS ─────────────────────────────────────────────────────────────────

/**
 * Tunggu hingga tabel selesai dimuat (tidak ada skeleton/loading indicator)
 */
async function waitForTableReady(page) {
  // Tunggu elemen tabel muncul
  await page.waitForSelector("table tbody tr", { timeout: 15_000 });

  // Tunggu hingga tidak ada loading spinner (sesuaikan selector jika perlu)
  await page
    .waitForSelector(".loading, .skeleton, .RoboLoader", {
      state: "hidden",
      timeout: 5_000,
    })
    .catch(() => {}); // Abaikan jika selector tidak ada
}

/**
 * Scrape satu halaman tabel
 * @returns {Array<Object>} Array of row data
 */
async function scrapePage(page) {
  await waitForTableReady(page);

  const rows = await page.evaluate((columns) => {
    const results = [];
    const tableRows = document.querySelectorAll("table tbody tr");

    tableRows.forEach((row) => {
      const cells = row.querySelectorAll("td");
      if (cells.length < 3) return; // Skip header/empty rows

      const obj = {};
      cells.forEach((cell, index) => {
        const key = columns[index] ?? `col_${index}`;
        obj[key] = cell.innerText.trim();
      });

      // Tambahkan href link produk jika ada
      const link = row.querySelector("a");
      if (link) obj.url = link.href;

      results.push(obj);
    });

    return results;
  }, COLUMNS);

  return rows;
}

/**
 * Ambil total halaman dari pagination info
 * Contoh text: "1 - 20 dari 35" → totalItems=35, perPage=20 → 2 halaman
 */
async function getTotalPages(page) {
  try {
    const paginationText = await page.textContent(
      'div[class*="PaginationReksaDana-module"][class*="limit-section"] p',
      { timeout: 5_000 }
    );
    /*const paginationText = await page.locator(
      'div[class*="PaginationReksaDana-module"][class*="limit-section"] p'
    ).textContent();*/

    // Parse "1 - 20 dari 35" atau "1-20 of 35"
    const match = paginationText.match(/dari\s+(\d+)|of\s+(\d+)/i);
    if (match) {
      const total = parseInt(match[1] || match[2]);
      const perPage = 20; // Sesuai parameter limit=20
      return Math.ceil(total / perPage);
    }
  } catch {
    // Fallback: cek tombol "next" ada atau tidak
  }
  return 1;
}

// ─── STRATEGI PAGINATION ─────────────────────────────────────────────────────

/**
 * STRATEGI 1: URL-based pagination (paling handal)
 * Ganti parameter ?page= di URL
 */
async function scrapeAllPages_UrlStrategy(browser) {
  const page = await browser.newPage();
  const allData = [];

  // Buka halaman pertama untuk dapat total halaman
  await page.goto(BASE_URL.replace("{PAGE}", "1"), {
    waitUntil: "networkidle",
  });

  const totalPages = await getTotalPages(page);
  console.log(`📄 Total halaman ditemukan: ${totalPages}`);

  for (let currentPage = 1; currentPage <= totalPages; currentPage++) {
    console.log(`⏳ Scraping halaman ${currentPage}/${totalPages}...`);

    if (currentPage > 1) {
      await page.goto(BASE_URL.replace("{PAGE}", currentPage), {
        waitUntil: "networkidle",
      });
    }

    const rows = await scrapePage(page);
    allData.push(...rows);
    console.log(`   ✅ ${rows.length} baris ditemukan`);

    // Delay sopan agar tidak overload server (rate limiting)
    await page.waitForTimeout(800 + Math.random() * 400);
  }

  await page.close();
  return allData;
}

/**
 * STRATEGI 2: Click-based pagination
 * Cocok jika URL tidak berubah saat klik tombol next
 */
async function scrapeAllPages_ClickStrategy(browser) {
  const page = await browser.newPage();
  const allData = [];

  await page.goto(BASE_URL.replace("{PAGE}", "1"), {
    waitUntil: "networkidle",
  });

  let pageNum = 1;

  while (true) {
    console.log(`⏳ Scraping halaman ${pageNum}...`);

    const rows = await scrapePage(page);
    allData.push(...rows);
    console.log(`   ✅ ${rows.length} baris`);

    // Cari tombol "Next" / "›" / "2"
    /*const nextBtn = await page
      .$(
        '[aria-label="Next"], button:has-text("›"), [class*="next"]:not([disabled])'
      )
      .catch(() => null);*/
    const nextBtn = await page
      .$('button[class*="pagination-button"]:not([disabled]):has(polyline[points="9 18 15 12 9 6"])')
      .catch(() => null);

    if (!nextBtn) {
      console.log("🏁 Tidak ada halaman berikutnya, selesai.");
      break;
    }

    // Cek apakah tombol disabled
    const isDisabled = await nextBtn.evaluate(
      (el) => el.disabled || el.getAttribute("aria-disabled") === "true"
    );
    if (isDisabled) break;

    await nextBtn.click();
    await page.waitForTimeout(1000); // Tunggu data load
    pageNum++;
  }

  await page.close();
  return allData;
}

/**
 * STRATEGI 3: Intercept Network Request (paling efisien)
 * Langsung ambil JSON dari API yang dipanggil oleh browser
 */
async function scrapeViaNetworkIntercept(browser) {
  const page = await browser.newPage();
  const apiResponses = [];

  // Intercept response dari endpoint API reksadana
  page.on("response", async (response) => {
    const url = response.url();

    // Sesuaikan pattern URL API Bibit
    if (url.includes("/api/") && url.includes("reksadana")) {
      try {
        const json = await response.json();
        apiResponses.push(json);
        console.log(`📡 API response ditangkap: ${url}`);
      } catch {
        // Bukan JSON, abaikan
      }
    }
  });

  // Load halaman — browser otomatis panggil API
  await page.goto(BASE_URL.replace("{PAGE}", "1"), {
    waitUntil: "networkidle",
  });

  await page.close();
  return apiResponses; // Raw JSON dari API
}

// ─── OPTIMIZED FORMAT ────────────────────────────────────────────────────────

const SCHEMA = [...COLUMNS, "url"];

/**
 * Konversi array of objects ke format schema-extracted untuk efisiensi token.
 * Schema hanya ditulis 1x, data disimpan sebagai array of arrays.
 */
function toOptimizedFormat(data) {
  return {
    schema: SCHEMA,
    data: data.map((row) => SCHEMA.map((key) => row[key] ?? null)),
  };
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  const isOptimized = process.argv.includes("--optimized");

  console.log("🚀 Memulai Bibit Reksadana Scraper...\n");
  if (isOptimized) console.log("📦 Mode: schema-extracted (optimized)\n");

  const browser = await chromium.launch({
    headless: true, // Set false untuk debug visual
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    // Pilih strategi (uncomment salah satu):
    // const data = await scrapeAllPages_UrlStrategy(browser);
    const data = await scrapeAllPages_ClickStrategy(browser);
    // const data = await scrapeViaNetworkIntercept(browser);  // Raw API JSON

    console.log(`\n✅ Total data terkumpul: ${data.length} produk reksadana`);

    const outputJson = isOptimized
      ? "output_im_list_optimized.json"
      : "output_im_list.json";

    const outputData = isOptimized ? toOptimizedFormat(data) : data;
    fs.writeFileSync(outputJson, JSON.stringify(outputData, null, 2), "utf-8");
    console.log(`💾 Disimpan ke: ${outputJson}`);
  } finally {
    await browser.close();
  }
}

main().catch(console.error);

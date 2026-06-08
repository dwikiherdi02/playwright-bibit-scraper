/**
 * Bibit Reksadana Detail Scraper — Playwright
 * Mengambil data detail setiap produk reksadana dari output_im_list.json
 *
 * Usage:
 *   node investment-manager-detail.js
 *
 * Output:
 *   output_im_detail.json
 */

const { chromium } = require("playwright");
const fs = require("fs");

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const INPUT_FILE = "output_im_list.json";
const OUTPUT_FILE = "output_im_detail.json";
const MAX_RETRIES = 3;
const DELAY_MIN_MS = 1000;
const DELAY_MAX_MS = 1500;

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function randomDelay(min, max) {
  return min + Math.random() * (max - min);
}

/**
 * Tunggu hingga halaman detail selesai dimuat
 */
async function waitForDetailReady(page) {
  // Tunggu stat card header (Total AUM / NAV) muncul
  await page.waitForSelector('[class*="StatCard"], [class*="stat-card"], [class*="Stats"]', {
    timeout: 20_000,
  }).catch(async () => {
    // Fallback: tunggu saja elemen umum halaman
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
  });

  // Tunggu loading spinner hilang
  await page
    .waitForSelector(".loading, .skeleton, .RoboLoader, [class*='skeleton'], [class*='Skeleton']", {
      state: "hidden",
      timeout: 8_000,
    })
    .catch(() => {});

  // Sedikit buffer agar JS selesai render
  await page.waitForTimeout(800);
}

/**
 * Ambil teks dari elemen berdasarkan selector, return null jika tidak ditemukan
 */
async function getText(page, selector) {
  try {
    const el = await page.$(selector);
    if (!el) return null;
    return (await el.innerText()).trim() || null;
  } catch {
    return null;
  }
}

/**
 * Scrape semua data detail dari halaman yang sudah dibuka
 * @returns {Object} Detail data dengan English keys
 */
async function scrapeDetailPage(page) {
  const data = await page.evaluate(() => {
    const result = {};

    // ── Utility ──────────────────────────────────────────────────────────────

    /**
     * Ambil hanya teks dari direct text node sebuah elemen (tidak termasuk teks dari child elements).
     * Digunakan untuk mendeteksi label yang punya img/icon sibling (mis. "Total AUM ⓘ").
     */
    function getDirectText(el) {
      return Array.from(el.childNodes)
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent.trim())
        .filter(Boolean)
        .join(" ");
    }

    /**
     * Cocokkan label text ke sebuah elemen DOM.
     * Menangani dua kasus:
     * 1. Elemen leaf murni (children.length === 0) → cocokkan innerText
     * 2. Elemen dengan direct text + img/icon children → cocokkan getDirectText
     */
    function matchesLabel(el, labelText) {
      const lower = labelText.toLowerCase();
      if (el.children.length === 0) {
        return (el.innerText?.trim().toLowerCase() ?? "") === lower;
      }
      return getDirectText(el).toLowerCase() === lower;
    }

    /**
     * Cari nilai setelah label teks tertentu di halaman.
     * Strategi: temukan elemen yang teksnya === labelText, lalu ambil sibling berikutnya
     * dari parent (tanpa filter children.length agar value container dengan nested anak tetap terpick).
     */
    function findValueByLabelText(labelText) {
      for (const el of document.querySelectorAll("*")) {
        if (!matchesLabel(el, labelText)) continue;

        const parent = el.parentElement;
        if (!parent) continue;

        const siblings = Array.from(parent.children);
        const idx = siblings.indexOf(el);
        if (idx !== -1 && siblings[idx + 1]) {
          const val = siblings[idx + 1].innerText?.trim();
          if (val) return val;
        }

        // Fallback: parent berikutnya
        const parentSibling = parent.nextElementSibling;
        if (parentSibling) {
          const val = parentSibling.innerText?.trim();
          if (val) return val;
        }
      }
      return null;
    }

    // ── Header Stats ─────────────────────────────────────────────────────────

    /**
     * Cari Total AUM, NAV, dan 1Y Return dari stat cards di header halaman.
     * Label-label ini punya img icon sibling, sehingga tidak bisa dideteksi
     * dengan filter children.length === 0 saja.
     */
    function scrapeHeaderStats() {
      return {
        totalAum: findValueByLabelText("Total AUM"),
        nav: findValueByLabelText("NAV"),
        return1y: findValueByLabelText("1Y Return"),
      };
    }

    const headerStats = scrapeHeaderStats();
    result.total_aum = headerStats.totalAum;
    result.nav = headerStats.nav;
    result.return_1y = headerStats.return1y;

    // ── Detail Produk ─────────────────────────────────────────────────────────

    /**
     * Scrape pasangan label-value dari section "Detail Produk".
     * Menggunakan findValueByLabelText yang sudah menangani label dengan img children.
     */
    function scrapeDetailProduk() {
      return {
        fund_type: findValueByLabelText("Jenis Reksa Dana"),
        risk_level: findValueByLabelText("Tingkat Resiko"),
        expense_ratio: findValueByLabelText("Expense Ratio"),
        launch_date: findValueByLabelText("Tanggal Peluncuran"),
        min_purchase: findValueByLabelText("Min. Pembelian"),
        min_redemption: findValueByLabelText("Min. Penjualan"),
        custodian_bank: findValueByLabelText("Bank Kustodian"),
        fund_bank: findValueByLabelText("Bank Penampung"),
      };
    }

    const detailProduk = scrapeDetailProduk();
    result.fund_type = detailProduk.fund_type ?? null;
    result.risk_level = detailProduk.risk_level ?? null;
    result.expense_ratio = detailProduk.expense_ratio ?? null;
    result.launch_date = detailProduk.launch_date ?? null;
    result.min_purchase = detailProduk.min_purchase ?? null;
    result.min_redemption = detailProduk.min_redemption ?? null;
    result.custodian_bank = detailProduk.custodian_bank ?? null;
    result.fund_bank = detailProduk.fund_bank ?? null;

    // ── Detail Biaya ──────────────────────────────────────────────────────────

    result.purchase_fee = findValueByLabelText("Biaya Pembelian") ?? null;
    result.redemption_fee = findValueByLabelText("Biaya Penjualan") ?? null;
    result.switching_fee = findValueByLabelText("Biaya Switching") ?? null;

    // ── Performa ──────────────────────────────────────────────────────────────

    /**
     * Scrape section Performa: label periode + nilai return.
     * Contoh: "1 Bulan" → "-1.14%", "1 Tahun" → "3.35%"
     *
     * Struktur DOM Bibit per row:
     *   div.row
     *     div: "1 Bulan"          ← label (leaf)
     *     div                     ← value container (punya children: figure + div)
     *       figure: arrow img
     *       div: "-23.11%"        ← nilai aktual
     *
     * Bug sebelumnya: filter siblings dengan children.length === 0 mengecualikan
     * value container → fallback ke allLeafEls[i+1] yang adalah label periode berikutnya.
     * Fix: gunakan siblings tanpa filter sehingga value container ikut dihitung.
     */
    function scrapePerforma() {
      const periodMap = {
        "1 bulan": "1m",
        "3 bulan": "3m",
        "ytd": "ytd",
        "1 tahun": "1y",
        "3 tahun": "3y",
        "5 tahun": "5y",
        "10 tahun": "10y",
      };

      const performance = {};

      // Hanya label-label periode yang merupakan leaf murni
      const allLeafEls = Array.from(document.querySelectorAll("*")).filter(
        (el) => el.children.length === 0 && el.innerText?.trim()
      );

      for (let i = 0; i < allLeafEls.length; i++) {
        const text = allLeafEls[i].innerText?.trim().toLowerCase();
        const key = periodMap[text];
        if (!key || performance[key]) continue;

        const parent = allLeafEls[i].parentElement;
        if (!parent) continue;

        // Gunakan siblings TANPA filter children.length agar value container ikut
        const siblings = Array.from(parent.children);
        const idx = siblings.indexOf(allLeafEls[i]);
        if (idx !== -1 && siblings[idx + 1]) {
          const val = siblings[idx + 1].innerText?.trim();
          if (val) {
            performance[key] = val;
            continue;
          }
        }
      }

      return performance;
    }

    result.performance = scrapePerforma();

    // ── Alokasi Aset ──────────────────────────────────────────────────────────

    /**
     * Scrape section Alokasi Aset: nama aset + persentase dari legenda.
     * Contoh: "Obligasi (93.05 %)", "Likuiditas (6.95 %)"
     */
    function scrapeAlokasiAset() {
      const allocations = [];
      const allLeafEls = Array.from(document.querySelectorAll("*")).filter(
        (el) => el.children.length === 0 && el.innerText?.trim()
      );

      for (const el of allLeafEls) {
        const text = el.innerText?.trim();
        const match = text.match(/^(.+?)\s*\((\d+(?:\.\d+)?\s*%)\)$/);
        if (match) {
          allocations.push({
            name: match[1].trim(),
            percentage: match[2].trim(),
          });
        }
      }

      return allocations;
    }

    result.asset_allocation = scrapeAlokasiAset();

    // ── Alokasi Efek Terbesar ─────────────────────────────────────────────────

    /**
     * Scrape section Alokasi Efek Terbesar: daftar efek + tanggal update.
     *
     * Struktur DOM Bibit:
     *   generic[e194]  ← outer section container
     *     generic[e195]  ← header row
     *       h4: "Alokasi Efek Terbesar"
     *       generic: "30 Apr 2026"   ← tanggal update
     *     generic[e198]  ← holdings list
     *       generic[e199]  ← satu holding row
     *         generic[e200]: "BANK"              ← kode ticker (child element)
     *         text node: "Bank Aladin Syariah..."  ← nama perusahaan (direct text node)
     *
     * Bug sebelumnya: pendekatan leaf-element melewatkan direct text node sebagai nama.
     * Fix: navigasi DOM struktural → innerText.split('\n') untuk pisahkan kode dan nama.
     */
    function scrapeAlokasiEfekTerbesar() {
      const holdings = [];
      let holdingsDate = null;

      // 1. Temukan h4 "Alokasi Efek Terbesar"
      const headingEl = Array.from(document.querySelectorAll("h4, h3, h2")).find(
        (h) => h.innerText?.trim() === "Alokasi Efek Terbesar"
      );

      if (!headingEl) return { holdings, holdingsDate };

      // 2. Navigasi: heading → headerRow → outer container → holdingsList
      const headerRow = headingEl.parentElement;       // e195: heading + tanggal
      const holdingsList = headerRow?.nextElementSibling; // e198: daftar holdings

      // 3. Ambil tanggal update dari headerRow
      const datePattern = /^\d{1,2}\s+[A-Za-z]{3}\s+\d{4}$/;
      if (headerRow) {
        for (const el of headerRow.querySelectorAll("*")) {
          if (el.children.length === 0 && datePattern.test(el.innerText?.trim())) {
            holdingsDate = el.innerText.trim();
            break;
          }
        }
      }

      // 4. Ambil holding rows dari holdingsList
      if (holdingsList) {
        for (const row of Array.from(holdingsList.children)) {
          const text = row.innerText?.trim();
          if (!text) continue;

          // Split per baris: baris pertama = kode ticker, sisanya = nama perusahaan
          const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
          if (lines.length === 0) continue;

          holdings.push({
            code: lines[0] || null,
            name: lines.length > 1 ? lines.slice(1).join(" ") : null,
          });
        }
      }

      return { holdings, holdingsDate };
    }

    const efekData = scrapeAlokasiEfekTerbesar();
    result.top_holdings_date = efekData.holdingsDate;
    result.top_holdings = efekData.holdings;

    return result;
  });

  return data;
}

// ─── RETRY WRAPPER ────────────────────────────────────────────────────────────

/**
 * Navigasi ke URL dan scrape detail, dengan retry otomatis hingga maxRetries kali
 */
async function scrapeWithRetry(page, url, imName, maxRetries = MAX_RETRIES) {
  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await waitForDetailReady(page);

      const detail = await scrapeDetailPage(page);
      return { url, im_name: imName, ...detail };
    } catch (err) {
      lastError = err;
      console.warn(
        `   ⚠️  Attempt ${attempt}/${maxRetries} gagal untuk "${imName}": ${err.message}`
      );

      if (attempt < maxRetries) {
        // Tunggu lebih lama sebelum retry
        await page.waitForTimeout(2000 * attempt);
      }
    }
  }

  console.error(`   ❌ Semua ${maxRetries} attempt gagal untuk "${imName}": ${lastError?.message}`);
  return { url, im_name: imName, error: lastError?.message ?? "Unknown error" };
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("🚀 Memulai Bibit Reksadana Detail Scraper...\n");

  // Baca input
  if (!fs.existsSync(INPUT_FILE)) {
    console.error(`❌ File input tidak ditemukan: ${INPUT_FILE}`);
    process.exit(1);
  }

  const inputData = JSON.parse(fs.readFileSync(INPUT_FILE, "utf-8"));
  const total = inputData.length;
  console.log(`📋 Total produk yang akan di-scrape: ${total}\n`);

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const results = [];
  let successCount = 0;
  let failCount = 0;

  try {
    const page = await browser.newPage();

    // Set user agent agar terlihat lebih natural
    await page.setExtraHTTPHeaders({
      "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
    });

    for (let i = 0; i < total; i++) {
      const item = inputData[i];
      const { url, im_name } = item;

      console.log(`⏳ [${i + 1}/${total}] Scraping: ${im_name}`);
      console.log(`   🔗 ${url}`);

      const detail = await scrapeWithRetry(page, url, im_name);
      results.push(detail);

      if (detail.error) {
        failCount++;
      } else {
        successCount++;
        console.log(`   ✅ Berhasil`);
      }

      // Rate limiting: delay antara request
      if (i < total - 1) {
        const delay = randomDelay(DELAY_MIN_MS, DELAY_MAX_MS);
        await page.waitForTimeout(delay);
      }
    }

    await page.close();
  } finally {
    await browser.close();
  }

  // Simpan hasil ke JSON (batch save)
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2), "utf-8");

  console.log(`\n${"─".repeat(60)}`);
  console.log(`✅ Selesai! ${successCount} berhasil, ${failCount} gagal.`);
  console.log(`💾 Hasil disimpan ke: ${OUTPUT_FILE}`);
}

main().catch((err) => {
  console.error("💥 Fatal error:", err);
  process.exit(1);
});

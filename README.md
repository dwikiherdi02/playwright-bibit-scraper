# Playwright Bibit Scraper

A Playwright-based web scraping tool to extract mutual fund data from **Bibit.id**, an Indonesian investment platform. This tool automates the process of collecting both fund list summaries and detailed fund specifications.

## Features

- **Two-stage scraping pipeline**:
  - Stage 1: Extracts list of Islamic mutual funds (Syariah-compliant) with pagination
  - Stage 2: Scrapes detailed information for each fund from the list
- Automated pagination handling
- Retry logic with configurable delays
- Robust DOM parsing with fallback strategies
- Filters for Syariah-compliant funds (tradable only)

## Installation

```bash
npm install
npx playwright install chromium
```

## Usage

### Stage 1: Scrape Fund List

Extracts summary data from the mutual fund listing page:

```bash
node investment-manager-list.js
```

**Output**: `output_im_list.json` containing:
- Fund name, type, NAV (Net Asset Value), AUM (Assets Under Management)
- Performance returns (1d, 1m, 3m, YTD, 1y, 3y, 5y, 10y)
- Drawdown metrics
- Product URLs for detail pages

### Stage 2: Scrape Fund Details

Extracts comprehensive details for each fund using URLs from Stage 1:

```bash
node investment-manager-detail.js
```

**Output**: `output_im_detail.json` containing:
- Fund specifications (type, risk level, expense ratio)
- Key dates (launch date)
- Transaction limits (minimum purchase/redemption)
- Banking details (custodian bank, fund bank)
- Fee structure (purchase, redemption, switching fees)
- Asset allocation breakdown
- Full performance history

## Configuration

### investment-manager-list.js
- `BASE_URL`: Bibit fund listing URL with pagination parameters
- `COLUMNS`: Array of data fields to extract

### investment-manager-detail.js
- `INPUT_FILE`: Path to the fund list JSON (default: `output_im_list.json`)
- `OUTPUT_FILE`: Path for the output JSON (default: `output_im_detail.json`)
- `MAX_RETRIES`: Number of retry attempts for failed requests
- `DELAY_MIN_MS` / `DELAY_MAX_MS`: Random delay range between requests

## Output Files

The scraper generates two JSON files:

- **`output_im_list.json`**: Array of fund summary objects
- **`output_im_detail.json`**: Array of detailed fund objects

## Notes

- The scraper targets Syariah-compliant, tradable funds only
- Delays are included to avoid overwhelming the target server
- Error handling includes fallback selectors and retry logic

## License

MIT

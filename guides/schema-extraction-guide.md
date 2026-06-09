# Schema Extraction untuk Optimasi Token

## Penjelasan
Schema extraction memisahkan struktur data (nama field) dari nilai data, menghemat token hingga 40-60% saat prompting.

## Format Original vs Optimized

### Original (Verbose)
```json
[
  {
    "im_name": "Bahana Likuid Syariah Kelas G",
    "im_type": "Pasar Uang",
    "1y": "4.64%",
    "aum": "0.57T"
  }
]
```
**Token count: ~35 tokens per record**

### Optimized (Schema Extraction)
```json
{
  "schema": ["im_name", "im_type", "1y", "aum"],
  "data": [
    ["Bahana Likuid Syariah Kelas G", "Pasar Uang", "4.64%", "0.57T"]
  ]
}
```
**Token count: ~15 tokens per record (setelah schema)**

## Keuntungan
- ✅ Hemat 40-60% token untuk dataset besar
- ✅ Schema hanya ditulis 1x untuk semua records
- ✅ Lebih mudah di-parse programmatically
- ✅ Tetap human-readable dengan bantuan schema

## Cara Menggunakan dalam Prompt

### Contoh Prompt:
```
Berikut data investment manager dalam format schema-extracted:

Schema: ["im_name", "im_type", "1y", "aum", "url"]
Data:
1. ["Bahana Likuid Syariah Kelas G", "Pasar Uang", "4.64%", "0.57T", "..."]
2. ["Bahana MES Syariah Fund Kelas G", "Obligasi", "3.35%", "121.40B", "..."]

Analisis performa 1 tahun dari kedua produk ini.
```

## File yang Sudah Dioptimasi
- `output_im_list_optimized.json` - List data dengan schema flat
- `output_im_detail_optimized.json` - Detail data dengan nested schema

## Konversi Kembali ke Format Original (JavaScript)

```javascript
// Untuk data flat (im_list)
function schemaToObjects(schemaData) {
  const { schema, data } = schemaData;
  return data.map(row => {
    const obj = {};
    schema.forEach((key, i) => {
      obj[key] = row[i];
    });
    return obj;
  });
}

// Untuk data nested (im_detail)
function schemaToObjectsNested(schemaData) {
  return schemaData.data.map(item => {
    const obj = {};
    
    // Convert main fields
    schemaData.schema.main.forEach((key, i) => {
      obj[key] = item.main[i];
    });
    
    // Convert performance
    const performance = {};
    schemaData.schema.performance.forEach((key, i) => {
      performance[key] = item.performance[i];
    });
    obj.performance = performance;
    
    // Convert asset_allocation
    obj.asset_allocation = item.asset_allocation.map(row => {
      const asset = {};
      schemaData.schema.asset_allocation.forEach((key, i) => {
        asset[key] = row[i];
      });
      return asset;
    });
    
    // Convert top_holdings
    obj.top_holdings_date = item.top_holdings_date;
    obj.top_holdings = item.top_holdings.map(row => {
      const holding = {};
      schemaData.schema.top_holdings.forEach((key, i) => {
        holding[key] = row[i];
      });
      return holding;
    });
    
    return obj;
  });
}
```

## Estimasi Penghematan Token

### output_im_list.json
- Original: ~150 tokens per record × 100 records = 15,000 tokens
- Optimized: 50 tokens (schema) + 60 tokens per record × 100 = 6,050 tokens
- **Hemat: ~60%**

### output_im_detail.json  
- Original: ~500 tokens per record
- Optimized: ~250 tokens per record
- **Hemat: ~50%**

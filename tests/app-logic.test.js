import { describe, it, expect, beforeEach } from "vitest";
import {
  STORAGE_KEY, PIE_COLORS,
  uid, fmtCOP, fmtCompactCOP, fmtDate, monthLabel, todayISO, escapeHtml,
  loadData, saveData, sanitizeAppData,
  computeMonthly, computeSummary,
  totalProducido, totalProducidoByOrdeno, computeMilkChartMax, findDuplicateMilkRecord,
  computeReport, computeProductionChartData, computeProductionChartMax,
  buildTransactionsCsv, buildBackupPayload, parseBackupData,
  parseTransactionForm, parseInventoryForm, parseMilkForm, parseCowForm,
  milkTransactionId, getLastMilkPrice, computeMilkSaleTransaction,
  syncMilkSaleTransaction, removeMilkSaleTransaction, applyInventoryRestock,
  COW_STATES, cowEstado, isProductionCow, milkFormCows, cowNetLitersForRecord, computeCowProfitability,
  HERD_EVENT_TYPES, parseHerdEventForm, summarizeHerd,
  LEVANTE_STATES, parseLevanteForm, levanteGanancia, computeLevanteProfit,
  levanteTransactionId, computeLevanteSaleTransaction, syncLevanteSaleTransaction, removeLevanteSaleTransaction,
} from "../app-logic.js";

function makeFakeStorage(){
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    _store: store,
  };
}

function makeGetValue(fields){
  return (name) => (name in fields ? fields[name] : null);
}

// ---------- Formatters ----------
describe("fmtCOP", () => {
  it("formats a positive amount as COP currency with no decimals", () => {
    expect(fmtCOP(1500000)).toBe("$ 1.500.000");
  });
  it("treats undefined/null/0 as zero", () => {
    expect(fmtCOP(undefined)).toBe("$ 0");
    expect(fmtCOP(null)).toBe("$ 0");
    expect(fmtCOP(0)).toBe("$ 0");
  });
});

describe("fmtDate", () => {
  it("returns empty string for falsy input", () => {
    expect(fmtDate("")).toBe("");
    expect(fmtDate(null)).toBe("");
  });
  it("formats an ISO date in es-CO long form", () => {
    expect(fmtDate("2026-07-23")).toBe("23 de jul de 2026");
  });
});

describe("monthLabel", () => {
  it("formats an ISO date as abbreviated month + 2-digit year", () => {
    expect(monthLabel("2026-07-23")).toBe("jul de 26");
  });
});

describe("todayISO", () => {
  it("returns a YYYY-MM-DD string", () => {
    expect(todayISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("escapeHtml", () => {
  it("escapes the five HTML-significant characters", () => {
    expect(escapeHtml(`<img src=x onerror=alert(1)>&"'`))
      .toBe("&lt;img src=x onerror=alert(1)&gt;&amp;&quot;&#39;");
  });
  it("treats null/undefined as an empty string", () => {
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
  });
  it("coerces numbers to strings without altering them", () => {
    expect(escapeHtml(42)).toBe("42");
  });
});

describe("uid", () => {
  it("generates short alphanumeric ids that differ between calls", () => {
    const a = uid();
    const b = uid();
    expect(a).toMatch(/^[a-z0-9]+$/);
    expect(a.length).toBeGreaterThan(0);
    expect(a).not.toBe(b);
  });
});

// ---------- Storage ----------
describe("sanitizeAppData", () => {
  it("passes through well-shaped records unchanged", () => {
    const data = {
      transactions: [{ id: "1", type: "ingreso", category: "Venta de leche", amount: 1000, date: "2026-01-01", note: "" }],
      inventory: [{ id: "2", name: "Sal", quantity: 5, unitValue: 100 }],
      cows: [{ id: "3", name: "Lola" }],
      milkRecords: [{ id: "4", date: "2026-01-01" }],
      herdEvents: [{ id: "5", type: "Muerte", date: "2026-01-04", count: 1 }],
      levanteAnimals: [{ id: "6", name: "Novillo 1", purchaseDate: "2026-01-01", purchasePrice: 800000, estado: "En levante" }],
    };
    expect(sanitizeAppData(data)).toEqual(data);
  });

  it("drops levante animals without a name, valid purchase date, or numeric purchase price", () => {
    const data = {
      levanteAnimals: [
        { id: "ok", name: "N1", purchaseDate: "2026-01-01", purchasePrice: 800000 },
        { id: "no-name", purchaseDate: "2026-01-01", purchasePrice: 800000 },
        { id: "bad-date", name: "N2", purchaseDate: "ayer", purchasePrice: 800000 },
        { id: "bad-price", name: "N3", purchaseDate: "2026-01-01", purchasePrice: "mucho" },
      ],
    };
    expect(sanitizeAppData(data).levanteAnimals).toEqual([{ id: "ok", name: "N1", purchaseDate: "2026-01-01", purchasePrice: 800000 }]);
  });

  it("drops herd events with an invalid type, date, or count", () => {
    const data = {
      herdEvents: [
        { id: "ok", type: "Nacimiento", date: "2026-01-01", count: 2 },
        { id: "bad-type", type: "Boda", date: "2026-01-01", count: 1 },
        { id: "bad-date", type: "Muerte", date: "ayer", count: 1 },
        { id: "bad-count", type: "Muerte", date: "2026-01-01", count: "dos" },
      ],
    };
    expect(sanitizeAppData(data).herdEvents).toEqual([{ id: "ok", type: "Nacimiento", date: "2026-01-01", count: 2 }]);
  });

  it("drops transactions missing a valid date, type, or numeric amount", () => {
    const data = {
      transactions: [
        { id: "ok", type: "ingreso", amount: 100, date: "2026-01-01" },
        { id: "no-date", type: "ingreso", amount: 100 },
        { id: "bad-type", type: "hack", amount: 100, date: "2026-01-01" },
        { id: "bad-amount", type: "ingreso", amount: "100", date: "2026-01-01" },
      ],
    };
    expect(sanitizeAppData(data).transactions).toEqual([
      { id: "ok", type: "ingreso", amount: 100, date: "2026-01-01" },
    ]);
  });

  it("requires date to actually look like YYYY-MM-DD, not just any string", () => {
    const data = {
      transactions: [
        { id: "ok", type: "ingreso", amount: 100, date: "2026-01-01" },
        { id: "not-a-date", type: "ingreso", amount: 100, date: "not-a-date" },
        { id: "formula", type: "ingreso", amount: 100, date: "=cmd|'/c calc'!A1" },
      ],
      milkRecords: [
        { id: "ok", date: "2026-01-01" },
        { id: "bad", date: "07/23/2026" },
      ],
    };
    expect(sanitizeAppData(data).transactions).toEqual([
      { id: "ok", type: "ingreso", amount: 100, date: "2026-01-01" },
    ]);
    expect(sanitizeAppData(data).milkRecords).toEqual([{ id: "ok", date: "2026-01-01" }]);
  });

  it("drops inventory items missing a name or numeric quantity/unitValue", () => {
    const data = {
      inventory: [
        { id: "ok", name: "Sal", quantity: 5, unitValue: 100 },
        { id: "no-name", quantity: 5, unitValue: 100 },
        { id: "bad-quantity", name: "Sal", quantity: "5", unitValue: 100 },
      ],
    };
    expect(sanitizeAppData(data).inventory).toEqual([{ id: "ok", name: "Sal", quantity: 5, unitValue: 100 }]);
  });

  it("drops cows without a name and milk records without a date", () => {
    const data = {
      cows: [{ id: "ok", name: "Lola" }, { id: "no-name" }],
      milkRecords: [{ id: "ok", date: "2026-01-01" }, { id: "no-date" }],
    };
    expect(sanitizeAppData(data).cows).toEqual([{ id: "ok", name: "Lola" }]);
    expect(sanitizeAppData(data).milkRecords).toEqual([{ id: "ok", date: "2026-01-01" }]);
  });

  it("treats non-array or missing top-level fields as empty lists instead of throwing", () => {
    expect(sanitizeAppData({})).toEqual({ transactions: [], inventory: [], cows: [], milkRecords: [], herdEvents: [], levanteAnimals: [] });
    expect(sanitizeAppData({ transactions: "not-an-array" })).toEqual({ transactions: [], inventory: [], cows: [], milkRecords: [], herdEvents: [], levanteAnimals: [] });
    expect(sanitizeAppData(null)).toEqual({ transactions: [], inventory: [], cows: [], milkRecords: [], herdEvents: [], levanteAnimals: [] });
  });

  it("rejects array entries (not plain records)", () => {
    expect(sanitizeAppData({ cows: [["not", "a", "record"]] }).cows).toEqual([]);
  });
});

describe("loadData / saveData", () => {
  it("returns an empty default shape when storage is empty", () => {
    const storage = makeFakeStorage();
    expect(loadData(storage)).toEqual({ transactions: [], inventory: [], cows: [], milkRecords: [], herdEvents: [], levanteAnimals: [] });
  });

  it("falls back to defaults when stored JSON is corrupt", () => {
    const storage = makeFakeStorage();
    storage.setItem(STORAGE_KEY, "{not valid json");
    expect(loadData(storage)).toEqual({ transactions: [], inventory: [], cows: [], milkRecords: [], herdEvents: [], levanteAnimals: [] });
  });

  it("sanitizes malformed records instead of letting a later render crash", () => {
    const storage = makeFakeStorage();
    storage.setItem(STORAGE_KEY, JSON.stringify({
      transactions: [{ id: "1", type: "ingreso", amount: 100, date: "2026-01-01" }, { id: "no-date" }],
    }));
    expect(loadData(storage).transactions).toEqual([{ id: "1", type: "ingreso", amount: 100, date: "2026-01-01" }]);
  });

  it("round-trips state through save then load", () => {
    const storage = makeFakeStorage();
    const state = {
      transactions: [{ id: "1", type: "ingreso", category: "Venta de leche", amount: 1000, date: "2026-01-01", note: "" }],
      inventory: [{ id: "2", name: "Sal", category: "Concentrado y sales", quantity: 5, unit: "kg", unitValue: 100, minStock: 1, lastUpdated: "2026-01-01" }],
      cows: [{ id: "3", name: "Lola" }],
      milkRecords: [{ id: "4", date: "2026-01-01", perCow: { 3: 10 }, farmConsumption: 1, calfConsumption: 1, deliveredToMilkman: 8, note: "" }],
      herdEvents: [{ id: "5", type: "Nacimiento", date: "2026-01-02", count: 1, note: "" }],
      levanteAnimals: [{ id: "6", name: "Novillo 1", purchaseDate: "2026-01-01", purchasePrice: 800000, purchaseWeight: 180, estado: "Vendido", saleDate: "2026-06-01", salePrice: 1400000, saleWeight: 320 }],
    };
    saveData(storage, state);
    expect(loadData(storage)).toEqual(state);
  });
});

// ---------- Resumen / monthly aggregation ----------
describe("computeMonthly", () => {
  it("sums ingreso/gasto per month and sorts ascending", () => {
    const transactions = [
      { type: "ingreso", amount: 100, date: "2026-02-05" },
      { type: "gasto", amount: 40, date: "2026-02-10" },
      { type: "ingreso", amount: 50, date: "2026-01-15" },
    ];
    const monthly = computeMonthly(transactions);
    expect(monthly.map(m => m.key)).toEqual(["2026-01", "2026-02"]);
    expect(monthly[1]).toMatchObject({ ingreso: 100, gasto: 40 });
  });

  it("keeps only the most recent 6 months", () => {
    const transactions = [];
    for (let m = 1; m <= 8; m++) {
      transactions.push({ type: "ingreso", amount: m, date: `2026-${String(m).padStart(2, "0")}-01` });
    }
    const monthly = computeMonthly(transactions);
    expect(monthly).toHaveLength(6);
    expect(monthly.map(m => m.key)).toEqual(["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"]);
  });
});

describe("computeSummary", () => {
  it("computes balance, inventory value and low-stock items", () => {
    const state = {
      transactions: [
        { type: "ingreso", amount: 300, date: "2026-01-01" },
        { type: "gasto", amount: 120, date: "2026-01-02" },
      ],
      inventory: [
        { name: "Sal", quantity: 2, unitValue: 100, minStock: 5 },
        { name: "Melaza", quantity: 10, unitValue: 50, minStock: null },
        { name: "Concentrado", quantity: 3, unitValue: 200, minStock: 3 },
      ],
    };
    const summary = computeSummary(state);
    expect(summary.ingresos).toBe(300);
    expect(summary.gastos).toBe(120);
    expect(summary.balance).toBe(180);
    expect(summary.valorInv).toBe(2 * 100 + 10 * 50 + 3 * 200);
    expect(summary.lowStock.map(i => i.name)).toEqual(["Sal", "Concentrado"]);
  });

  it("never lets maxVal be zero, even with no transactions", () => {
    const summary = computeSummary({ transactions: [], inventory: [] });
    expect(summary.maxVal).toBe(1);
    expect(summary.balance).toBe(0);
  });
});

// ---------- Producción de leche ----------
describe("totalProducido", () => {
  it("sums am+pm for two-ordeño (object) perCow entries", () => {
    expect(totalProducido({ perCow: { a: { am: 5, pm: 3 }, b: { am: 2, pm: 1.5 } } })).toBe(11.5);
  });
  it("still sums legacy plain-number perCow entries", () => {
    expect(totalProducido({ perCow: { a: 5, b: 3.5 } })).toBe(8.5);
  });
  it("handles a mix of object and legacy numeric entries", () => {
    expect(totalProducido({ perCow: { a: { am: 4, pm: 2 }, b: 3 } })).toBe(9);
  });
  it("treats missing or non-numeric values as zero", () => {
    expect(totalProducido({ perCow: { a: "not-a-number", b: { am: "x", pm: null } } })).toBe(0);
    expect(totalProducido({})).toBe(0);
  });
});

describe("totalProducidoByOrdeno", () => {
  it("sums am and pm separately across cows", () => {
    expect(totalProducidoByOrdeno({ perCow: { a: { am: 5, pm: 3 }, b: { am: 2, pm: 1.5 } } })).toEqual({ am: 7, pm: 4.5 });
  });
  it("counts legacy plain-number entries as the morning ordeño", () => {
    expect(totalProducidoByOrdeno({ perCow: { a: 5, b: { am: 1, pm: 2 } } })).toEqual({ am: 6, pm: 2 });
  });
  it("treats missing or non-numeric values as zero", () => {
    expect(totalProducidoByOrdeno({ perCow: { a: { am: "x", pm: null } } })).toEqual({ am: 0, pm: 0 });
    expect(totalProducidoByOrdeno({})).toEqual({ am: 0, pm: 0 });
  });
});

describe("computeMilkChartMax", () => {
  it("returns 1 for an empty record list", () => {
    expect(computeMilkChartMax([])).toBe(1);
  });
  it("returns the largest am/pm total across records", () => {
    const records = [
      { perCow: { a: { am: 3, pm: 2 } } },
      { perCow: { a: { am: 1, pm: 20 } } },
    ];
    expect(computeMilkChartMax(records)).toBe(20);
  });
});

describe("findDuplicateMilkRecord", () => {
  const milkRecords = [
    { id: "1", date: "2026-01-01" },
    { id: "2", date: "2026-01-02" },
  ];
  it("finds a record with the same date but a different id", () => {
    const dup = findDuplicateMilkRecord(milkRecords, { id: "new", date: "2026-01-01" });
    expect(dup).toEqual({ id: "1", date: "2026-01-01" });
  });
  it("does not match a record against itself", () => {
    expect(findDuplicateMilkRecord(milkRecords, { id: "1", date: "2026-01-01" })).toBeNull();
  });
  it("returns null when no other record shares the date", () => {
    expect(findDuplicateMilkRecord(milkRecords, { id: "new", date: "2026-03-03" })).toBeNull();
  });
});

// ---------- Reportes ----------
describe("fmtCompactCOP", () => {
  it("shows small amounts as plain numbers", () => {
    expect(fmtCompactCOP(0)).toBe("$0");
    expect(fmtCompactCOP(900)).toBe("$900");
  });
  it("abbreviates thousands with k", () => {
    expect(fmtCompactCOP(45000)).toBe("$45k");
    expect(fmtCompactCOP(1500)).toBe("$1.5k");
  });
  it("abbreviates millions with M", () => {
    expect(fmtCompactCOP(1234567)).toBe("$1.2M");
    expect(fmtCompactCOP(15000000)).toBe("$15M");
  });
  it("preserves the sign for negative amounts", () => {
    expect(fmtCompactCOP(-45000)).toBe("-$45k");
  });
  it("treats undefined/null as zero", () => {
    expect(fmtCompactCOP(undefined)).toBe("$0");
    expect(fmtCompactCOP(null)).toBe("$0");
  });
});

describe("computeReport", () => {
  const transactions = [
    { type: "ingreso", category: "Venta de leche", amount: 500, date: "2026-01-05" },
    { type: "gasto", category: "Veterinario y medicamentos", amount: 100, date: "2026-01-10" },
    { type: "gasto", category: "Veterinario y medicamentos", amount: 50, date: "2026-01-15" },
    { type: "gasto", category: "Transporte", amount: 30, date: "2026-02-01" },
  ];

  it("filters by inclusive date range and sums by type", () => {
    const { filtered, ingresos, gastos } = computeReport(transactions, "2026-01-01", "2026-01-31");
    expect(filtered).toHaveLength(3);
    expect(ingresos).toBe(500);
    expect(gastos).toBe(150);
  });

  it("includes transactions exactly on the boundary dates", () => {
    const { filtered } = computeReport(transactions, "2026-01-05", "2026-01-05");
    expect(filtered).toHaveLength(1);
    expect(filtered[0].date).toBe("2026-01-05");
  });

  it("aggregates expense categories for the pie chart and builds a full-circle gradient", () => {
    const { catList, gradient } = computeReport(transactions, "2026-01-01", "2026-02-28");
    expect(catList).toEqual([
      { name: "Veterinario y medicamentos", value: 150, color: PIE_COLORS[0] },
      { name: "Transporte", value: 30, color: PIE_COLORS[1] },
    ]);
    expect(gradient).toContain("360deg");
  });

  it("returns empty results and no gradient when nothing matches", () => {
    const { filtered, catList, gradient } = computeReport(transactions, "2030-01-01", "2030-01-31");
    expect(filtered).toEqual([]);
    expect(catList).toEqual([]);
    expect(gradient).toBe("");
  });
});

describe("computeProductionChartData", () => {
  it("groups by day and computes produced/consumed/sold for a range of 31 days or less", () => {
    const records = [
      { id: "m1", date: "2026-01-05", farmConsumption: 2, calfConsumption: 1, hasCalves: true, deliveredToMilkman: 5, perCow: { c1: { am: 10, pm: 5 } } },
      { id: "m2", date: "2026-01-06", farmConsumption: 1, calfConsumption: 0, hasCalves: false, deliveredToMilkman: 8, perCow: { c1: { am: 8, pm: 4 } } },
    ];
    const { points, byWeek } = computeProductionChartData(records, "2026-01-01", "2026-01-31");
    expect(byWeek).toBe(false);
    expect(points).toHaveLength(2);
    expect(points[0]).toMatchObject({ key: "2026-01-05", produced: 15, consumed: 3, sold: 5 });
    // hasCalves:false -> calfConsumption ignored even though it's non-zero on the record
    expect(points[1]).toMatchObject({ key: "2026-01-06", produced: 12, consumed: 1, sold: 8 });
  });

  it("switches to weekly grouping for ranges longer than 31 days", () => {
    const records = [
      { id: "m1", date: "2026-01-05", farmConsumption: 0, perCow: { c1: { am: 10, pm: 0 } }, deliveredToMilkman: 10 },
      { id: "m2", date: "2026-01-06", farmConsumption: 0, perCow: { c1: { am: 5, pm: 0 } }, deliveredToMilkman: 5 },
    ];
    const { points, byWeek } = computeProductionChartData(records, "2026-01-01", "2026-03-01");
    expect(byWeek).toBe(true);
    // both records fall in the same Mon-Sun week (2026-01-05 is a Monday)
    expect(points).toHaveLength(1);
    expect(points[0].produced).toBe(15);
    expect(points[0].label).toMatch(/^Sem\./);
  });

  it("excludes records outside the range and returns no points when there's no production", () => {
    const records = [
      { id: "m1", date: "2025-12-01", perCow: { c1: { am: 10, pm: 0 } } },
    ];
    const { points } = computeProductionChartData(records, "2026-01-01", "2026-01-31");
    expect(points).toEqual([]);
  });
});

describe("computeProductionChartMax", () => {
  it("returns the largest value across all three series", () => {
    const points = [
      { produced: 10, consumed: 3, sold: 7 },
      { produced: 4, consumed: 20, sold: 2 },
    ];
    expect(computeProductionChartMax(points)).toBe(20);
  });
  it("returns at least 1 to avoid division by zero when there's no data", () => {
    expect(computeProductionChartMax([])).toBe(1);
  });
});

describe("buildTransactionsCsv", () => {
  it("builds a header row plus one row per transaction", () => {
    const csv = buildTransactionsCsv([
      { date: "2026-01-01", type: "ingreso", category: "Venta de leche", amount: 1000, note: "" },
    ]);
    expect(csv).toBe('Fecha,Tipo,Categoria,Monto,Nota\n2026-01-01,ingreso,"Venta de leche",1000,""\n');
  });

  it("escapes double quotes inside notes", () => {
    const csv = buildTransactionsCsv([
      { date: "2026-01-01", type: "gasto", category: "Transporte", amount: 20, note: 'flete "urgente"' },
    ]);
    expect(csv).toContain('"flete ""urgente"""');
  });

  it.each(["=cmd|'/c calc'!A1", "+1+1", "-1+1", "@SUM(A1)", "\ttabbed"])(
    "neutralizes a note starting with a formula-injection trigger character (%s)",
    (payload) => {
      const csv = buildTransactionsCsv([
        { date: "2026-01-01", type: "gasto", category: "Transporte", amount: 20, note: payload },
      ]);
      expect(csv).toContain(`"'${payload}"`);
    }
  );

  it("does not alter a category/note that doesn't start with a trigger character", () => {
    const csv = buildTransactionsCsv([
      { date: "2026-01-01", type: "gasto", category: "Transporte", amount: 20, note: "cost=high" },
    ]);
    expect(csv).toContain('"cost=high"');
  });

  it("neutralizes a date field too, since an imported backup only guarantees it's a string", () => {
    const csv = buildTransactionsCsv([
      { date: "=cmd|'/c calc'!A1", type: "gasto", category: "Transporte", amount: 20, note: "" },
    ]);
    expect(csv.split("\n")[1].startsWith("'=cmd")).toBe(true);
  });
});

describe("buildBackupPayload / parseBackupData", () => {
  const state = {
    transactions: [{ id: "1", type: "ingreso", amount: 1000, date: "2026-01-01" }],
    inventory: [{ id: "2", name: "Sal", quantity: 5, unitValue: 100 }],
    cows: [{ id: "3", name: "Lola" }],
    milkRecords: [{ id: "4", date: "2026-01-01" }],
    herdEvents: [{ id: "5", type: "Nacimiento", date: "2026-01-03", count: 4, note: "" }],
    levanteAnimals: [{ id: "6", name: "Novillo 1", purchaseDate: "2026-01-01", purchasePrice: 900000, estado: "En levante" }],
  };

  it("serializes state plus an exportedAt timestamp", () => {
    const payload = buildBackupPayload(state, "2026-07-23T00:00:00.000Z");
    const parsed = JSON.parse(payload);
    expect(parsed).toEqual({ ...state, exportedAt: "2026-07-23T00:00:00.000Z" });
  });

  it("round-trips through parseBackupData", () => {
    const payload = buildBackupPayload(state, "2026-07-23T00:00:00.000Z");
    const result = parseBackupData(payload);
    expect(result.ok).toBe(true);
    expect(result.data).toEqual(state);
  });

  it("defaults missing arrays to empty when importing a partial backup", () => {
    const result = parseBackupData(JSON.stringify({ transactions: state.transactions }));
    expect(result).toEqual({ ok: true, data: { transactions: state.transactions, inventory: [], cows: [], milkRecords: [], herdEvents: [], levanteAnimals: [] } });
  });

  it("drops malformed records from an imported backup instead of crashing later", () => {
    const result = parseBackupData(JSON.stringify({
      transactions: [state.transactions[0], { id: "broken" }],
    }));
    expect(result.data.transactions).toEqual([state.transactions[0]]);
  });

  it("reports failure for invalid JSON", () => {
    expect(parseBackupData("{not json")).toEqual({ ok: false });
  });
});

// ---------- Form parsing ----------
describe("parseTransactionForm", () => {
  it("accepts a valid submission and trims the note", () => {
    const { valid, record } = parseTransactionForm({
      id: "", type: "ingreso", category: "Venta de leche", amount: "1500", date: "2026-01-01", note: "  hola  ",
    });
    expect(valid).toBe(true);
    expect(record.amount).toBe(1500);
    expect(record.note).toBe("hola");
    expect(record.id).toMatch(/^[a-z0-9]+$/);
  });

  it("preserves an existing id when editing", () => {
    const { record } = parseTransactionForm({
      id: "existing-id", type: "gasto", category: "Transporte", amount: "10", date: "2026-01-01",
    });
    expect(record.id).toBe("existing-id");
  });

  it.each([
    ["zero amount", { amount: "0", date: "2026-01-01" }],
    ["negative amount", { amount: "-5", date: "2026-01-01" }],
    ["non-numeric amount", { amount: "abc", date: "2026-01-01" }],
    ["missing date", { amount: "10", date: "" }],
  ])("rejects %s", (_label, fields) => {
    expect(parseTransactionForm({ type: "ingreso", category: "Otros ingresos", ...fields }).valid).toBe(false);
  });

  it("keeps restockItemId/restockQuantity when both are present and the quantity is positive", () => {
    const { record } = parseTransactionForm({
      type: "gasto", category: "Concentrado y sales", amount: "50000", date: "2026-01-01",
      restockItemId: "inv1", restockQuantity: "3.5",
    });
    expect(record.restockItemId).toBe("inv1");
    expect(record.restockQuantity).toBe(3.5);
  });

  it("drops the restock link when only the item or only the quantity is given", () => {
    const onlyItem = parseTransactionForm({
      type: "gasto", category: "Concentrado y sales", amount: "50000", date: "2026-01-01", restockItemId: "inv1",
    }).record;
    expect(onlyItem.restockItemId).toBeNull();
    expect(onlyItem.restockQuantity).toBeNull();

    const onlyQty = parseTransactionForm({
      type: "gasto", category: "Concentrado y sales", amount: "50000", date: "2026-01-01", restockQuantity: "3",
    }).record;
    expect(onlyQty.restockItemId).toBeNull();
    expect(onlyQty.restockQuantity).toBeNull();
  });

  it("drops the restock link when the quantity is zero or negative", () => {
    const { record } = parseTransactionForm({
      type: "gasto", category: "Concentrado y sales", amount: "50000", date: "2026-01-01",
      restockItemId: "inv1", restockQuantity: "0",
    });
    expect(record.restockItemId).toBeNull();
    expect(record.restockQuantity).toBeNull();
  });
});

describe("applyInventoryRestock", () => {
  const inventory = [
    { id: "inv1", name: "Concentrado 18%", category: "Concentrado y sales", quantity: 10, unit: "Cantidad", unitValue: 50000 },
    { id: "inv2", name: "Vacuna X", category: "Medicamentos veterinarios", quantity: 5, unit: "Cantidad", unitValue: 20000 },
  ];

  it("adds the purchased quantity to the matching item and updates lastUpdated", () => {
    const next = applyInventoryRestock(inventory, "inv1", 4, "2026-02-01");
    const item = next.find(i => i.id === "inv1");
    expect(item.quantity).toBe(14);
    expect(item.lastUpdated).toBe("2026-02-01");
    // other item untouched
    expect(next.find(i => i.id === "inv2").quantity).toBe(5);
  });

  it("returns the inventory unchanged when the item id doesn't match anything", () => {
    const next = applyInventoryRestock(inventory, "missing", 4);
    expect(next).toEqual(inventory);
  });

  it("returns the inventory unchanged when itemId or quantity is missing/non-positive", () => {
    expect(applyInventoryRestock(inventory, null, 4)).toEqual(inventory);
    expect(applyInventoryRestock(inventory, "inv1", 0)).toEqual(inventory);
    expect(applyInventoryRestock(inventory, "inv1", -2)).toEqual(inventory);
  });

  it("does not mutate the original inventory array", () => {
    const original = JSON.parse(JSON.stringify(inventory));
    applyInventoryRestock(inventory, "inv1", 4);
    expect(inventory).toEqual(original);
  });
});

describe("parseInventoryForm", () => {
  it("accepts a valid submission and defaults unit/minStock", () => {
    const { valid, record } = parseInventoryForm({
      id: "", name: "  Sal mineral  ", category: "Concentrado y sales", quantity: "5", unit: "", unitValue: "1000", minStock: "",
    }, "2026-07-23");
    expect(valid).toBe(true);
    expect(record.name).toBe("Sal mineral");
    expect(record.unit).toBe("Cantidad");
    expect(record.minStock).toBeNull();
    expect(record.lastUpdated).toBe("2026-07-23");
  });

  it("parses a provided minStock", () => {
    const { record } = parseInventoryForm({ name: "Sal", category: "x", quantity: "5", unitValue: "10", minStock: "2" });
    expect(record.minStock).toBe(2);
  });

  it("keeps a selected unit as-is", () => {
    const { record } = parseInventoryForm({ name: "Leche", category: "x", quantity: "5", unitValue: "10", unit: "Litros" });
    expect(record.unit).toBe("Litros");
  });

  it.each([
    ["missing name", { name: "", quantity: "5", unitValue: "10" }],
    ["non-numeric quantity", { name: "Sal", quantity: "abc", unitValue: "10" }],
    ["non-numeric unitValue", { name: "Sal", quantity: "5", unitValue: "abc" }],
  ])("rejects %s", (_label, fields) => {
    expect(parseInventoryForm({ category: "x", ...fields }).valid).toBe(false);
  });
});

describe("parseMilkForm", () => {
  const cows = [{ id: "c1", name: "Lola" }, { id: "c2", name: "Manchas" }];

  it("collects am/pm liters per cow and defaults consumption/sale fields to zero", () => {
    const getValue = makeGetValue({ date: "2026-01-01", am_c1: "5", pm_c1: "3" });
    const { valid, record } = parseMilkForm(getValue, cows, true);
    expect(valid).toBe(true);
    expect(record.perCow).toEqual({ c1: { am: 5, pm: 3 } });
    expect(record.farmConsumption).toBe(0);
    expect(record.calfConsumption).toBe(0);
    expect(record.hasCalves).toBe(true);
    expect(record.deliveredToMilkman).toBe(0);
    expect(record.pricePerLiter).toBe(0);
  });

  it("parses deliveredToMilkman and pricePerLiter when provided", () => {
    const getValue = makeGetValue({ date: "2026-01-01", deliveredToMilkman: "18", pricePerLiter: "2000" });
    const { record } = parseMilkForm(getValue, cows, true);
    expect(record.deliveredToMilkman).toBe(18);
    expect(record.pricePerLiter).toBe(2000);
  });

  it("keeps a stored calfConsumption value even when there are no calves, so it's not lost if re-enabled", () => {
    const getValue = makeGetValue({
      date: "2026-01-01", am_c1: "6", pm_c1: "4", farmConsumption: "2", calfConsumption: "3",
    });
    const { record } = parseMilkForm(getValue, cows, false);
    expect(record.calfConsumption).toBe(3);
    expect(record.hasCalves).toBe(false);
  });

  it("includes a cow if only one of am/pm was entered", () => {
    const getValue = makeGetValue({ date: "2026-01-01", am_c1: "5", pm_c1: "" });
    const { record } = parseMilkForm(getValue, cows, true);
    expect(record.perCow).toEqual({ c1: { am: 5, pm: 0 } });
  });

  it("omits a cow with no am/pm entry at all", () => {
    const getValue = makeGetValue({ date: "2026-01-01", am_c1: "5", pm_c1: "3" });
    const { record } = parseMilkForm(getValue, cows, true);
    expect(record.perCow).not.toHaveProperty("c2");
  });

  it("is invalid without a date", () => {
    const getValue = makeGetValue({});
    expect(parseMilkForm(getValue, cows, true).valid).toBe(false);
  });

  it("treats a non-numeric cow entry as zero but still includes it", () => {
    const getValue = makeGetValue({ date: "2026-01-01", am_c1: "not-a-number", pm_c1: "" });
    const { record } = parseMilkForm(getValue, cows, true);
    expect(record.perCow).toEqual({ c1: { am: 0, pm: 0 } });
  });

  it("records hasCalves:false without erasing whatever calfConsumption was on the form", () => {
    const getValue = makeGetValue({ date: "2026-01-01", calfConsumption: "7" });
    const { record } = parseMilkForm(getValue, cows, false);
    expect(record.calfConsumption).toBe(7);
    expect(record.hasCalves).toBe(false);
  });

  it("defaults hasCalves to true when not passed", () => {
    const getValue = makeGetValue({ date: "2026-01-01", calfConsumption: "7" });
    const { record } = parseMilkForm(getValue, cows);
    expect(record.hasCalves).toBe(true);
    expect(record.calfConsumption).toBe(7);
  });
});

describe("parseCowForm", () => {
  it("accepts a name-only submission with everything else defaulting to null/empty", () => {
    const { valid, record } = parseCowForm({ name: "  Lola  " });
    expect(valid).toBe(true);
    expect(record.name).toBe("Lola");
    expect(record.weight).toBeNull();
    expect(record.lastCalvingDate).toBeNull();
    expect(record.healthNotes).toBe("");
  });

  it("accepts weight, last calving date, and health notes", () => {
    const { record } = parseCowForm({
      name: "Manchas", weight: "410.5", lastCalvingDate: "2026-05-01", healthNotes: "  cojea de la pata trasera  ",
    });
    expect(record.weight).toBe(410.5);
    expect(record.lastCalvingDate).toBe("2026-05-01");
    expect(record.healthNotes).toBe("cojea de la pata trasera");
  });

  it("is invalid without a name", () => {
    expect(parseCowForm({ name: "" }).valid).toBe(false);
    expect(parseCowForm({ name: "   " }).valid).toBe(false);
  });

  it("treats an empty or non-numeric weight as null rather than NaN", () => {
    expect(parseCowForm({ name: "Lola", weight: "" }).record.weight).toBeNull();
    expect(parseCowForm({ name: "Lola", weight: "abc" }).record.weight).toBeNull();
  });

  it("preserves an existing id when editing", () => {
    const { record } = parseCowForm({ id: "existing-id", name: "Lola" });
    expect(record.id).toBe("existing-id");
  });

  it("defaults estado to 'En producción' and rejects unknown values", () => {
    expect(parseCowForm({ name: "Lola" }).record.estado).toBe("En producción");
    expect(parseCowForm({ name: "Lola", estado: "hack" }).record.estado).toBe("En producción");
  });

  it("keeps a valid estado", () => {
    expect(parseCowForm({ name: "Lola", estado: "Levante" }).record.estado).toBe("Levante");
    expect(parseCowForm({ name: "Lola", estado: "Seca" }).record.estado).toBe("Seca");
  });
});

describe("cow estado helpers", () => {
  it("cowEstado returns the estado, defaulting missing/invalid to production", () => {
    expect(cowEstado({ estado: "Levante" })).toBe("Levante");
    expect(cowEstado({})).toBe("En producción");
    expect(cowEstado({ estado: "otro" })).toBe("En producción");
    expect(cowEstado(null)).toBe("En producción");
  });

  it("isProductionCow is true for production and for legacy cows without estado", () => {
    expect(isProductionCow({ estado: "En producción" })).toBe(true);
    expect(isProductionCow({})).toBe(true);
    expect(isProductionCow({ estado: "Levante" })).toBe(false);
    expect(isProductionCow({ estado: "Seca" })).toBe(false);
  });

  it("exposes the three states", () => {
    expect(COW_STATES).toEqual(["En producción", "Levante", "Seca"]);
  });
});

describe("milkFormCows", () => {
  const cows = [
    { id: "c1", name: "Lola", estado: "En producción" },
    { id: "c2", name: "Toro", estado: "Levante" },
    { id: "c3", name: "Vieja", estado: "Seca" },
    { id: "c4", name: "Legacy" }, // no estado → treated as production
  ];

  it("lists only production cows (including legacy) when adding a new record", () => {
    expect(milkFormCows(cows, null).map(c => c.id)).toEqual(["c1", "c4"]);
  });

  it("also includes a non-production cow if the record being edited has its data", () => {
    const editing = { perCow: { c3: { am: 4, pm: 2 } } };
    expect(milkFormCows(cows, editing).map(c => c.id)).toEqual(["c1", "c3", "c4"]);
  });
});

describe("cowNetLitersForRecord", () => {
  it("splits house consumption across cows in proportion to each one's share of the day's production", () => {
    const record = { farmConsumption: 6, perCow: { c1: { am: 10, pm: 10 }, c2: { am: 5, pm: 5 } } };
    const net = cowNetLitersForRecord(record);
    // c1: 20/30 of 6 = 4 -> 20-4=16 ; c2: 10/30 of 6 = 2 -> 10-2=8
    expect(net.c1).toBeCloseTo(16, 5);
    expect(net.c2).toBeCloseTo(8, 5);
  });

  it("also deducts calf consumption proportionally when hasCalves is true", () => {
    const record = { farmConsumption: 2, calfConsumption: 4, hasCalves: true, perCow: { c1: { am: 10, pm: 0 }, c2: { am: 10, pm: 0 } } };
    const net = cowNetLitersForRecord(record);
    // total consumo = 6, split evenly (10/20 each) -> 3 each -> 10-3=7
    expect(net.c1).toBeCloseTo(7, 5);
    expect(net.c2).toBeCloseTo(7, 5);
  });

  it("ignores calfConsumption when hasCalves is false, even if the value is still stored on the record", () => {
    const record = { farmConsumption: 2, calfConsumption: 4, hasCalves: false, perCow: { c1: { am: 10, pm: 0 } } };
    const net = cowNetLitersForRecord(record);
    // only farmConsumption (2) counts -> 10-2=8
    expect(net.c1).toBeCloseTo(8, 5);
  });

  it("treats a record with no hasCalves field as having calves (backward compatibility)", () => {
    const record = { farmConsumption: 0, calfConsumption: 4, perCow: { c1: { am: 10, pm: 0 } } };
    const net = cowNetLitersForRecord(record);
    expect(net.c1).toBeCloseTo(6, 5);
  });

  it("returns an empty object when there is no production that day (no division by zero)", () => {
    const record = { farmConsumption: 5, perCow: {} };
    expect(cowNetLitersForRecord(record)).toEqual({});
  });

  it("skips cows with zero or negative liters", () => {
    const record = { farmConsumption: 3, perCow: { c1: { am: 10, pm: 0 }, c2: { am: 0, pm: 0 } } };
    const net = cowNetLitersForRecord(record);
    expect(net).toEqual({ c1: 7 });
  });
});

describe("computeCowProfitability", () => {
  const cows = [
    { id: "c1", name: "Lola", estado: "En producción" },
    { id: "c2", name: "Manchas", estado: "En producción" },
  ];
  const milkRecords = [
    { id: "m1", date: "2026-01-05", pricePerLiter: 2000, perCow: { c1: { am: 10, pm: 10 }, c2: { am: 5, pm: 5 } } },
    { id: "m2", date: "2026-01-10", pricePerLiter: 2000, perCow: { c1: { am: 10, pm: 10 }, c2: { am: 5, pm: 5 } } },
    { id: "m3", date: "2026-02-01", pricePerLiter: 3000, perCow: { c1: { am: 100, pm: 0 } } }, // out of range
  ];
  const transactions = [
    { id: "t1", type: "gasto", category: "Concentrado y sales", amount: 90000, date: "2026-01-07" },
    { id: "t2", type: "gasto", category: "Transporte", amount: 50000, date: "2026-01-08" },
    { id: "t3", type: "gasto", category: "Concentrado y sales", amount: 10000, date: "2026-03-01" }, // out of range
  ];

  it("computes liters, income (liters × daily price) and total production in range", () => {
    const { rows, totalLiters, concentradoCost } = computeCowProfitability(cows, milkRecords, transactions, "2026-01-01", "2026-01-31");
    expect(totalLiters).toBe(60); // c1: 40, c2: 20
    expect(concentradoCost).toBe(90000); // only the in-range concentrado expense
    const lola = rows.find(r => r.cowId === "c1");
    const manchas = rows.find(r => r.cowId === "c2");
    expect(lola.liters).toBe(40);
    expect(lola.ingreso).toBe(80000); // 40 × 2000
    expect(manchas.liters).toBe(20);
    expect(manchas.ingreso).toBe(40000); // 20 × 2000
  });

  it("allocates concentrado cost proportionally to each cow's share of liters", () => {
    const { rows } = computeCowProfitability(cows, milkRecords, transactions, "2026-01-01", "2026-01-31");
    const lola = rows.find(r => r.cowId === "c1");   // 40/60 share
    const manchas = rows.find(r => r.cowId === "c2"); // 20/60 share
    expect(lola.assignedCost).toBeCloseTo(60000, 5);   // 90000 × 40/60
    expect(manchas.assignedCost).toBeCloseTo(30000, 5); // 90000 × 20/60
    expect(lola.margin).toBeCloseTo(20000, 5);   // 80000 − 60000
    expect(manchas.margin).toBeCloseTo(10000, 5); // 40000 − 30000
  });

  it("sorts rows by margin descending", () => {
    const { rows } = computeCowProfitability(cows, milkRecords, transactions, "2026-01-01", "2026-01-31");
    expect(rows.map(r => r.cowId)).toEqual(["c1", "c2"]);
  });

  it("only includes cows that actually produced in the range", () => {
    const { rows } = computeCowProfitability(cows, milkRecords, transactions, "2026-02-01", "2026-02-28");
    expect(rows.map(r => r.cowId)).toEqual(["c1"]);
  });

  it("labels a produced-but-since-deleted cow instead of dropping it", () => {
    const { rows } = computeCowProfitability([], milkRecords, transactions, "2026-02-01", "2026-02-28");
    expect(rows[0].name).toBe("(vaca eliminada)");
  });

  it("assigns zero cost when there is no production (no division by zero)", () => {
    const { rows, totalLiters } = computeCowProfitability(cows, [], transactions, "2026-01-01", "2026-01-31");
    expect(totalLiters).toBe(0);
    expect(rows).toEqual([]);
  });

  it("values a day with no registered price at zero income but still counts its liters for cost sharing", () => {
    const records = [
      { id: "m1", date: "2026-01-05", pricePerLiter: 0, perCow: { c1: { am: 10, pm: 0 } } },
      { id: "m2", date: "2026-01-06", pricePerLiter: 2000, perCow: { c2: { am: 10, pm: 0 } } },
    ];
    const txs = [{ id: "t1", type: "gasto", category: "Concentrado y sales", amount: 20000, date: "2026-01-05" }];
    const { rows } = computeCowProfitability(cows, records, txs, "2026-01-01", "2026-01-31");
    const lola = rows.find(r => r.cowId === "c1");
    expect(lola.ingreso).toBe(0);
    expect(lola.assignedCost).toBeCloseTo(10000, 5); // still 10/20 share of cost
  });

  it("values income using each cow's net liters (after its proportional share of house/calf consumption), while assignedCost still uses raw liters", () => {
    const records = [
      {
        id: "m1", date: "2026-01-05", pricePerLiter: 2000, farmConsumption: 6, calfConsumption: 3, hasCalves: true,
        perCow: { c1: { am: 10, pm: 10 }, c2: { am: 5, pm: 5 } }, // raw: c1=20, c2=10, total=30, consumo=9
      },
    ];
    const txs = [{ id: "t1", type: "gasto", category: "Concentrado y sales", amount: 30000, date: "2026-01-05" }];
    const { rows, totalLiters } = computeCowProfitability(cows, records, txs, "2026-01-01", "2026-01-31");
    expect(totalLiters).toBe(30); // raw liters, unaffected by consumption
    const lola = rows.find(r => r.cowId === "c1");   // 20/30 share
    const manchas = rows.find(r => r.cowId === "c2"); // 10/30 share
    // c1 net = 20 - (20/30)*9 = 14 ; c2 net = 10 - (10/30)*9 = 7
    expect(lola.liters).toBe(20);
    expect(lola.netLiters).toBeCloseTo(14, 5);
    expect(lola.ingreso).toBeCloseTo(28000, 5); // 14 × 2000
    expect(lola.assignedCost).toBeCloseTo(20000, 5); // still raw-liters share: 30000 × 20/30
    expect(manchas.liters).toBe(10);
    expect(manchas.netLiters).toBeCloseTo(7, 5);
    expect(manchas.ingreso).toBeCloseTo(14000, 5); // 7 × 2000
    expect(manchas.assignedCost).toBeCloseTo(10000, 5); // 30000 × 10/30
  });

  it("does not deduct calf consumption from net liters when hasCalves is false, even though calfConsumption is stored", () => {
    const records = [
      {
        id: "m1", date: "2026-01-05", pricePerLiter: 1000, farmConsumption: 0, calfConsumption: 8, hasCalves: false,
        perCow: { c1: { am: 10, pm: 0 } },
      },
    ];
    const { rows } = computeCowProfitability(cows, records, [], "2026-01-01", "2026-01-31");
    const lola = rows.find(r => r.cowId === "c1");
    expect(lola.netLiters).toBeCloseTo(10, 5); // full liters kept, calfConsumption ignored
    expect(lola.ingreso).toBeCloseTo(10000, 5);
  });
});

describe("milk production ↔ accounts linking", () => {
  describe("milkTransactionId", () => {
    it("derives a stable id from the milk record's id", () => {
      expect(milkTransactionId("abc123")).toBe("milk-abc123");
    });
  });

  describe("getLastMilkPrice", () => {
    it("returns null when no record has a price set", () => {
      expect(getLastMilkPrice([{ date: "2026-01-01" }, { date: "2026-01-02", pricePerLiter: 0 }])).toBeNull();
    });

    it("returns the price of the most recent record (by date) that has one", () => {
      const records = [
        { date: "2026-01-01", pricePerLiter: 1800 },
        { date: "2026-01-03", pricePerLiter: 2000 },
        { date: "2026-01-02", pricePerLiter: 1900 },
      ];
      expect(getLastMilkPrice(records)).toBe(2000);
    });
  });

  describe("computeMilkSaleTransaction", () => {
    it("returns null if delivered liters or price is missing/zero", () => {
      expect(computeMilkSaleTransaction({ id: "1", date: "2026-01-01", deliveredToMilkman: 0, pricePerLiter: 2000 })).toBeNull();
      expect(computeMilkSaleTransaction({ id: "1", date: "2026-01-01", deliveredToMilkman: 10, pricePerLiter: 0 })).toBeNull();
      expect(computeMilkSaleTransaction({ id: "1", date: "2026-01-01" })).toBeNull();
    });

    it("computes an ingreso transaction for delivered liters × price", () => {
      const tx = computeMilkSaleTransaction({ id: "rec1", date: "2026-01-05", deliveredToMilkman: 20, pricePerLiter: 1500 });
      expect(tx).toEqual({
        id: "milk-rec1",
        type: "ingreso",
        category: "Venta de leche",
        amount: 30000,
        date: "2026-01-05",
        note: "Generado automáticamente desde producción de leche",
      });
    });
  });

  describe("syncMilkSaleTransaction", () => {
    it("appends a new linked transaction when the record newly qualifies", () => {
      const record = { id: "rec1", date: "2026-01-05", deliveredToMilkman: 10, pricePerLiter: 2000 };
      const result = syncMilkSaleTransaction([], record);
      expect(result).toEqual([computeMilkSaleTransaction(record)]);
    });

    it("updates the existing linked transaction in place instead of duplicating it", () => {
      const record = { id: "rec1", date: "2026-01-05", deliveredToMilkman: 10, pricePerLiter: 2000 };
      const other = { id: "manual-tx", type: "gasto", category: "Transporte", amount: 5000, date: "2026-01-01" };
      const first = syncMilkSaleTransaction([other], record);
      const updatedRecord = { ...record, deliveredToMilkman: 15 };
      const second = syncMilkSaleTransaction(first, updatedRecord);
      expect(second).toHaveLength(2);
      const linked = second.find(t => t.id === "milk-rec1");
      expect(linked.amount).toBe(30000);
      expect(second).toContainEqual(other);
    });

    it("removes the linked transaction if the record no longer qualifies", () => {
      const record = { id: "rec1", date: "2026-01-05", deliveredToMilkman: 10, pricePerLiter: 2000 };
      const withLinked = syncMilkSaleTransaction([], record);
      const noLongerQualifies = { ...record, pricePerLiter: 0 };
      expect(syncMilkSaleTransaction(withLinked, noLongerQualifies)).toEqual([]);
    });

    it("leaves other transactions untouched when there's nothing to link", () => {
      const other = { id: "manual-tx", type: "gasto", category: "Transporte", amount: 5000, date: "2026-01-01" };
      const record = { id: "rec1", date: "2026-01-05", deliveredToMilkman: 0, pricePerLiter: 0 };
      expect(syncMilkSaleTransaction([other], record)).toEqual([other]);
    });
  });

  describe("removeMilkSaleTransaction", () => {
    it("removes only the transaction linked to the given milk record id", () => {
      const linked = { id: "milk-rec1", type: "ingreso", category: "Venta de leche", amount: 1000, date: "2026-01-01" };
      const other = { id: "manual-tx", type: "gasto", category: "Transporte", amount: 500, date: "2026-01-01" };
      expect(removeMilkSaleTransaction([linked, other], "rec1")).toEqual([other]);
    });

    it("is a no-op if there's no linked transaction", () => {
      const other = { id: "manual-tx", type: "gasto", category: "Transporte", amount: 500, date: "2026-01-01" };
      expect(removeMilkSaleTransaction([other], "rec1")).toEqual([other]);
    });
  });
});


describe("parseHerdEventForm (nacimientos y mortalidad)", () => {
  it("parses a birth event with a positive integer count and trimmed note", () => {
    const { valid, record } = parseHerdEventForm({ type: "Nacimiento", date: "2026-02-01", count: "2", note: "  mellizos  " });
    expect(valid).toBe(true);
    expect(record).toMatchObject({ type: "Nacimiento", date: "2026-02-01", count: 2, note: "mellizos" });
    expect(record.id).toMatch(/^[a-z0-9]+$/);
    expect(record).not.toHaveProperty("amount");
  });

  it("rounds the count to a whole number of head", () => {
    expect(parseHerdEventForm({ type: "Muerte", date: "2026-02-01", count: "2.7" }).record.count).toBe(3);
  });

  it.each([
    ["unknown type", { type: "Compra de levante", date: "2026-02-01", count: "1" }],
    ["missing/invalid date", { type: "Nacimiento", date: "", count: "1" }],
    ["zero count", { type: "Nacimiento", date: "2026-02-01", count: "0" }],
    ["negative count", { type: "Nacimiento", date: "2026-02-01", count: "-1" }],
    ["non-numeric count", { type: "Nacimiento", date: "2026-02-01", count: "x" }],
  ])("rejects %s", (_label, fields) => {
    expect(parseHerdEventForm(fields).valid).toBe(false);
  });

  it("preserves an existing id when editing", () => {
    expect(parseHerdEventForm({ id: "e1", type: "Muerte", date: "2026-02-01", count: "1" }).record.id).toBe("e1");
  });
});

describe("summarizeHerd", () => {
  it("tallies births and deaths and computes the net variation", () => {
    const events = [
      { type: "Nacimiento", count: 3 },
      { type: "Muerte", count: 1 },
      { type: "Nacimiento", count: 1 },
    ];
    expect(summarizeHerd(events)).toEqual({ nacimientos: 4, muertes: 1, neto: 3 });
  });

  it("returns all zeros for no events", () => {
    expect(summarizeHerd([])).toEqual({ nacimientos: 0, muertes: 0, neto: 0 });
  });
});

describe("HERD_EVENT_TYPES", () => {
  it("exposes the two event types", () => {
    expect(HERD_EVENT_TYPES).toEqual(["Nacimiento", "Muerte"]);
  });
});

describe("parseLevanteForm", () => {
  it("parses an animal still being raised (En levante) with only purchase data", () => {
    const { valid, record } = parseLevanteForm({
      name: "  Novillo 1  ", purchaseDate: "2026-01-10", purchasePrice: "800000", purchaseWeight: "180",
    });
    expect(valid).toBe(true);
    expect(record).toMatchObject({
      name: "Novillo 1", purchaseDate: "2026-01-10", purchasePrice: 800000, purchaseWeight: 180,
      estado: "En levante", saleDate: null, salePrice: null, saleWeight: null,
    });
    expect(record.id).toMatch(/^[a-z0-9]+$/);
  });

  it("parses a sold animal with its sale data", () => {
    const { valid, record } = parseLevanteForm({
      name: "Novillo 2", purchaseDate: "2026-01-10", purchasePrice: "800000",
      estado: "Vendido", saleDate: "2026-06-01", salePrice: "1400000", saleWeight: "320",
    });
    expect(valid).toBe(true);
    expect(record).toMatchObject({
      estado: "Vendido", saleDate: "2026-06-01", salePrice: 1400000, saleWeight: 320,
    });
  });

  it("leaves optional weights null when blank", () => {
    const { record } = parseLevanteForm({ name: "N", purchaseDate: "2026-01-10", purchasePrice: "800000" });
    expect(record.purchaseWeight).toBeNull();
  });

  it.each([
    ["missing name", { name: "", purchaseDate: "2026-01-10", purchasePrice: "800000" }],
    ["invalid purchase date", { name: "N", purchaseDate: "ayer", purchasePrice: "800000" }],
    ["non-numeric purchase price", { name: "N", purchaseDate: "2026-01-10", purchasePrice: "mucho" }],
    ["negative purchase price", { name: "N", purchaseDate: "2026-01-10", purchasePrice: "-1" }],
  ])("rejects %s", (_label, fields) => {
    expect(parseLevanteForm(fields).valid).toBe(false);
  });

  it("rejects a Vendido animal missing its sale date or price", () => {
    expect(parseLevanteForm({ name: "N", purchaseDate: "2026-01-10", purchasePrice: "800000", estado: "Vendido", salePrice: "900000" }).valid).toBe(false);
    expect(parseLevanteForm({ name: "N", purchaseDate: "2026-01-10", purchasePrice: "800000", estado: "Vendido", saleDate: "2026-06-01" }).valid).toBe(false);
  });

  it("preserves an existing id when editing", () => {
    expect(parseLevanteForm({ id: "a1", name: "N", purchaseDate: "2026-01-10", purchasePrice: "800000" }).record.id).toBe("a1");
  });

  it("exposes the two levante states", () => {
    expect(LEVANTE_STATES).toEqual(["En levante", "Vendido"]);
  });
});

describe("levanteGanancia", () => {
  it("is sale price minus purchase price for a sold animal", () => {
    expect(levanteGanancia({ estado: "Vendido", purchasePrice: 800000, salePrice: 1400000 })).toBe(600000);
  });
  it("can be negative (a loss)", () => {
    expect(levanteGanancia({ estado: "Vendido", purchasePrice: 800000, salePrice: 700000 })).toBe(-100000);
  });
  it("is null while the animal is still being raised", () => {
    expect(levanteGanancia({ estado: "En levante", purchasePrice: 800000, salePrice: null })).toBeNull();
  });
});

describe("computeLevanteProfit", () => {
  const animals = [
    { id: "a1", name: "N1", purchaseDate: "2026-01-05", purchasePrice: 800000, estado: "Vendido", saleDate: "2026-03-10", salePrice: 1400000 },
    { id: "a2", name: "N2", purchaseDate: "2026-01-06", purchasePrice: 900000, estado: "Vendido", saleDate: "2026-05-20", salePrice: 1100000 },
    { id: "a3", name: "N3", purchaseDate: "2026-02-01", purchasePrice: 850000, estado: "En levante", saleDate: null, salePrice: null },
    { id: "a4", name: "N4", purchaseDate: "2026-01-01", purchasePrice: 700000, estado: "Vendido", saleDate: "2026-08-01", salePrice: 1500000 }, // sold out of range
  ];

  it("lists animals sold within the range with their ganancia, newest sale first", () => {
    const { sold } = computeLevanteProfit(animals, "2026-01-01", "2026-06-30");
    expect(sold.map(a => a.id)).toEqual(["a2", "a1"]);
    expect(sold.find(a => a.id === "a1").ganancia).toBe(600000);
    expect(sold.find(a => a.id === "a2").ganancia).toBe(200000);
  });

  it("accumulates total ganancia over the range only", () => {
    const { totalGanancia } = computeLevanteProfit(animals, "2026-01-01", "2026-06-30");
    expect(totalGanancia).toBe(800000); // 600000 + 200000, a4 excluded (out of range)
  });

  it("lists still-being-raised animals separately, regardless of range", () => {
    const { enLevante } = computeLevanteProfit(animals, "2026-01-01", "2026-06-30");
    expect(enLevante.map(a => a.id)).toEqual(["a3"]);
  });

  it("returns empty results and zero total when nothing sold in range", () => {
    const { sold, totalGanancia } = computeLevanteProfit(animals, "2030-01-01", "2030-12-31");
    expect(sold).toEqual([]);
    expect(totalGanancia).toBe(0);
  });
});

describe("computeLevanteSaleTransaction", () => {
  it("generates an ingreso transaction for a sold animal with a positive sale price", () => {
    const animal = { id: "a1", estado: "Vendido", saleDate: "2026-03-10", salePrice: 1400000 };
    const tx = computeLevanteSaleTransaction(animal);
    expect(tx).toMatchObject({
      id: levanteTransactionId("a1"),
      type: "ingreso",
      category: "Venta de ganado de levante",
      amount: 1400000,
      date: "2026-03-10",
    });
  });

  it("returns null when the animal isn't marked as sold", () => {
    const animal = { id: "a1", estado: "En levante", saleDate: null, salePrice: null };
    expect(computeLevanteSaleTransaction(animal)).toBeNull();
  });

  it("returns null when the sale price is zero or missing", () => {
    expect(computeLevanteSaleTransaction({ id: "a1", estado: "Vendido", saleDate: "2026-03-10", salePrice: 0 })).toBeNull();
    expect(computeLevanteSaleTransaction({ id: "a1", estado: "Vendido", saleDate: "2026-03-10", salePrice: null })).toBeNull();
  });
});

describe("syncLevanteSaleTransaction / removeLevanteSaleTransaction", () => {
  it("adds a new linked transaction for a newly sold animal", () => {
    const animal = { id: "a1", estado: "Vendido", saleDate: "2026-03-10", salePrice: 1400000 };
    const next = syncLevanteSaleTransaction([], animal);
    expect(next).toHaveLength(1);
    expect(next[0].id).toBe(levanteTransactionId("a1"));
    expect(next[0].amount).toBe(1400000);
  });

  it("updates the existing linked transaction in place when the animal is re-saved", () => {
    const animal = { id: "a1", estado: "Vendido", saleDate: "2026-03-10", salePrice: 1400000 };
    const first = syncLevanteSaleTransaction([], animal);
    const updated = { ...animal, salePrice: 1600000 };
    const next = syncLevanteSaleTransaction(first, updated);
    expect(next).toHaveLength(1);
    expect(next[0].amount).toBe(1600000);
  });

  it("removes the linked transaction if the animal no longer qualifies (e.g. price cleared)", () => {
    const animal = { id: "a1", estado: "Vendido", saleDate: "2026-03-10", salePrice: 1400000 };
    const withTx = syncLevanteSaleTransaction([], animal);
    const noLongerSold = { ...animal, estado: "En levante", salePrice: null, saleDate: null };
    const next = syncLevanteSaleTransaction(withTx, noLongerSold);
    expect(next).toEqual([]);
  });

  it("leaves unrelated transactions untouched", () => {
    const other = { id: "t-other", type: "gasto", category: "Transporte", amount: 100, date: "2026-01-01" };
    const animal = { id: "a1", estado: "Vendido", saleDate: "2026-03-10", salePrice: 1400000 };
    const next = syncLevanteSaleTransaction([other], animal);
    expect(next).toHaveLength(2);
    expect(next).toContainEqual(other);
  });

  it("removeLevanteSaleTransaction removes only the transaction linked to that animal", () => {
    const animal1 = { id: "a1", estado: "Vendido", saleDate: "2026-03-10", salePrice: 1400000 };
    const animal2 = { id: "a2", estado: "Vendido", saleDate: "2026-03-11", salePrice: 900000 };
    let txs = syncLevanteSaleTransaction([], animal1);
    txs = syncLevanteSaleTransaction(txs, animal2);
    const next = removeLevanteSaleTransaction(txs, "a1");
    expect(next.map(t => t.id)).toEqual([levanteTransactionId("a2")]);
  });
});

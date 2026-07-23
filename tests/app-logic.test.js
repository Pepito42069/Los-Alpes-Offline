import { describe, it, expect, beforeEach } from "vitest";
import {
  STORAGE_KEY, PIE_COLORS,
  uid, fmtCOP, fmtDate, monthLabel, todayISO,
  loadData, saveData,
  computeMonthly, computeSummary,
  totalProducido, computeMilkBalance, computeMilkChartMax, findDuplicateMilkRecord,
  computeReport, buildTransactionsCsv, buildBackupPayload, parseBackupData,
  parseTransactionForm, parseInventoryForm, parseMilkForm,
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
describe("loadData / saveData", () => {
  it("returns an empty default shape when storage is empty", () => {
    const storage = makeFakeStorage();
    expect(loadData(storage)).toEqual({ transactions: [], inventory: [], cows: [], milkRecords: [] });
  });

  it("falls back to defaults when stored JSON is corrupt", () => {
    const storage = makeFakeStorage();
    storage.setItem(STORAGE_KEY, "{not valid json");
    expect(loadData(storage)).toEqual({ transactions: [], inventory: [], cows: [], milkRecords: [] });
  });

  it("round-trips state through save then load", () => {
    const storage = makeFakeStorage();
    const state = {
      transactions: [{ id: "1", type: "ingreso", category: "Venta de leche", amount: 1000, date: "2026-01-01", note: "" }],
      inventory: [{ id: "2", name: "Sal", category: "Concentrado y sales", quantity: 5, unit: "kg", unitValue: 100, minStock: 1, lastUpdated: "2026-01-01" }],
      cows: [{ id: "3", name: "Lola" }],
      milkRecords: [{ id: "4", date: "2026-01-01", perCow: { 3: 10 }, farmConsumption: 1, calfConsumption: 1, deliveredToMilkman: 8, note: "" }],
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
  it("sums numeric perCow values", () => {
    expect(totalProducido({ perCow: { a: 5, b: 3.5 } })).toBe(8.5);
  });
  it("treats missing or non-numeric values as zero", () => {
    expect(totalProducido({ perCow: { a: "not-a-number" } })).toBe(0);
    expect(totalProducido({})).toBe(0);
  });
});

describe("computeMilkBalance", () => {
  it("computes producido minus total consumption", () => {
    const record = { perCow: { a: 10, b: 5 }, farmConsumption: 2, calfConsumption: 1, deliveredToMilkman: 10 };
    const { producido, usado, balance } = computeMilkBalance(record);
    expect(producido).toBe(15);
    expect(usado).toBe(13);
    expect(balance).toBe(2);
  });

  it("can be negative when consumption exceeds production", () => {
    const record = { perCow: { a: 5 }, farmConsumption: 3, calfConsumption: 2, deliveredToMilkman: 4 };
    expect(computeMilkBalance(record).balance).toBe(-4);
  });
});

describe("computeMilkChartMax", () => {
  it("returns 1 for an empty record list", () => {
    expect(computeMilkChartMax([])).toBe(1);
  });
  it("returns the largest of producido/deliveredToMilkman across records", () => {
    const records = [
      { perCow: { a: 3 }, deliveredToMilkman: 2 },
      { perCow: { a: 1 }, deliveredToMilkman: 20 },
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
});

describe("buildBackupPayload / parseBackupData", () => {
  const state = {
    transactions: [{ id: "1" }],
    inventory: [{ id: "2" }],
    cows: [{ id: "3" }],
    milkRecords: [{ id: "4" }],
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
    const result = parseBackupData(JSON.stringify({ transactions: [{ id: "x" }] }));
    expect(result).toEqual({ ok: true, data: { transactions: [{ id: "x" }], inventory: [], cows: [], milkRecords: [] } });
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
});

describe("parseInventoryForm", () => {
  it("accepts a valid submission and defaults unit/minStock", () => {
    const { valid, record } = parseInventoryForm({
      id: "", name: "  Sal mineral  ", category: "Concentrado y sales", quantity: "5", unit: "", unitValue: "1000", minStock: "",
    }, "2026-07-23");
    expect(valid).toBe(true);
    expect(record.name).toBe("Sal mineral");
    expect(record.unit).toBe("unidades");
    expect(record.minStock).toBeNull();
    expect(record.lastUpdated).toBe("2026-07-23");
  });

  it("parses a provided minStock", () => {
    const { record } = parseInventoryForm({ name: "Sal", category: "x", quantity: "5", unitValue: "10", minStock: "2" });
    expect(record.minStock).toBe(2);
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

  it("collects liters per cow and defaults consumption fields to zero", () => {
    const getValue = makeGetValue({ date: "2026-01-01", cow_c1: "8", cow_c2: "" });
    const { valid, record } = parseMilkForm(getValue, cows);
    expect(valid).toBe(true);
    expect(record.perCow).toEqual({ c1: 8 });
    expect(record.farmConsumption).toBe(0);
    expect(record.calfConsumption).toBe(0);
    expect(record.deliveredToMilkman).toBe(0);
  });

  it("is invalid without a date", () => {
    const getValue = makeGetValue({});
    expect(parseMilkForm(getValue, cows).valid).toBe(false);
  });

  it("treats a non-numeric cow entry as zero but still includes it", () => {
    const getValue = makeGetValue({ date: "2026-01-01", cow_c1: "not-a-number" });
    const { record } = parseMilkForm(getValue, cows);
    expect(record.perCow).toEqual({ c1: 0 });
  });
});

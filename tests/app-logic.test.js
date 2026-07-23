import { describe, it, expect, beforeEach } from "vitest";
import {
  STORAGE_KEY, PIE_COLORS,
  uid, fmtCOP, fmtDate, monthLabel, todayISO, escapeHtml,
  loadData, saveData, sanitizeAppData,
  computeMonthly, computeSummary,
  totalProducido, totalProducidoByOrdeno, computeMilkChartMax, findDuplicateMilkRecord,
  computeReport, buildTransactionsCsv, buildBackupPayload, parseBackupData,
  parseTransactionForm, parseInventoryForm, parseMilkForm, parseCowForm,
  milkTransactionId, getLastMilkPrice, computeMilkSaleTransaction,
  syncMilkSaleTransaction, removeMilkSaleTransaction,
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
    };
    expect(sanitizeAppData(data)).toEqual(data);
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
    expect(sanitizeAppData({})).toEqual({ transactions: [], inventory: [], cows: [], milkRecords: [] });
    expect(sanitizeAppData({ transactions: "not-an-array" })).toEqual({ transactions: [], inventory: [], cows: [], milkRecords: [] });
    expect(sanitizeAppData(null)).toEqual({ transactions: [], inventory: [], cows: [], milkRecords: [] });
  });

  it("rejects array entries (not plain records)", () => {
    expect(sanitizeAppData({ cows: [["not", "a", "record"]] }).cows).toEqual([]);
  });
});

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
    expect(result).toEqual({ ok: true, data: { transactions: state.transactions, inventory: [], cows: [], milkRecords: [] } });
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

  it("ignores calfConsumption when there are no calves", () => {
    const getValue = makeGetValue({
      date: "2026-01-01", am_c1: "6", pm_c1: "4", farmConsumption: "2", calfConsumption: "3",
    });
    const { record } = parseMilkForm(getValue, cows, false);
    expect(record.calfConsumption).toBe(0);
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

  it("forces calfConsumption to zero and records hasCalves:false when there are no calves", () => {
    const getValue = makeGetValue({ date: "2026-01-01", calfConsumption: "7" });
    const { record } = parseMilkForm(getValue, cows, false);
    expect(record.calfConsumption).toBe(0);
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

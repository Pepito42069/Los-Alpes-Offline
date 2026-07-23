// ---------- Pure logic module (no DOM) ----------
// Extracted from index.html so it can be unit tested and shared.

export const STORAGE_KEY = "finca-offline-data-v1";

export const INCOME_CATS = ["Venta de leche","Venta de ganado de levante","Venta de terneros","Venta de descarte","Otros ingresos"];
export const EXPENSE_CATS = ["Concentrado y sales","Veterinario y medicamentos","Mano de obra","Pastos y potreros","Transporte","Mantenimiento","Otros gastos"];
export const INV_CATS = ["Concentrado y sales","Medicamentos veterinarios","Insumos de ordeño","Ganado (lotes)","Herramientas y equipo"];
export const UNIT_OPTIONS = ["Cantidad","Litros","Mililitros","Kilos"];
export const COW_STATES = ["En producción","Levante","Seca"];
export const HERD_EVENT_TYPES = ["Nacimiento","Muerte"];
export const LEVANTE_STATES = ["En levante","Vendido"];
export const CONCENTRADO_CATEGORY = "Concentrado y sales";
export const PIE_COLORS = ["#9A3324","#B8791F","#5C7A4B","#3B5940","#C9584A","#7E9C6C"];

// Cows saved before the estado field existed have none; treat those as "En
// producción" so they keep appearing in the daily milk form after upgrade.
export const cowEstado = (cow) => COW_STATES.includes(cow?.estado) ? cow.estado : "En producción";
export const isProductionCow = (cow) => cowEstado(cow) === "En producción";

export const uid = () => Math.random().toString(36).slice(2,10);
export const fmtCOP = (n) => new Intl.NumberFormat("es-CO",{style:"currency",currency:"COP",maximumFractionDigits:0}).format(n||0);
export const fmtDate = (iso) => { if(!iso) return ""; const d=new Date(iso+"T00:00:00"); return d.toLocaleDateString("es-CO",{day:"2-digit",month:"short",year:"numeric"}); };
export const monthLabel = (iso) => { const d=new Date(iso+"T00:00:00"); return d.toLocaleDateString("es-CO",{month:"short",year:"2-digit"}); };
export const todayISO = () => new Date().toISOString().slice(0,10);

// Every string rendered into innerHTML (record fields, imported backups)
// must go through this: the app builds its UI with template strings, so an
// unescaped value is a stored-XSS vector — most reachable via a crafted
// "respaldo" JSON file shared with the farm owner and imported.
const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);

// ---------- Storage ----------
const isPlainRecord = (x) => !!x && typeof x === "object" && !Array.isArray(x);
// Require an actual YYYY-MM-DD shape, not just any string — computeReport's
// date-range filter and computeMonthly's grouping both rely on ISO-format
// lexicographic ordering, and a non-date string here can also carry a CSV
// formula-injection payload straight into exported reports.
const isIsoDate = (x) => typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x);

// Guards against malformed/malicious data (corrupted localStorage, a hand-edited
// or crafted backup file) crashing the app later — e.g. computeMonthly does
// t.date.slice(...), which throws if date is missing, taking the whole render down.
export function sanitizeAppData(data){
  const transactions = Array.isArray(data?.transactions) ? data.transactions : [];
  const inventory = Array.isArray(data?.inventory) ? data.inventory : [];
  const cows = Array.isArray(data?.cows) ? data.cows : [];
  const milkRecords = Array.isArray(data?.milkRecords) ? data.milkRecords : [];
  const herdEvents = Array.isArray(data?.herdEvents) ? data.herdEvents : [];
  const levanteAnimals = Array.isArray(data?.levanteAnimals) ? data.levanteAnimals : [];
  return {
    transactions: transactions.filter(t =>
      isPlainRecord(t) && isIsoDate(t.date) &&
      (t.type === "ingreso" || t.type === "gasto") &&
      typeof t.amount === "number" && isFinite(t.amount)
    ),
    inventory: inventory.filter(i =>
      isPlainRecord(i) && typeof i.name === "string" &&
      typeof i.quantity === "number" && isFinite(i.quantity) &&
      typeof i.unitValue === "number" && isFinite(i.unitValue)
    ),
    cows: cows.filter(c => isPlainRecord(c) && typeof c.name === "string"),
    milkRecords: milkRecords.filter(r => isPlainRecord(r) && isIsoDate(r.date)),
    herdEvents: herdEvents.filter(e =>
      isPlainRecord(e) && isIsoDate(e.date) && HERD_EVENT_TYPES.includes(e.type) &&
      typeof e.count === "number" && isFinite(e.count)
    ),
    levanteAnimals: levanteAnimals.filter(a =>
      isPlainRecord(a) && typeof a.name === "string" &&
      isIsoDate(a.purchaseDate) && typeof a.purchasePrice === "number" && isFinite(a.purchasePrice)
    ),
  };
}

export function loadData(storage){
  try{
    const raw = storage.getItem(STORAGE_KEY);
    if(raw) return sanitizeAppData(JSON.parse(raw));
  }catch(e){ console.error(e); }
  return { transactions: [], inventory: [], cows: [], milkRecords: [], herdEvents: [], levanteAnimals: [] };
}

export function saveData(storage, state){
  storage.setItem(STORAGE_KEY, JSON.stringify({
    transactions: state.transactions, inventory: state.inventory,
    cows: state.cows, milkRecords: state.milkRecords, herdEvents: state.herdEvents,
    levanteAnimals: state.levanteAnimals,
  }));
}

// ---------- Resumen ----------
export function computeMonthly(transactions){
  const map = {};
  transactions.forEach(t=>{
    const key = t.date.slice(0,7);
    if(!map[key]) map[key] = { key, label: monthLabel(t.date), ingreso:0, gasto:0 };
    map[key][t.type] += t.amount;
  });
  return Object.values(map).sort((a,b)=>a.key.localeCompare(b.key)).slice(-6);
}

export function computeSummary(state){
  const ingresos = state.transactions.filter(t=>t.type==="ingreso").reduce((s,t)=>s+t.amount,0);
  const gastos = state.transactions.filter(t=>t.type==="gasto").reduce((s,t)=>s+t.amount,0);
  const balance = ingresos-gastos;
  const valorInv = state.inventory.reduce((s,i)=>s+i.quantity*i.unitValue,0);
  const monthly = computeMonthly(state.transactions);
  const maxVal = Math.max(1, ...monthly.flatMap(m=>[m.ingreso,m.gasto]));
  const lowStock = state.inventory.filter(i=>i.minStock!=null && i.quantity<=i.minStock);
  return { ingresos, gastos, balance, valorInv, monthly, maxVal, lowStock };
}

// ---------- Producción de leche ----------
// perCow values are either { am, pm } (two ordeños) or, for records created
// before that feature existed, a plain number for the whole day (counted as
// the morning ordeño for lack of a real split).
export function totalProducido(record){
  return Object.values(record.perCow || {}).reduce((s,v)=>{
    if(v && typeof v === "object") return s + (parseFloat(v.am)||0) + (parseFloat(v.pm)||0);
    return s + (parseFloat(v)||0);
  }, 0);
}

export function totalProducidoByOrdeno(record){
  return Object.values(record.perCow || {}).reduce((acc,v)=>{
    if(v && typeof v === "object"){
      acc.am += parseFloat(v.am)||0;
      acc.pm += parseFloat(v.pm)||0;
    } else {
      acc.am += parseFloat(v)||0;
    }
    return acc;
  }, { am: 0, pm: 0 });
}

export function computeMilkChartMax(records){
  return Math.max(1, ...records.flatMap(r=>{ const { am, pm } = totalProducidoByOrdeno(r); return [am, pm]; }));
}

export function findDuplicateMilkRecord(milkRecords, record){
  return milkRecords.find(r=>r.date===record.date && r.id!==record.id) || null;
}

// ---------- Reportes ----------
export function computeReport(transactions, from, to){
  const filtered = transactions.filter(t=>t.date>=from && t.date<=to).sort((a,b)=>a.date.localeCompare(b.date));
  const ingresos = filtered.filter(t=>t.type==="ingreso").reduce((s,t)=>s+t.amount,0);
  const gastos = filtered.filter(t=>t.type==="gasto").reduce((s,t)=>s+t.amount,0);

  const catMap = {};
  filtered.filter(t=>t.type==="gasto").forEach(t=>{ catMap[t.category]=(catMap[t.category]||0)+t.amount; });
  const catList = Object.entries(catMap).map(([name,value],i)=>({name,value,color:PIE_COLORS[i%PIE_COLORS.length]}));
  const total = catList.reduce((s,c)=>s+c.value,0) || 1;
  let acc = 0;
  const gradient = catList.map(c=>{ const start=acc/total*360; acc+=c.value; const end=acc/total*360; return `${c.color} ${start}deg ${end}deg`; }).join(", ");

  return { filtered, ingresos, gastos, catList, gradient };
}

const cowLitersFromEntry = (v) =>
  (v && typeof v === "object") ? (parseFloat(v.am)||0) + (parseFloat(v.pm)||0) : (parseFloat(v)||0);

// Per-cow profitability over a date range. Income is each cow's produced
// liters valued at that day's registered price. The concentrado-y-sales
// expense is NOT measured per animal, so it's split across cows in proportion
// to each one's share of total production in the period — an estimate, flagged
// as such in the UI. Rows cover every cow that produced in the range (a cow
// dried off after producing still contributed to that period's costs), sorted
// by margin descending.
export function computeCowProfitability(cows, milkRecords, transactions, from, to){
  const inRange = milkRecords.filter(r => r.date >= from && r.date <= to);
  const perCow = {};
  let totalLiters = 0;
  inRange.forEach(r => {
    const price = (typeof r.pricePerLiter === "number" && r.pricePerLiter > 0) ? r.pricePerLiter : 0;
    Object.entries(r.perCow || {}).forEach(([cowId, v]) => {
      const liters = cowLitersFromEntry(v);
      if(liters <= 0) return;
      if(!perCow[cowId]) perCow[cowId] = { liters: 0, ingreso: 0 };
      perCow[cowId].liters += liters;
      perCow[cowId].ingreso += liters * price;
      totalLiters += liters;
    });
  });

  const concentradoCost = transactions
    .filter(t => t.type === "gasto" && t.category === CONCENTRADO_CATEGORY && t.date >= from && t.date <= to)
    .reduce((s, t) => s + t.amount, 0);

  const nameById = {};
  cows.forEach(c => { nameById[c.id] = c.name; });

  const rows = Object.entries(perCow).map(([cowId, agg]) => {
    const share = totalLiters > 0 ? agg.liters / totalLiters : 0;
    const assignedCost = concentradoCost * share;
    return {
      cowId,
      name: nameById[cowId] || "(vaca eliminada)",
      liters: agg.liters,
      ingreso: agg.ingreso,
      assignedCost,
      margin: agg.ingreso - assignedCost,
    };
  }).sort((a, b) => b.margin - a.margin);

  return { rows, totalLiters, concentradoCost };
}

// Spreadsheet apps can interpret a cell starting with =, +, -, @, or a tab/CR
// as a formula (CSV/"formula injection"). A free-text note or a category
// carried over from an imported backup could start with one of these, so
// neutralize it before it reaches Excel/Sheets.
const CSV_FORMULA_PREFIX = /^[=+\-@\t\r]/;
const sanitizeCsvField = (value) => {
  const str = String(value ?? "");
  return CSV_FORMULA_PREFIX.test(str) ? "'" + str : str;
};

export function buildTransactionsCsv(transactions){
  let csv = "Fecha,Tipo,Categoria,Monto,Nota\n";
  transactions.forEach(t=>{
    // date isn't guaranteed to actually look like a date — sanitizeAppData only
    // checks it's a string, so an imported backup could carry a formula there too.
    const date = sanitizeCsvField(t.date);
    const category = sanitizeCsvField(t.category).replace(/"/g,'""');
    const note = sanitizeCsvField(t.note||"").replace(/"/g,'""');
    csv += `${date},${t.type},"${category}",${t.amount},"${note}"\n`;
  });
  return csv;
}

export function buildBackupPayload(state, exportedAt = new Date().toISOString()){
  return JSON.stringify({
    transactions: state.transactions, inventory: state.inventory,
    cows: state.cows, milkRecords: state.milkRecords, herdEvents: state.herdEvents,
    levanteAnimals: state.levanteAnimals, exportedAt,
  }, null, 2);
}

export function parseBackupData(jsonString){
  try{
    const parsed = JSON.parse(jsonString);
    return { ok: true, data: sanitizeAppData(parsed) };
  }catch(e){
    return { ok:false };
  }
}

// ---------- Form parsing / validation ----------
export function parseTransactionForm(fields){
  const amt = parseFloat(fields.amount);
  if(!amt || amt<=0 || !fields.date) return { valid:false };
  return {
    valid: true,
    record: {
      id: fields.id || uid(),
      type: fields.type,
      category: fields.category,
      amount: amt,
      date: fields.date,
      note: (fields.note||"").trim(),
    },
  };
}

export function parseInventoryForm(fields, lastUpdated = todayISO()){
  const q = parseFloat(fields.quantity);
  const uv = parseFloat(fields.unitValue);
  if(!fields.name || isNaN(q) || isNaN(uv)) return { valid:false };
  return {
    valid: true,
    record: {
      id: fields.id || uid(),
      name: fields.name.trim(),
      category: fields.category,
      quantity: q,
      unit: fields.unit || "Cantidad",
      unitValue: uv,
      minStock: fields.minStock===""||fields.minStock==null ? null : parseFloat(fields.minStock),
      lastUpdated,
    },
  };
}

export function parseMilkForm(getValue, cows, hasCalves = true){
  const date = getValue("date");
  if(!date) return { valid:false };
  const perCow = {};
  cows.forEach(c=>{
    const am = getValue("am_"+c.id);
    const pm = getValue("pm_"+c.id);
    if((am!==null && am!=="") || (pm!==null && pm!=="")){
      perCow[c.id] = { am: parseFloat(am)||0, pm: parseFloat(pm)||0 };
    }
  });
  const farmConsumption = parseFloat(getValue("farmConsumption"))||0;
  const calfConsumption = hasCalves ? (parseFloat(getValue("calfConsumption"))||0) : 0;
  return {
    valid: true,
    record: {
      id: getValue("id") || uid(),
      date,
      perCow,
      farmConsumption,
      calfConsumption,
      hasCalves,
      deliveredToMilkman: parseFloat(getValue("deliveredToMilkman"))||0,
      pricePerLiter: parseFloat(getValue("pricePerLiter"))||0,
      note: (getValue("note")||"").trim(),
    },
  };
}

export function parseCowForm(fields){
  const name = (fields.name||"").trim();
  if(!name) return { valid:false };
  const weight = fields.weight===""||fields.weight==null ? null : parseFloat(fields.weight);
  return {
    valid: true,
    record: {
      id: fields.id || uid(),
      name,
      estado: COW_STATES.includes(fields.estado) ? fields.estado : "En producción",
      weight: weight!=null && !isNaN(weight) ? weight : null,
      lastCalvingDate: fields.lastCalvingDate || null,
      healthNotes: (fields.healthNotes||"").trim(),
    },
  };
}

// The daily milk form only lists cows in production, but when editing an
// existing record it must also list any cow that already has liters recorded
// there — otherwise a cow that was dried off after the record was made would
// have its data silently dropped on the next save.
export function milkFormCows(cows, editingRecord){
  const recorded = editingRecord && editingRecord.perCow ? new Set(Object.keys(editingRecord.perCow)) : new Set();
  return cows.filter(c => isProductionCow(c) || recorded.has(c.id));
}

// ---------- Auto-generated ("linked") transactions ----------
// Some source records (a milk day, a cattle purchase/sale) generate a Cuentas
// transaction whose id is derived from the source record's id. Re-saving the
// source updates that same transaction in place; deleting the source removes
// it. This shared helper does the create/update/remove so milk and herd stay
// consistent.
function upsertLinkedTransaction(transactions, id, linked){
  const idx = transactions.findIndex(t => t.id === id);
  if(!linked) return idx>=0 ? transactions.filter(t=>t.id!==id) : transactions;
  if(idx>=0){
    const next = transactions.slice();
    next[idx] = linked;
    return next;
  }
  return [...transactions, linked];
}

// ---------- Producción ↔ Cuentas ----------
export const milkTransactionId = (milkRecordId) => "milk-" + milkRecordId;

export function getLastMilkPrice(milkRecords){
  const withPrice = milkRecords.filter(r => typeof r.pricePerLiter === "number" && r.pricePerLiter > 0);
  if(withPrice.length === 0) return null;
  return [...withPrice].sort((a,b)=>a.date.localeCompare(b.date)).pop().pricePerLiter;
}

// Returns the transaction the milk record should generate, or null if it
// doesn't qualify (needs both delivered liters and a price above zero).
export function computeMilkSaleTransaction(record){
  const delivered = record.deliveredToMilkman;
  const price = record.pricePerLiter;
  if(!(delivered > 0) || !(price > 0)) return null;
  return {
    id: milkTransactionId(record.id),
    type: "ingreso",
    category: "Venta de leche",
    amount: delivered * price,
    date: record.date,
    note: "Generado automáticamente desde producción de leche",
  };
}

export function syncMilkSaleTransaction(transactions, record){
  return upsertLinkedTransaction(transactions, milkTransactionId(record.id), computeMilkSaleTransaction(record));
}

export function removeMilkSaleTransaction(transactions, milkRecordId){
  return transactions.filter(t => t.id !== milkTransactionId(milkRecordId));
}

// ---------- Ganado: nacimientos y mortalidad ----------
// Births and deaths are simple counted events (no money attached).
export function parseHerdEventForm(fields){
  const type = HERD_EVENT_TYPES.includes(fields.type) ? fields.type : null;
  if(!type || !isIsoDate(fields.date)) return { valid:false };
  const count = Math.round(parseFloat(fields.count));
  if(!(count > 0)) return { valid:false };
  return {
    valid: true,
    record: {
      id: fields.id || uid(),
      type,
      date: fields.date,
      count,
      note: (fields.note||"").trim(),
    },
  };
}

// Net change in head from recorded events: births add, deaths subtract. It's a
// movement tally, not a live census (it doesn't know the starting herd size),
// so the UI labels it as a variation.
export function summarizeHerd(events){
  const by = { "Nacimiento":0, "Muerte":0 };
  events.forEach(e => { if(by[e.type] != null) by[e.type] += e.count; });
  return { nacimientos: by["Nacimiento"], muertes: by["Muerte"], neto: by["Nacimiento"] - by["Muerte"] };
}

// ---------- Ganado de levante (per-animal buy/sell) ----------
// Each levante animal is bought, raised ("En levante"), and later sold. Its
// profit is only realized once sold: precio de venta − precio de compra. This
// registry is self-contained — it tracks its own ledger and doesn't push
// transactions into Cuentas.
const optionalNumber = (v) => {
  if(v === "" || v == null) return null;
  const n = parseFloat(v);
  return isFinite(n) ? n : null;
};

export function parseLevanteForm(fields){
  const name = (fields.name||"").trim();
  const purchasePrice = parseFloat(fields.purchasePrice);
  if(!name || !isIsoDate(fields.purchaseDate) || !isFinite(purchasePrice) || purchasePrice < 0){
    return { valid:false };
  }
  const sold = fields.estado === "Vendido";
  const salePrice = sold ? parseFloat(fields.salePrice) : NaN;
  if(sold && (!isIsoDate(fields.saleDate) || !isFinite(salePrice) || salePrice < 0)){
    return { valid:false };
  }
  return {
    valid: true,
    record: {
      id: fields.id || uid(),
      name,
      purchaseDate: fields.purchaseDate,
      purchasePrice,
      purchaseWeight: optionalNumber(fields.purchaseWeight),
      estado: sold ? "Vendido" : "En levante",
      saleDate: sold ? fields.saleDate : null,
      salePrice: sold ? salePrice : null,
      saleWeight: sold ? optionalNumber(fields.saleWeight) : null,
    },
  };
}

export function levanteGanancia(animal){
  if(animal.estado !== "Vendido") return null;
  if(typeof animal.salePrice !== "number" || typeof animal.purchasePrice !== "number") return null;
  return animal.salePrice - animal.purchasePrice;
}

// Splits the herd into animals sold within the date range (each with its
// realized ganancia, newest sale first) and animals still being raised (no
// ganancia yet), plus the accumulated ganancia over the range.
export function computeLevanteProfit(animals, from, to){
  const sold = animals
    .filter(a => a.estado === "Vendido" && isIsoDate(a.saleDate) && a.saleDate >= from && a.saleDate <= to)
    .map(a => ({ ...a, ganancia: levanteGanancia(a) }))
    .sort((x, y) => y.saleDate.localeCompare(x.saleDate));
  const totalGanancia = sold.reduce((s, a) => s + a.ganancia, 0);
  const enLevante = animals.filter(a => a.estado !== "Vendido");
  return { sold, totalGanancia, enLevante };
}

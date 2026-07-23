// ---------- Pure logic module (no DOM) ----------
// Extracted from index.html so it can be unit tested and shared.

export const STORAGE_KEY = "finca-offline-data-v1";

export const INCOME_CATS = ["Venta de leche","Venta de ganado de levante","Venta de terneros","Venta de descarte","Otros ingresos"];
export const EXPENSE_CATS = ["Concentrado y sales","Veterinario y medicamentos","Mano de obra","Pastos y potreros","Transporte","Mantenimiento","Otros gastos"];
export const INV_CATS = ["Concentrado y sales","Medicamentos veterinarios","Insumos de ordeño","Ganado (lotes)","Herramientas y equipo"];
export const PIE_COLORS = ["#9A3324","#B8791F","#5C7A4B","#3B5940","#C9584A","#7E9C6C"];

export const uid = () => Math.random().toString(36).slice(2,10);
export const fmtCOP = (n) => new Intl.NumberFormat("es-CO",{style:"currency",currency:"COP",maximumFractionDigits:0}).format(n||0);
export const fmtDate = (iso) => { if(!iso) return ""; const d=new Date(iso+"T00:00:00"); return d.toLocaleDateString("es-CO",{day:"2-digit",month:"short",year:"numeric"}); };
export const monthLabel = (iso) => { const d=new Date(iso+"T00:00:00"); return d.toLocaleDateString("es-CO",{month:"short",year:"2-digit"}); };
export const todayISO = () => new Date().toISOString().slice(0,10);

// ---------- Storage ----------
export function loadData(storage){
  try{
    const raw = storage.getItem(STORAGE_KEY);
    if(raw) return JSON.parse(raw);
  }catch(e){ console.error(e); }
  return { transactions: [], inventory: [], cows: [], milkRecords: [] };
}

export function saveData(storage, state){
  storage.setItem(STORAGE_KEY, JSON.stringify({
    transactions: state.transactions, inventory: state.inventory,
    cows: state.cows, milkRecords: state.milkRecords,
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
// before that feature existed, a plain number for the whole day.
export function totalProducido(record){
  return Object.values(record.perCow || {}).reduce((s,v)=>{
    if(v && typeof v === "object") return s + (parseFloat(v.am)||0) + (parseFloat(v.pm)||0);
    return s + (parseFloat(v)||0);
  }, 0);
}

// The amount delivered to the milkman is not entered by hand; it's derived
// so the daily balance is zero by construction (any losses show up as a
// discrepancy the farmer has to go re-check, not as slack in this field).
export function computeDeliveredToMilkman(producido, farmConsumption, calfConsumption){
  return producido - farmConsumption - calfConsumption;
}

export function computeMilkBalance(record){
  const producido = totalProducido(record);
  const calf = record.hasCalves===false ? 0 : record.calfConsumption;
  const usado = record.farmConsumption + calf + record.deliveredToMilkman;
  return { producido, usado, balance: producido - usado };
}

export function computeMilkChartMax(records){
  return Math.max(1, ...records.flatMap(r=>[totalProducido(r), r.deliveredToMilkman]));
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

export function buildTransactionsCsv(transactions){
  let csv = "Fecha,Tipo,Categoria,Monto,Nota\n";
  transactions.forEach(t=>{ csv += `${t.date},${t.type},"${t.category}",${t.amount},"${(t.note||'').replace(/"/g,'""')}"\n`; });
  return csv;
}

export function buildBackupPayload(state, exportedAt = new Date().toISOString()){
  return JSON.stringify({
    transactions: state.transactions, inventory: state.inventory,
    cows: state.cows, milkRecords: state.milkRecords, exportedAt,
  }, null, 2);
}

export function parseBackupData(jsonString){
  try{
    const parsed = JSON.parse(jsonString);
    return {
      ok: true,
      data: {
        transactions: parsed.transactions || [],
        inventory: parsed.inventory || [],
        cows: parsed.cows || [],
        milkRecords: parsed.milkRecords || [],
      },
    };
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
      unit: (fields.unit||"unidades").trim(),
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
  const producido = totalProducido({ perCow });
  return {
    valid: true,
    record: {
      id: getValue("id") || uid(),
      date,
      perCow,
      farmConsumption,
      calfConsumption,
      hasCalves,
      deliveredToMilkman: computeDeliveredToMilkman(producido, farmConsumption, calfConsumption),
      note: (getValue("note")||"").trim(),
    },
  };
}

/** Parsers for spreadsheet and marketplace exports. Pure functions, unit tested. */

const EXCEL_ERRORS = /^#(VALUE!|DIV\/0!|REF!|N\/A|NAME\?|NUM!|NULL!|SPILL!|CALC!)$/;

/** Trims, and treats Excel error cells as empty. */
export function cell(value: string | undefined): string {
  const v = (value ?? '').trim();
  return EXCEL_ERRORS.test(v) ? '' : v;
}

/** "21,227.95", "$591", "-1,000", "55" -> cents. Empty -> null. Garbage -> NaN. */
export function moneyToCents(value: string | undefined): number | null {
  const v = cell(value).replace(/[$,\s]/g, '');
  if (!v) return null;
  if (!/^-?\d+(\.\d{1,2})?$/.test(v)) return Number.NaN;
  const [whole, frac = ''] = v.replace('-', '').split('.');
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return v.startsWith('-') ? -cents : cents;
}

/** US M/D/YYYY -> ISO date (YYYY-MM-DD). Empty -> null. Invalid -> undefined. */
export function usDate(value: string | undefined): string | null | undefined {
  const v = cell(value);
  if (!v) return null;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  if (!m) return undefined;
  const [, mo, d, y] = m.map(Number) as [number, number, number, number];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return undefined;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ZONES: Record<string, string> = { PDT: '-07:00', PST: '-08:00', MDT: '-06:00', MST: '-07:00', CDT: '-05:00', CST: '-06:00', EDT: '-04:00', EST: '-05:00', GMT: '+00:00', UTC: '+00:00' };

/** eBay Seller Hub export date, e.g. "Aug-28-25 16:15:35 PDT". Empty -> null. Invalid -> undefined. */
export function ebayDate(value: string | undefined): Date | null | undefined {
  const v = cell(value);
  if (!v) return null;
  const m = /^([A-Z][a-z]{2})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) ([A-Z]{3})$/.exec(v);
  if (!m) return undefined;
  const [, mon, dd, yy, hh, mi, ss, tz] = m;
  const month = MONTHS.indexOf(mon!) + 1;
  const offset = ZONES[tz!];
  if (!month || !offset) return undefined;
  const d = new Date(`20${yy}-${String(month).padStart(2, '0')}-${dd}T${hh}:${mi}:${ss}${offset}`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

const VIN_VALUES: Record<string, number> = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9, S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
};
const VIN_WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

export function normalizeVin(value: string | undefined): string | null {
  const v = cell(value).toUpperCase().replace(/\s+/g, '');
  return v || null;
}

/** 17-character VIN with a correct North American check digit (position 9). */
export function vinIsValid(vin: string): boolean {
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) return false;
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const c = vin.charAt(i);
    const value = /\d/.test(c) ? Number(c) : VIN_VALUES[c]!;
    sum += value * VIN_WEIGHTS.at(i)!;
  }
  const check = sum % 11 === 10 ? 'X' : String(sum % 11);
  return vin.charAt(8) === check;
}

/** World manufacturer identifiers seen at dismantlers. Unknown -> null (decoded online later). */
const WMI: Record<string, string> = {
  WBA: 'BMW', WBS: 'BMW', WBY: 'BMW', WBX: 'BMW', '5UX': 'BMW', '5UJ': 'BMW', '5YM': 'BMW', '4US': 'BMW', '5YJ': 'Tesla', '7SA': 'Tesla', LRW: 'Tesla',
  WP0: 'Porsche', WP1: 'Porsche', SAJ: 'Jaguar', SAL: 'Land Rover', SAD: 'Jaguar', WDD: 'Mercedes-Benz', WDB: 'Mercedes-Benz', W1K: 'Mercedes-Benz',
  W1N: 'Mercedes-Benz', '4JG': 'Mercedes-Benz', '55S': 'Mercedes-Benz', WAU: 'Audi', WA1: 'Audi', WUA: 'Audi', WVW: 'Volkswagen', WVG: 'Volkswagen',
  '3VW': 'Volkswagen', '1VW': 'Volkswagen', ZFF: 'Ferrari', ZHW: 'Lamborghini', SCF: 'Aston Martin', SCB: 'Bentley', SBM: 'McLaren', SCA: 'Rolls-Royce',
  WMW: 'MINI', JTH: 'Lexus', JT2: 'Toyota', JTD: 'Toyota', '4T1': 'Toyota', '5YF': 'Toyota', JN1: 'Nissan', '1N4': 'Nissan', JHM: 'Honda', '1HG': 'Honda',
  '1G1': 'Chevrolet', '1FA': 'Ford', '1FT': 'Ford', '1C4': 'Jeep', '1J4': 'Jeep',
};

export function makeFromVin(vin: string | null): string | null {
  return vin ? (WMI[vin.slice(0, 3)] ?? null) : null;
}

const TITLE_MAKES = ['BMW', 'Porsche', 'Tesla', 'Jaguar', 'Mercedes-Benz', 'Mercedes', 'Audi', 'Volkswagen', 'Land Rover', 'Range Rover', 'Lamborghini', 'Ferrari', 'MINI', 'Lexus', 'Toyota', 'Nissan', 'Honda', 'Bentley', 'Maserati', 'McLaren'];

/** Finds a make named in a listing title, e.g. "1998-2003 OEM Jaguar XJ8 ..." -> "Jaguar". */
export function makeFromTitle(title: string): string | null {
  for (const make of TITLE_MAKES) {
    if (new RegExp(`\\b${make.replace('-', '[- ]?')}\\b`, 'i').test(title)) {
      if (make === 'Mercedes') return 'Mercedes-Benz';
      if (make === 'Range Rover') return 'Land Rover';
      return make;
    }
  }
  return null;
}

export interface ParsedSku {
  prefix: string;
  partName: string | null;
  isCarNumber: boolean;
}

/** Andrei's format: "<car number>#<part name>", e.g. "303#Rear Vent". Split on the first "#". */
export function parseSku(value: string | undefined): ParsedSku | null {
  const v = cell(value);
  const at = v.indexOf('#');
  if (at <= 0) return null;
  const prefix = v.slice(0, at).trim();
  const partName = v.slice(at + 1).trim() || null;
  if (!prefix) return null;
  return { prefix, partName, isCarNumber: /^\d+$/.test(prefix) };
}

export function bool(value: string | undefined): boolean | null {
  const v = cell(value).toUpperCase();
  if (v === 'TRUE' || v === 'YES' || v === 'Y' || v === '1') return true;
  if (v === 'FALSE' || v === 'NO' || v === 'N' || v === '0') return false;
  return null;
}

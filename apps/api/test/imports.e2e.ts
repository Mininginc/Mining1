import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../src/db/types.js';
import { ADMIN, resetDatabase, startApp } from './helpers.js';

const repo = resolve(import.meta.dirname, '../../..');
const CAR_FIXTURE = readFileSync(resolve(repo, 'docs/specs/m2-intake/fixtures-car-spreadsheet-sample.csv'), 'utf8');
const EBAY_FIXTURE = readFileSync(resolve(repo, 'docs/specs/m4-inventory/fixtures/ebay-active-listings-sample.csv'), 'utf8');

// Cars that the eBay sample's SKUs point to (303, 332, 333). Made-up VINs with valid check digits.
// 303 is deliberately a BMW while its eBay title says Jaguar, to exercise the mismatch check.
const LINKED_CARS = [
  'Car ID,VIN,Year,Model,Bought on,Car Cost',
  '303,WBAKG7C51BE000001,2011,335i,1/5/2025,"3,000.00"',
  '332,5YJSA1E21MF000001,2016,Model S,2/5/2025,"9,000.00"',
  '333,WP1AA2AY1BDA00001,2012,Cayenne,3/5/2025,"7,500.00"',
].join('\n');

let app: INestApplication;
let db: Kysely<Database>;
let admin: string;
const http = () => request(app.getHttpServer());
const auth = (t: string) => ({ authorization: `Bearer ${t}` });
const importCars = (content: string, extra: object = {}, token = admin) =>
  http().post('/intake/imports/car-sheet').set(auth(token)).send({ fileName: 'cars.csv', content, ...extra });
const importEbay = (content: string, token = admin) => http().post('/inventory/imports/ebay-csv').set(auth(token)).send({ fileName: 'ebay.csv', content });

async function tokenFor(role: string) {
  const email = `${role}@imports.test`;
  await http().post('/users').set(auth(admin)).send({ email, name: role, password: 'role-password-123', roles: [role] }).expect(201);
  return (await http().post('/auth/login').send({ email, password: 'role-password-123' })).body.accessToken as string;
}

beforeAll(async () => {
  db = await resetDatabase();
  app = await startApp();
  admin = (await http().post('/auth/login').send({ email: ADMIN.email, password: ADMIN.password })).body.accessToken;
});

afterAll(async () => {
  await app?.close();
  await db?.destroy();
});

describe('Car sheet import (AC1-3)', () => {
  let runId: string;

  it('AC1 imports the sample: 2 cars, 1 source, duplicate Car ID sent to review', async () => {
    const res = await importCars(CAR_FIXTURE);
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('succeeded');
    runId = res.body.runId;
    expect(res.body.counts).toMatchObject({ created: 2, updated: 0, sources_created: 1, skipped: 1 });
    const dup = res.body.issues.find((i: { code: string }) => i.code === 'duplicate_car_id');
    expect(dup).toMatchObject({ rowNumber: 5, ref: '9001' });

    const v = await db.selectFrom('intake.vehicles').selectAll().where('stock_number', '=', '9001').executeTakeFirstOrThrow();
    expect(Number(v.purchase_cost_cents)).toBe(450_000);
    expect(Number(v.opening_sales_cents)).toBe(910_050);
    expect(v.purchased_on).toBe('2024-03-04');
    expect(v.make).toBe('BMW');
    expect(v.mileage).toBe(98_000);
    expect(v.mileage_is_approximate).toBe(true);
    expect(v.title_in_hand).toBe(true);
    expect(v.sold_complete).toBe(false);
    expect(v.vin_valid).toBe(true);
    const v2 = await db.selectFrom('intake.vehicles').selectAll().where('stock_number', '=', '9002').executeTakeFirstOrThrow();
    expect(v2.title_in_hand).toBe(false);
    expect(v2.mileage).toBeNull();

    const source = await db.selectFrom('inventory.sources').selectAll().executeTakeFirstOrThrow();
    expect(source).toMatchObject({ code: 'Scrap Metal' });
    expect(Number(source.opening_sales_cents)).toBe(120_000);
  });

  it('records the run, its issues and an audit row per car', async () => {
    const runs = (await http().get('/imports').set(auth(admin))).body;
    expect(runs[0]).toMatchObject({ id: runId, kind: 'car_sheet', status: 'succeeded' });
    const issues = (await http().get(`/imports/${runId}/issues`).set(auth(admin))).body;
    expect(issues.map((i: { code: string }) => i.code)).toContain('duplicate_car_id');
    const audits = await db.selectFrom('platform.audit_log').select('action').where('action', '=', 'intake.vehicle.imported').execute();
    expect(audits).toHaveLength(2);
  });

  it('AC2 re-importing the same sheet changes nothing', async () => {
    const res = await importCars(CAR_FIXTURE);
    expect(res.body.counts).toMatchObject({ created: 0, updated: 0, unchanged: 2, sources_created: 0, sources_unchanged: 1 });
  });

  it('updates a car when the sheet changes', async () => {
    const changed = CAR_FIXTURE.replace('"12,000.00"', '"12,500.00"');
    const res = await importCars(changed);
    expect(res.body.counts).toMatchObject({ created: 0, updated: 1, unchanged: 1 });
    const v2 = await db.selectFrom('intake.vehicles').select('purchase_cost_cents').where('stock_number', '=', '9002').executeTakeFirstOrThrow();
    expect(Number(v2.purchase_cost_cents)).toBe(1_250_000);
  });

  it('AC3 remembers a column mapping for the next upload of the same layout', async () => {
    const odd = ['Stock,VIN,Cost $', '7001,WBAKG7C51BE000001,"1,234.00"'].join('\n');
    const first = await importCars(odd, { mapping: { stock_number: 'Stock', vin: 'VIN', purchase_cost: 'Cost $' } });
    expect(first.body.counts.created).toBe(1);
    const again = odd.replace('"1,234.00"', '"2,000.00"');
    const second = await importCars(again); // no mapping sent
    expect(second.body.counts.updated).toBe(1);
    const v = await db.selectFrom('intake.vehicles').select('purchase_cost_cents').where('stock_number', '=', '7001').executeTakeFirstOrThrow();
    expect(Number(v.purchase_cost_cents)).toBe(200_000);
  });

  it('flags bad VINs, duplicate VINs, bad dates and profit mismatches without dropping cars', async () => {
    const sheet = [
      'Car ID,VIN,Bought on,Car Cost,Total sales,Profit',
      '8001,5YMKTGC5XE0C89398,13/45/2024,"1,000.00","3,000.00","2,000.00"',
      '8002,5YMKTGC5XE0C89398,1/2/2024,"1,000.00","3,000.00","9,999.00"',
    ].join('\n');
    const res = await importCars(sheet);
    expect(res.body.counts.created).toBe(2);
    const codes = res.body.issues.map((i: { code: string }) => i.code).sort();
    expect(codes).toEqual(['duplicate_vin', 'duplicate_vin', 'invalid_date', 'profit_mismatch', 'vin_invalid', 'vin_invalid']);
  });

  it('refuses a file without Car ID and VIN columns as a failed run, importing nothing', async () => {
    const before = await db.selectFrom('intake.vehicles').select((eb) => eb.fn.countAll<string>().as('n')).executeTakeFirstOrThrow();
    const res = await importCars('Name,Price\nfoo,1');
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('failed');
    expect(res.body.error).toMatch(/header row/);
    const after = await db.selectFrom('intake.vehicles').select((eb) => eb.fn.countAll<string>().as('n')).executeTakeFirstOrThrow();
    expect(after.n).toBe(before.n);
  });
});

describe('eBay active listings CSV import (AC4a, 4b, 5)', () => {
  it('AC4a imports the 3 sample listings as out of stock with no shelf parts', async () => {
    await importCars(LINKED_CARS);
    const res = await importEbay(EBAY_FIXTURE);
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('succeeded');
    expect(res.body.counts).toMatchObject({ listings_created: 3, out_of_stock: 3, parts_created: 0, linked_to_car: 3, unlinked: 0 });

    const listings = await db.selectFrom('platform.external_listings').selectAll().orderBy('external_id').execute();
    expect(listings.map((l) => [l.external_id, l.sku, Number(l.price_cents), l.status, l.sold_quantity])).toEqual([
      ['277351217235', '303#Rear Vent', 5500, 'out_of_stock', 1],
      ['277411338250', '332#Satellite radio', 9800, 'out_of_stock', 1],
      ['277454927966', '333#Fender Flare', 6995, 'out_of_stock', 2],
    ]);
    expect(listings[0]!.title.startsWith('✅ 1998-2003 OEM Jaguar')).toBe(true);
    expect(listings[0]!.started_at!.toISOString()).toBe('2025-08-28T23:15:35.000Z');
    expect(await db.selectFrom('inventory.parts').selectAll().execute()).toHaveLength(0);
  });

  it('AC5 flags a label whose car does not match the title make', async () => {
    const runs = (await http().get('/imports').set(auth(admin))).body;
    const issues = (await http().get(`/imports/${runs[0].id}/issues`).set(auth(admin))).body as { code: string; message: string }[];
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: 'car_mismatch' });
    expect(issues[0]!.message).toMatch(/car 303 \(BMW\).*Jaguar/);
  });

  it('AC4b re-importing the same CSV changes nothing', async () => {
    const res = await importEbay(EBAY_FIXTURE);
    expect(res.body.counts).toMatchObject({ listings_created: 0, listings_updated: 0, listings_unchanged: 3, parts_created: 0 });
  });

  it('creates a shelf part when a listing has stock, and marks it sold when stock goes back to 0', async () => {
    const restocked = EBAY_FIXTURE.replace('333#Fender Flare,0,', '333#Fender Flare,2,');
    const up = await importEbay(restocked);
    expect(up.body.counts).toMatchObject({ listings_updated: 1, parts_created: 1 });
    const part = await db.selectFrom('inventory.parts').selectAll().executeTakeFirstOrThrow();
    const car = await db.selectFrom('intake.vehicles').select('id').where('stock_number', '=', '333').executeTakeFirstOrThrow();
    expect(part).toMatchObject({ sku: '333#Fender Flare', part_name: 'Fender Flare', quantity: 2, status: 'listed', vehicle_id: car.id });

    const down = await importEbay(EBAY_FIXTURE);
    expect(down.body.counts).toMatchObject({ listings_updated: 1, parts_updated: 1 });
    const after = await db.selectFrom('inventory.parts').selectAll().where('id', '=', part.id).executeTakeFirstOrThrow();
    expect(after).toMatchObject({ quantity: 0, status: 'sold' });
  });

  it('links a SKU with a source prefix to that source, and sends unknown prefixes to review', async () => {
    const header = EBAY_FIXTURE.split(/\r?\n/)[0];
    const csv = [header, '111111111111,Scrap bin turbo,,Scrap Metal#Turbo,1,FIXED_PRICE,USD,10,,,10,0,0,,,,,,,,Used,,,,,,US,,,', '222222222222,Mystery,,Nowhere#Thing,1,FIXED_PRICE,USD,10,,,10,0,0,,,,,,,,Used,,,,,,US,,,', '333333333333,No label,,,1,FIXED_PRICE,USD,10,,,10,0,0,,,,,,,,Used,,,,,,US,,,'].join('\n');
    const res = await importEbay(csv);
    expect(res.body.counts).toMatchObject({ listings_created: 3, linked_to_source: 1, unlinked: 2, parts_created: 3 });
    expect(res.body.issues.map((i: { code: string }) => i.code)).toEqual(['sku_unlinked', 'sku_unlinked']);
  });

  it('refuses a file that is not an eBay export, importing nothing', async () => {
    const res = await importEbay('a,b\n1,2');
    expect(res.body.status).toBe('failed');
    expect(res.body.error).toMatch(/missing "Item number"/);
  });
});

describe('Review queue (part 5)', () => {
  it('lists open problems across imports, filters by type, and resolves one with an audit row', async () => {
    const counts = (await http().get('/imports/issues/counts').set(auth(admin))).body as { code: string; count: string }[];
    const byCode = Object.fromEntries(counts.map((c) => [c.code, Number(c.count)]));
    expect(byCode.duplicate_car_id).toBeGreaterThanOrEqual(1);
    expect(byCode.car_mismatch).toBeGreaterThanOrEqual(1);

    const all = (await http().get('/imports/issues').set(auth(admin))).body as { id: string; code: string; kind: string }[];
    expect(all.length).toBe(Object.values(byCode).reduce((a, b) => a + b, 0));
    const dups = (await http().get('/imports/issues').query({ code: 'duplicate_car_id' }).set(auth(admin))).body as { id: string; code: string; kind: string }[];
    expect(dups.every((i) => i.code === 'duplicate_car_id' && i.kind === 'car_sheet')).toBe(true);

    const target = dups[0]!;
    const res = await http().post(`/imports/issues/${target.id}/resolve`).set(auth(admin)).send({ note: 'Second row was a typo; car 9001 is correct' });
    expect(res.status).toBe(200);
    expect(res.body.resolved_at).toEqual(expect.any(String));
    const after = (await http().get('/imports/issues').query({ code: 'duplicate_car_id' }).set(auth(admin))).body as { id: string }[];
    expect(after.map((i) => i.id)).not.toContain(target.id);

    const audit = await db.selectFrom('platform.audit_log').selectAll().where('action', '=', 'import.issue_resolved').executeTakeFirstOrThrow();
    expect(audit.entity_id).toBe(target.id);
    expect(audit.after).toMatchObject({ note: 'Second row was a typo; car 9001 is correct', code: 'duplicate_car_id' });

    // Resolving twice is harmless and does not add a second audit row.
    expect((await http().post(`/imports/issues/${target.id}/resolve`).set(auth(admin)).send({})).status).toBe(200);
    expect(await db.selectFrom('platform.audit_log').select('id').where('action', '=', 'import.issue_resolved').execute()).toHaveLength(1);
  });

  it('rejects bad and unknown issue ids', async () => {
    expect((await http().post('/imports/issues/abc/resolve').set(auth(admin)).send({})).status).toBe(400);
    expect((await http().post('/imports/issues/999999999/resolve').set(auth(admin)).send({})).status).toBe(404);
  });
});

describe('AC8 roles', () => {
  it('only admin and manager run imports; warehouse and sales can read the review queue', async () => {
    const sales = await tokenFor('sales');
    const warehouse = await tokenFor('warehouse');
    const manager = await tokenFor('manager');
    const yard = await tokenFor('yard_tech');
    expect((await importCars(CAR_FIXTURE, {}, sales)).status).toBe(403);
    expect((await importEbay(EBAY_FIXTURE, warehouse)).status).toBe(403);
    expect((await importEbay(EBAY_FIXTURE, manager)).status).toBe(201);
    expect((await http().get('/imports').set(auth(sales))).status).toBe(200);
    expect((await http().get('/imports').set(auth(warehouse))).status).toBe(200);
    expect((await http().get('/imports').set(auth(yard))).status).toBe(403);
    expect((await http().get('/vehicles').set(auth(yard))).status).toBe(200);
    expect((await http().get('/imports/issues').set(auth(sales))).status).toBe(200);
    const open = (await http().get('/imports/issues').set(auth(admin))).body as { id: string }[];
    expect((await http().post(`/imports/issues/${open[0]!.id}/resolve`).set(auth(sales)).send({})).status).toBe(403);
  });
});

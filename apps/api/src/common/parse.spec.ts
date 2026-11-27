import { describe, expect, it } from 'vitest';
import { bool, cell, ebayDate, makeFromTitle, makeFromVin, moneyToCents, parseSku, usDate, vinIsValid } from './parse.js';

describe('spreadsheet parsing', () => {
  it('treats Excel error cells as empty', () => {
    expect(cell('#VALUE!')).toBe('');
    expect(cell('#DIV/0!')).toBe('');
    expect(cell(' 42 ')).toBe('42');
  });
  it('reads money with separators into cents', () => {
    expect(moneyToCents('"21,227.95"'.replaceAll('"', ''))).toBe(2_122_795);
    expect(moneyToCents('4,500.00')).toBe(450_000);
    expect(moneyToCents('$591')).toBe(59_100);
    expect(moneyToCents('69.95')).toBe(6_995);
    expect(moneyToCents('-1,000.5')).toBe(-100_050);
    expect(moneyToCents('')).toBeNull();
    expect(moneyToCents('#DIV/0!')).toBeNull();
    expect(moneyToCents('abc')).toBeNaN();
  });
  it('reads US dates and rejects impossible ones', () => {
    expect(usDate('3/4/2024')).toBe('2024-03-04');
    expect(usDate('12/31/2019')).toBe('2019-12-31');
    expect(usDate('2/30/2024')).toBeUndefined();
    expect(usDate('2024-03-04')).toBeUndefined();
    expect(usDate('')).toBeNull();
  });
  it('reads eBay export dates with their time zone', () => {
    expect(ebayDate('Aug-28-25 16:15:35 PDT')?.toISOString()).toBe('2025-08-28T23:15:35.000Z');
    expect(ebayDate('Nov-28-26 16:15:35 PST')?.toISOString()).toBe('2026-11-29T00:15:35.000Z');
    expect(ebayDate('garbage')).toBeUndefined();
  });
  it('reads booleans', () => {
    expect(bool('TRUE')).toBe(true);
    expect(bool('FALSE')).toBe(false);
    expect(bool('')).toBeNull();
  });
});

describe('VINs', () => {
  it('validates the check digit', () => {
    expect(vinIsValid('5YMGZ0C57BLK13953')).toBe(true);
    expect(vinIsValid('11111111111111111')).toBe(true);
    expect(vinIsValid('5YMKTGC5XE0C89399')).toBe(false);
    expect(vinIsValid('WBA123')).toBe(false);
    expect(vinIsValid('WBAOOOOOOOOOOOOOO')).toBe(false);
  });
  it('decodes common makes from the first three characters', () => {
    expect(makeFromVin('WBSWD93579P361250')).toBe('BMW');
    expect(makeFromVin('5YJSA1E26MF000000')).toBe('Tesla');
    expect(makeFromVin('WP1AA2AY0BDA00000')).toBe('Porsche');
    expect(makeFromVin('ZZZ00000000000000')).toBeNull();
  });
  it('finds the make in a listing title', () => {
    expect(makeFromTitle('✅ 1998-2003 OEM Jaguar XJ8 XJR Rear Center Console')).toBe('Jaguar');
    expect(makeFromTitle('12-20 OEM Tesla Model S Radio Receiver')).toBe('Tesla');
    expect(makeFromTitle('Mercedes Benz W222 mirror')).toBe('Mercedes-Benz');
    expect(makeFromTitle('Some part')).toBeNull();
  });
});

describe('eBay custom label (SKU)', () => {
  it('splits car number and part name on the first #', () => {
    expect(parseSku('303#Rear Vent')).toEqual({ prefix: '303', partName: 'Rear Vent', isCarNumber: true });
    expect(parseSku('332#Satellite radio')).toEqual({ prefix: '332', partName: 'Satellite radio', isCarNumber: true });
    expect(parseSku('Atlas#Turbo #2')).toEqual({ prefix: 'Atlas', partName: 'Turbo #2', isCarNumber: false });
  });
  it('rejects labels without a usable prefix', () => {
    expect(parseSku('Rear Vent')).toBeNull();
    expect(parseSku('#Rear Vent')).toBeNull();
    expect(parseSku('')).toBeNull();
  });
});

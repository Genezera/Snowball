import { describe, it, expect } from 'vitest';
import { reconciliarPnl, TOLERANCIA_ABSOLUTA, TOLERANCIA_PERCENTUAL } from '../lib/reconciliacao';

/**
 * Item 6 do fechamento — tolerância da reconciliação financeira. Três
 * resultados: dentro → reconciliado; fora → divergente; campo ausente →
 * não instrumentado. Nunca "reconciliado por omissão".
 */
describe('reconciliarPnl', () => {
  it('dentro da tolerância → reconciliado', () => {
    // funding−custos = 16.37 − 7.94 = 8.43 ; capital−inicial = 608.43 − 600 = 8.43 ; dif = 0
    const r = reconciliarPnl({ fundingTotal: 16.37, custosTotal: 7.94, capital: 608.43, capitalInicial: 600 });
    expect(r.status).toBe('reconciliado');
    expect(r.reconciliado).toBe(true);
    expect(Math.abs(r.dif ?? 1)).toBeLessThanOrEqual(r.tolEfetiva ?? 0);
  });

  it('diferença de centavo dentro do piso absoluto → reconciliado', () => {
    // dif = 0.04 < tolAbs 0.05
    const r = reconciliarPnl({ fundingTotal: 10, custosTotal: 2, capital: 608.04, capitalInicial: 600 });
    // capMenosInicial=8.04, fundMenosCustos=8 → dif=0.04
    expect(r.dif).toBeCloseTo(0.04, 5);
    expect(r.tolEfetiva).toBeCloseTo(Math.max(TOLERANCIA_ABSOLUTA, TOLERANCIA_PERCENTUAL * 8.04), 5);
    expect(r.status).toBe('reconciliado');
  });

  it('fora da tolerância → divergente', () => {
    // fund−custos = 8 ; cap−inicial = 20 ; dif = 12 >> qualquer tolerância
    const r = reconciliarPnl({ fundingTotal: 10, custosTotal: 2, capital: 620, capitalInicial: 600 });
    expect(r.status).toBe('divergente');
    expect(r.reconciliado).toBe(false);
    expect(Math.abs(r.dif ?? 0)).toBeGreaterThan(r.tolEfetiva ?? 0);
  });

  it('piso percentual: PnL grande com resíduo proporcional pequeno ainda reconcilia', () => {
    // cap−inicial = 10000 ; fund−custos = 9960 ; dif = 40 ; tolPct·10000 = 50 → reconciliado
    const r = reconciliarPnl({ fundingTotal: 10000, custosTotal: 40, capital: 20000, capitalInicial: 10000 });
    // capMenosInicial=10000, fundMenosCustos=9960 → dif=40 ; tolEfetiva=max(0.05, 0.005*10000=50)=50
    expect(r.tolEfetiva).toBeCloseTo(50, 5);
    expect(r.dif).toBeCloseTo(40, 5);
    expect(r.status).toBe('reconciliado');
  });

  it('campo ausente → não instrumentado (nunca reconciliado por omissão)', () => {
    const r = reconciliarPnl({ fundingTotal: 10, custosTotal: 2, capital: 608, capitalInicial: null });
    expect(r.status).toBe('nao_instrumentado');
    expect(r.reconciliado).toBe(false);
    expect(r.campoAusente).toBe('capitalInicial');
    expect(r.dif).toBeNull();
    expect(r.tolEfetiva).toBeNull();
  });

  it('valor não-numérico/NaN → não instrumentado', () => {
    const r = reconciliarPnl({ fundingTotal: NaN, custosTotal: 2, capital: 608, capitalInicial: 600 });
    expect(r.status).toBe('nao_instrumentado');
    expect(r.campoAusente).toBe('fundingTotal');
  });
});

import { describe, it, expect } from 'vitest';
import { derivarProveniencia, NAO_INSTRUMENTADO } from '../lib/proveniencia';

/**
 * Item 4 do fechamento — proveniência estruturada dos eventos. Cobre os
 * cinco casos pedidos: eventId moderno, eventId legado, eventId inválido,
 * campos ausentes, e valores estruturados divergentes do texto do ID
 * (estruturado prevalece).
 */
describe('derivarProveniencia', () => {
  it('eventId moderno (id de produtor) + campos estruturados da API → usa os estruturados, derived:false', () => {
    const p = derivarProveniencia({
      eventId: 'challenger-teste-42', // não casa o padrão sintético
      sourceId: 'challenger-teste',
      generation: 3,
      byteOffset: 8192,
    });
    expect(p.sourceId).toEqual({ valor: 'challenger-teste', derived: false });
    expect(p.generation).toEqual({ valor: '3', derived: false });
    expect(p.byteOffset).toEqual({ valor: '8192', derived: false });
  });

  it('eventId legado sintético SEM campos estruturados → deriva do texto, derived:true, derivedFrom:eventId', () => {
    const p = derivarProveniencia({ eventId: 'champion:g0:b0' });
    expect(p.sourceId).toEqual({ valor: 'champion', derived: true, derivedFrom: 'eventId' });
    expect(p.generation).toEqual({ valor: '0', derived: true, derivedFrom: 'eventId' });
    expect(p.byteOffset).toEqual({ valor: '0', derived: true, derivedFrom: 'eventId' });
  });

  it('eventId legado com geração/offset não-triviais → deriva os três corretamente', () => {
    const p = derivarProveniencia({ eventId: 'funding-arb:g2:b13570' });
    expect(p.sourceId.valor).toBe('funding-arb');
    expect(p.generation.valor).toBe('2');
    expect(p.byteOffset.valor).toBe('13570');
    expect(p.byteOffset.derived).toBe(true);
  });

  it('eventId inválido (não casa o padrão) e sem estruturados → não instrumentado, nunca inventa', () => {
    const p = derivarProveniencia({ eventId: 'lixo-sem-padrao-::::' });
    expect(p.sourceId).toEqual({ valor: NAO_INSTRUMENTADO, derived: false });
    expect(p.generation.valor).toBe(NAO_INSTRUMENTADO);
    expect(p.byteOffset.valor).toBe(NAO_INSTRUMENTADO);
  });

  it('campos ausentes (nem eventId sintético, nem estruturados) → não instrumentado', () => {
    const p = derivarProveniencia({ eventId: null });
    expect(p.sourceId.valor).toBe(NAO_INSTRUMENTADO);
    expect(p.generation.valor).toBe(NAO_INSTRUMENTADO);
    expect(p.byteOffset.valor).toBe(NAO_INSTRUMENTADO);
  });

  it('estruturado DIVERGE do texto do eventId → o estruturado prevalece (a verdade do servidor vence o parsing)', () => {
    const p = derivarProveniencia({
      eventId: 'champion:g0:b0', // texto diria champion/0/0
      sourceId: 'outra-fonte',   // mas o servidor afirma outra coisa
      generation: 5,
      byteOffset: 99,
    });
    expect(p.sourceId).toEqual({ valor: 'outra-fonte', derived: false });
    expect(p.generation).toEqual({ valor: '5', derived: false });
    expect(p.byteOffset).toEqual({ valor: '99', derived: false });
  });

  it('parcial: byteOffset estruturado=0 é válido (não confundir 0 com ausente)', () => {
    const p = derivarProveniencia({ eventId: 'x:g1:b500', byteOffset: 0 });
    // 0 é um byteOffset legítimo — deve prevalecer sobre o 500 do texto
    expect(p.byteOffset).toEqual({ valor: '0', derived: false });
    // os outros dois caem pro texto
    expect(p.sourceId.derived).toBe(true);
    expect(p.generation.valor).toBe('1');
  });
});

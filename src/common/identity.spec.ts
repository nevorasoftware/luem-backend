import { isValidDui, normalizeDui, maskDui, normalizeEmail } from './identity';

describe('Identity & DUI Utilities (El Salvador)', () => {
  it('debe validar DUIs con dígito verificador correcto', () => {
    // Ejemplo de algoritmo DUI salvadoreño:
    // 02345678: sum = 0*9 + 2*8 + 3*7 + 4*6 + 5*5 + 6*4 + 7*3 + 8*2 = 0+16+21+24+25+24+21+16 = 147 -> 147%10=7 -> 10-7=3 -> DV = 3
    const dui = '02345678-3';
    expect(isValidDui(dui)).toBe(true);
  });

  it('debe rechazar DUIs con dígito verificador incorrecto', () => {
    expect(isValidDui('02345678-9')).toBe(false);
    expect(isValidDui('00000000-0')).toBe(false);
  });

  it('debe normalizar cadenas con o sin guion a formato ########-#', () => {
    expect(normalizeDui('023456783')).toBe('02345678-3');
    expect(normalizeDui(' 02345678-3 ')).toBe('02345678-3');
    expect(normalizeDui('abc')).toBeNull();
  });

  it('debe enmascarar DUI correctamente para privacidad', () => {
    expect(maskDui('02345678-3')).toBe('02••••78-3');
  });

  it('debe normalizar correos electrónicos', () => {
    expect(normalizeEmail('  Cliente@Example.COM ')).toBe('cliente@example.com');
  });
});

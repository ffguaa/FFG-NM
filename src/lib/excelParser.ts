import * as XLSX from 'xlsx';
import { ShiftType, FfgSku, DetalheSobrepesoItem } from '../types';

export interface AbateTpaParsedData {
  massaViva: {
    '1T': number;
    '2T': number;
    'Indústria': number;
  };
  tpaTotal: {
    '1T': number;
    '2T': number;
    'Indústria': number;
  };
  tpaPendentes: {
    '1T': number;
    '2T': number;
    'Indústria': number;
  };
  sheetName: string;
  sourceRowMassaViva: number;
  sourceRowTpaTotal: number;
  sourceRowPendencias: number;
}

/**
 * Sanitizes numeric values coming from Excel cells (handles string commas, dots, currency, nulls).
 */
export function parseExcelNumber(val: any): number {
  if (val === undefined || val === null || val === '') return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  if (typeof val === 'string') {
    // Remove whitespace, currency symbols, and handle brazilian comma format
    const cleaned = val.replace(/\s+/g, '').replace(/[R$\s]/g, '');
    if (cleaned.includes(',') && cleaned.includes('.')) {
      // e.g. 1.234,56 -> 1234.56
      const normalized = cleaned.replace(/\./g, '').replace(',', '.');
      const num = parseFloat(normalized);
      return isNaN(num) ? 0 : num;
    } else if (cleaned.includes(',')) {
      const num = parseFloat(cleaned.replace(',', '.'));
      return isNaN(num) ? 0 : num;
    }
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
  }
  return 0;
}

/**
 * Parses Planilha 1: Abate / TPA
 * Expected rules:
 * - Line 164 (PESO VIVO RECEBIDO): Col C (1T), Col D (2T), Col E (Indústria)
 * - Line 160 (TOTAL GERAL TPA): Col C (1T), Col D (2T), Col E (Indústria)
 * - Line 159 (PENDENCIAS): Col G
 */
export async function parseAbateTpaExcel(file: File): Promise<AbateTpaParsedData> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  
  if (!workbook.SheetNames.length) {
    throw new Error('A planilha selecionada está vazia ou corrompida.');
  }

  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  // Convert to 2D array: row 0 corresponds to Excel row 1
  const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

  // Excel rows are 1-indexed, array is 0-indexed:
  // Row 164 -> index 163
  // Row 160 -> index 159
  // Row 159 -> index 158

  let rowIdxMassaViva = 163; // Line 164
  let rowIdxTpaTotal = 159;  // Line 160
  let rowIdxPendencias = 158;// Line 159

  // Intelligent fallback: if row 164 doesn't exist or is empty, scan for "PESO VIVO" or "RECEBIDO"
  if (rows.length < 164) {
    // Search for rows containing matching keywords
    for (let i = 0; i < rows.length; i++) {
      const rowStr = (rows[i] || []).map((c: any) => String(c || '').toUpperCase()).join(' ');
      if (rowStr.includes('PESO VIVO') || rowStr.includes('RECEBIDO')) {
        rowIdxMassaViva = i;
      }
      if (rowStr.includes('TOTAL GERAL') && (rowStr.includes('TPA') || i < 170)) {
        rowIdxTpaTotal = i;
      }
      if (rowStr.includes('PENDENCIA') || rowStr.includes('PENDÊNCIAS')) {
        rowIdxPendencias = i;
      }
    }
  }

  const getCell = (rIdx: number, colLetter: string, colIdx: number): number => {
    // Try cell address first (e.g. C164)
    const cellAddress = `${colLetter}${rIdx + 1}`;
    if (sheet && sheet[cellAddress] !== undefined && sheet[cellAddress].v !== undefined) {
      return parseExcelNumber(sheet[cellAddress].v);
    }
    // Fallback to 2D array row[colIdx]
    if (rows[rIdx] && rows[rIdx][colIdx] !== undefined) {
      return parseExcelNumber(rows[rIdx][colIdx]);
    }
    return 0;
  };

  // Col C = index 2, Col D = index 3, Col E = index 4, Col G = index 6
  const data: AbateTpaParsedData = {
    massaViva: {
      '1T': getCell(rowIdxMassaViva, 'C', 2),
      '2T': getCell(rowIdxMassaViva, 'D', 3),
      'Indústria': getCell(rowIdxMassaViva, 'E', 4),
    },
    tpaTotal: {
      '1T': getCell(rowIdxTpaTotal, 'C', 2),
      '2T': getCell(rowIdxTpaTotal, 'D', 3),
      'Indústria': getCell(rowIdxTpaTotal, 'E', 4),
    },
    tpaPendentes: {
      '1T': getCell(rowIdxPendencias, 'G', 6),
      '2T': getCell(rowIdxPendencias, 'G', 6),
      'Indústria': getCell(rowIdxPendencias, 'G', 6),
    },
    sheetName,
    sourceRowMassaViva: rowIdxMassaViva + 1,
    sourceRowTpaTotal: rowIdxTpaTotal + 1,
    sourceRowPendencias: rowIdxPendencias + 1,
  };

  return data;
}

export interface ProducaoItemRaw {
  rawCode: string;
  weight1T: number;
  weight2T: number;
  weightIndustria: number;
  rawDescription?: string;
}

/**
 * Parses Planilha 2: Produção para Cálculo de Sobrepeso
 * Scans rows for product codes, compares with known SKUs, extracts produced weight.
 */
export async function parseProducaoSobrepesoExcel(
  file: File,
  shift: ShiftType,
  skusList: FfgSku[]
): Promise<{
  detalhes: DetalheSobrepesoItem[];
  totalSobrepesoKg: number;
  totalProduzidoKg: number;
  unmatchedCount: number;
}> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });

  if (!workbook.SheetNames.length) {
    throw new Error('A planilha selecionada está vazia.');
  }

  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rawRows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

  // Map to speed up SKU lookup: normalized sku_mbrf and sku_uniao
  const skuLookup = new Map<string, FfgSku>();
  skusList.forEach((sku) => {
    if (sku.sku_mbrf) {
      skuLookup.set(String(sku.sku_mbrf).trim().toUpperCase(), sku);
    }
    if (sku.sku_uniao) {
      skuLookup.set(String(sku.sku_uniao).trim().toUpperCase(), sku);
    }
  });

  const detalhes: DetalheSobrepesoItem[] = [];
  let unmatchedCount = 0;

  // Let's determine column index for the selected shift:
  // Col C (index 2) se 1T, Col D (index 3) se 2T, Col E (index 4) ou Peso Líquido se Indústria
  // Let's inspect header row to see if there are explicit names
  let colCodeIdx = 0;
  let colDescIdx = 1;
  let colWeightIdx = shift === '1T' ? 2 : shift === '2T' ? 3 : 4;

  // Check first 15 rows for header hints
  for (let r = 0; r < Math.min(15, rawRows.length); r++) {
    const row = rawRows[r] || [];
    row.forEach((cell, cIdx) => {
      const txt = String(cell || '').trim().toUpperCase();
      if (txt === 'SKU' || txt === 'CODIGO' || txt === 'CÓDIGO' || txt.includes('COD. PROD')) {
        colCodeIdx = cIdx;
      }
      if (txt.includes('PRODUTO') || txt.includes('DESCRI') || txt.includes('MATERIAL')) {
        colDescIdx = cIdx;
      }
      if (shift === 'Indústria' && (txt.includes('LIQUIDO') || txt.includes('LÍQUIDO') || txt.includes('TOTAL'))) {
        colWeightIdx = cIdx;
      }
    });
  }

  for (let i = 0; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (!row || row.length === 0) continue;

    const rawCode = String(row[colCodeIdx] ?? '').trim().replace(/^0+/, ''); // strip leading zeroes if any
    const rawCodeOriginal = String(row[colCodeIdx] ?? '').trim();
    if (!rawCodeOriginal || rawCodeOriginal.length < 2) continue;

    // Skip common header words
    const upperCode = rawCodeOriginal.toUpperCase();
    if (['CÓDIGO', 'CODIGO', 'SKU', 'PRODUTO', 'TOTAL', 'SUBTOTAL', 'DATA', 'TURNO'].includes(upperCode)) {
      continue;
    }

    // Weight value for current shift
    let peso = 0;
    if (shift === '1T') {
      peso = parseExcelNumber(row[2]); // Col C
    } else if (shift === '2T') {
      peso = parseExcelNumber(row[3]); // Col D
    } else {
      // Indústria: Col E (index 4) or colWeightIdx
      peso = parseExcelNumber(row[colWeightIdx] ?? row[4]);
    }

    if (peso <= 0) continue;

    // Search in SKU database
    const matched =
      skuLookup.get(upperCode) ||
      skuLookup.get(rawCode.toUpperCase()) ||
      skuLookup.get(rawCodeOriginal.toUpperCase()) ||
      skusList.find(
        (s) =>
          (s.sku_mbrf && s.sku_mbrf.trim().toUpperCase() === upperCode) ||
          (s.sku_uniao && s.sku_uniao.trim().toUpperCase() === upperCode)
      );

    const desc = row[colDescIdx] ? String(row[colDescIdx]).trim() : '';

    if (matched) {
      // Handle percentual: if entered as e.g. 3.5%, convert to 0.035
      const rawPct = Number(matched.percentual_sobrepeso) || 0;
      const pctNormalized = rawPct > 1 ? rawPct / 100 : rawPct;
      const sobrepesoKg = peso * pctNormalized;

      detalhes.push({
        sku: matched.sku_uniao || matched.sku_mbrf || upperCode,
        codigo_encontrado: upperCode,
        produto: matched.produto || desc || 'Produto Cadastrado',
        familia: matched.familia || 'Avícola',
        peso_produzido: Math.round(peso * 100) / 100,
        percentual: rawPct,
        sobrepeso_kg: Math.round(sobrepesoKg * 100) / 100,
      });
    } else {
      unmatchedCount++;
      // Still show in details table so operator sees it, but with 0% overweight until configured
      detalhes.push({
        sku: upperCode,
        codigo_encontrado: upperCode,
        produto: desc || `Item sem cadastro (${upperCode})`,
        familia: 'Não cadastrado',
        peso_produzido: Math.round(peso * 100) / 100,
        percentual: 0,
        sobrepeso_kg: 0,
      });
    }
  }

  const totalSobrepesoKg = detalhes.reduce((acc, curr) => acc + curr.sobrepeso_kg, 0);
  const totalProduzidoKg = detalhes.reduce((acc, curr) => acc + curr.peso_produzido, 0);

  return {
    detalhes,
    totalSobrepesoKg: Math.round(totalSobrepesoKg * 100) / 100,
    totalProduzidoKg: Math.round(totalProduzidoKg * 100) / 100,
    unmatchedCount,
  };
}

import * as XLSX from 'xlsx';
import { ShiftType, FfgSku, DetalheSobrepesoItem, FfgInventoryBag, ParsedQualityRow } from '../types';

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

function normalizeExcelDate(val: any): string {
  if (val === undefined || val === null || val === '') {
    return new Date().toISOString().split('T')[0];
  }
  if (val instanceof Date && !isNaN(val.getTime())) {
    return val.toISOString().split('T')[0];
  }
  if (typeof val === 'number' && val > 20000) {
    const parsed = XLSX.SSF.parse_date_code(val);
    if (parsed && parsed.y && parsed.m && parsed.d) {
      return `${String(parsed.y).padStart(4, '0')}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
    }
  }
  const str = String(val).trim();
  const brMatch = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (brMatch) {
    const day = brMatch[1].padStart(2, '0');
    const month = brMatch[2].padStart(2, '0');
    let year = brMatch[3];
    if (year.length === 2) year = `20${year}`;
    return `${year}-${month}-${day}`;
  }
  const isoMatch = str.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2].padStart(2, '0')}-${isoMatch[3].padStart(2, '0')}`;
  }
  return new Date().toISOString().split('T')[0];
}

function normalizeExcelTime(val: any): string {
  if (val === undefined || val === null || val === '') return '00:00';
  if (val instanceof Date && !isNaN(val.getTime())) {
    return `${String(val.getHours()).padStart(2, '0')}:${String(val.getMinutes()).padStart(2, '0')}`;
  }
  if (typeof val === 'number' && val >= 0 && val < 1) {
    const totalMinutes = Math.round(val * 24 * 60);
    const h = Math.floor(totalMinutes / 60) % 24;
    const m = totalMinutes % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  const str = String(val).trim();
  const timeMatch = str.match(/(\d{1,2}):(\d{2})/);
  if (timeMatch) {
    return `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}`;
  }
  return '00:00';
}

function normalizeBarcodeString(val: any): string {
  if (val === undefined || val === null) return '';
  if (typeof val === 'number') {
    return Math.round(val).toString();
  }
  return String(val).trim().replace(/\s+/g, '');
}

/**
 * Parses the 9-column Inventory Bag Report (.xlsx / .xls / .csv):
 * Código | Descrição | Código (Bag) | Data Produção | Data Apontamento | Hora Apont. | Período | Peso | Código de Barra
 */
export async function parseInventoryBagsExcel(
  file: File
): Promise<Omit<FfgInventoryBag, 'id' | 'inventory_id'>[]> {
  const buffer = await file.arrayBuffer();
  const isCsv = file.name.toLowerCase().endsWith('.csv');

  let workbook: XLSX.WorkBook;
  if (isCsv) {
    const text = new TextDecoder('utf-8').decode(buffer);
    workbook = XLSX.read(text, { type: 'string', FS: text.includes(';') ? ';' : ',' });
  } else {
    workbook = XLSX.read(buffer, { type: 'array' });
  }

  if (!workbook.SheetNames.length) {
    throw new Error('A planilha selecionada está vazia.');
  }

  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });

  if (!rows.length) {
    throw new Error('Nenhum dado encontrado na planilha.');
  }

  // Locate header row and exact column indices
  let headerRowIdx = -1;
  let colProductCode = 0;
  let colDescription = 1;
  let colBagCode = 2;
  let colProdDate = 3;
  let colPostingDate = 4;
  let colPostingTime = 5;
  let colPeriod = 6;
  let colWeight = 7;
  let colBarcode = 8;

  for (let r = 0; r < Math.min(20, rows.length); r++) {
    const row = rows[r] || [];
    const normalizedCells = row.map((c) =>
      String(c ?? '')
        .trim()
        .toUpperCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
    );

    const hasDesc = normalizedCells.some((t) => t.includes('DESCR'));
    const hasPeso = normalizedCells.some((t) => t.includes('PESO'));
    const hasBarra = normalizedCells.some((t) => t.includes('BARRA'));

    if ((hasDesc && hasPeso) || (hasPeso && hasBarra)) {
      headerRowIdx = r;
      const codeIndices: number[] = [];

      normalizedCells.forEach((t, idx) => {
        if (t === 'CODIGO' || t.startsWith('COD.') || t === 'COD') {
          codeIndices.push(idx);
        } else if (t.includes('DESCR')) {
          colDescription = idx;
        } else if (t.includes('BAG') || t.includes('COD. BAG') || t.includes('CODIGO BAG')) {
          colBagCode = idx;
        } else if (t.includes('PRODUCAO')) {
          colProdDate = idx;
        } else if (t.includes('APONTAMENTO') || t.includes('DATA APONT')) {
          colPostingDate = idx;
        } else if (t.includes('HORA')) {
          colPostingTime = idx;
        } else if (t.includes('PERIODO')) {
          colPeriod = idx;
        } else if (t.includes('PESO')) {
          colWeight = idx;
        } else if (t.includes('BARRA')) {
          colBarcode = idx;
        }
      });

      if (codeIndices.length >= 2) {
        colProductCode = codeIndices[0];
        colBagCode = codeIndices[1];
      } else if (codeIndices.length === 1) {
        colProductCode = codeIndices[0];
      }
      break;
    }
  }

  const startRow = headerRowIdx >= 0 ? headerRowIdx + 1 : 0;
  const bags: Omit<FfgInventoryBag, 'id' | 'inventory_id'>[] = [];

  for (let i = startRow; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every((c) => c === null || String(c).trim() === '')) continue;

    const rawProdCode = String(row[colProductCode] ?? '').trim();
    const rawDesc = String(row[colDescription] ?? '').trim();
    const rawBagCode = String(row[colBagCode] ?? '').trim();
    const rawBarcode = normalizeBarcodeString(row[colBarcode]);
    const weight = parseExcelNumber(row[colWeight]);

    const upperDesc = rawDesc.toUpperCase();
    const upperCode = rawProdCode.toUpperCase();
    if (
      upperCode === 'TOTAL' ||
      upperDesc === 'TOTAL' ||
      upperDesc.startsWith('TOTAL ') ||
      upperCode === 'CODIGO' ||
      upperCode === 'CÓDIGO'
    ) {
      continue;
    }

    if (!rawBarcode && !rawBagCode && weight <= 0) continue;

    bags.push({
      product_code: rawProdCode,
      product_description: rawDesc,
      bag_code: rawBagCode,
      production_date: normalizeExcelDate(row[colProdDate]),
      posting_date: normalizeExcelDate(row[colPostingDate]),
      posting_time: normalizeExcelTime(row[colPostingTime]),
      period: String(row[colPeriod] ?? '').trim().toUpperCase() || 'A',
      weight_kg: Math.round(weight * 100) / 100,
      barcode: rawBarcode,
    });
  }

  if (bags.length === 0) {
    throw new Error('Nenhum bag válido encontrado na planilha. Verifique as 9 colunas do relatório padrão.');
  }

  return bags;
}

function parseOptionalExcelNumber(val: any): number | null {
  if (val === undefined || val === null) return null;
  if (typeof val === 'number') {
    return Number.isFinite(val) ? Math.round(val * 10000) / 10000 : null;
  }
  const str = String(val).trim();
  if (
    !str ||
    str === '-' ||
    str === '—' ||
    str.toLowerCase() === 'null' ||
    str.toLowerCase() === 'n/a'
  ) {
    return null;
  }
  const cleaned = str.replace(/%/g, '').replace(/\s+/g, '');
  if (!cleaned) return null;

  let normalized = cleaned;
  if (cleaned.includes(',') && cleaned.includes('.')) {
    normalized = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (cleaned.includes(',')) {
    normalized = cleaned.replace(',', '.');
  }
  const num = parseFloat(normalized);
  return Number.isFinite(num) ? Math.round(num * 10000) / 10000 : null;
}

/**
 * Parses the Consolidated Quality Report (.xlsx / .xls / .csv):
 * DATA DE PRODUÇÃO | HORARIO | PERÍODO | N° CODIGO DE BARRAS | ACIDEZ | IND. PEROXIDO |
 * UMIDADE | EXTRATO ETÉREO | PROTEÍNA BRUTA | MATERIA MINERAL | DIGESTIBILIDADE | CLASSIFICAÇÃO
 */
export async function parseQualityReportExcel(file: File): Promise<ParsedQualityRow[]> {
  const buffer = await file.arrayBuffer();
  const isCsv = file.name.toLowerCase().endsWith('.csv');

  let workbook: XLSX.WorkBook;
  if (isCsv) {
    const text = new TextDecoder('utf-8').decode(buffer);
    workbook = XLSX.read(text, { type: 'string', FS: text.includes(';') ? ';' : ',' });
  } else {
    workbook = XLSX.read(buffer, { type: 'array' });
  }

  if (!workbook.SheetNames.length) {
    throw new Error('A planilha de Qualidade selecionada está vazia.');
  }

  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });

  if (!rows.length) {
    throw new Error('Nenhum dado encontrado na planilha de Qualidade.');
  }

  const normalizeHeader = (cell: any): string =>
    String(cell ?? '')
      .trim()
      .toUpperCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[°º]/g, '')
      .replace(/\s+/g, ' ');

  let headerRowIdx = -1;
  let colProdDate = -1;
  let colTime = -1;
  let colPeriod = -1;
  let colBarcode = -1;
  let colAcidity = -1;
  let colPeroxide = -1;
  let colMoisture = -1;
  let colEtherExtract = -1;
  let colCrudeProtein = -1;
  let colMineralMatter = -1;
  let colDigestibility = -1;
  let colClassification = -1;

  for (let r = 0; r < Math.min(25, rows.length); r++) {
    const row = rows[r] || [];
    const normalizedCells = row.map(normalizeHeader);

    const hasBarcode = normalizedCells.some((h) => h.includes('BARRA'));
    const hasQualityMetric = normalizedCells.some(
      (h) =>
        h.includes('ACIDEZ') ||
        h.includes('PEROXIDO') ||
        h.includes('UMIDADE') ||
        h.includes('PROTEINA') ||
        h.includes('DIGEST') ||
        h.includes('CLASSIFIC')
    );

    if (hasBarcode && hasQualityMetric) {
      headerRowIdx = r;
      normalizedCells.forEach((h, idx) => {
        if (h.includes('BARRA')) {
          colBarcode = idx;
        } else if (h.includes('DATA') && h.includes('PROD')) {
          colProdDate = idx;
        } else if (h.includes('HORA')) {
          colTime = idx;
        } else if (h.includes('PERIODO')) {
          colPeriod = idx;
        } else if (h.includes('ACIDEZ')) {
          colAcidity = idx;
        } else if (h.includes('PEROXIDO')) {
          colPeroxide = idx;
        } else if (h.includes('UMIDADE')) {
          colMoisture = idx;
        } else if (h.includes('EXTRATO') || h.includes('ETEREO')) {
          colEtherExtract = idx;
        } else if (h.includes('PROTEINA')) {
          colCrudeProtein = idx;
        } else if (h.includes('MINERAL')) {
          colMineralMatter = idx;
        } else if (h.includes('DIGEST')) {
          colDigestibility = idx;
        } else if (h.includes('CLASSIFIC')) {
          colClassification = idx;
        }
      });
      break;
    }
  }

  if (headerRowIdx === -1 || colBarcode === -1) {
    throw new Error(
      'Cabeçalho da planilha de Qualidade não reconhecido. Certifique-se de que a coluna "N° CODIGO DE BARRAS" e os indicadores laboratoriais estejam presentes.'
    );
  }

  const parsedRows: ParsedQualityRow[] = [];

  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every((c) => c === null || String(c).trim() === '')) continue;

    const rawBarcode = normalizeBarcodeString(row[colBarcode]);
    if (!rawBarcode) continue;

    const upperBarcode = rawBarcode.toUpperCase();
    if (
      upperBarcode === 'TOTAL' ||
      upperBarcode.includes('CODIGO') ||
      upperBarcode.includes('BARRA')
    ) {
      continue;
    }

    const rawClass =
      colClassification >= 0 && row[colClassification] !== null && row[colClassification] !== undefined
        ? String(row[colClassification]).trim()
        : '';
    const classification =
      !rawClass || rawClass === '-' || rawClass === '—'
        ? null
        : rawClass.toUpperCase();

    parsedRows.push({
      production_date: colProdDate >= 0 && row[colProdDate] !== null ? normalizeExcelDate(row[colProdDate]) : null,
      time: colTime >= 0 && row[colTime] !== null ? normalizeExcelTime(row[colTime]) : null,
      period:
        colPeriod >= 0 && row[colPeriod] !== null && String(row[colPeriod]).trim() !== ''
          ? String(row[colPeriod]).trim().toUpperCase()
          : null,
      barcode: rawBarcode,
      acidity: colAcidity >= 0 ? parseOptionalExcelNumber(row[colAcidity]) : null,
      peroxide: colPeroxide >= 0 ? parseOptionalExcelNumber(row[colPeroxide]) : null,
      moisture: colMoisture >= 0 ? parseOptionalExcelNumber(row[colMoisture]) : null,
      ether_extract: colEtherExtract >= 0 ? parseOptionalExcelNumber(row[colEtherExtract]) : null,
      crude_protein: colCrudeProtein >= 0 ? parseOptionalExcelNumber(row[colCrudeProtein]) : null,
      mineral_matter: colMineralMatter >= 0 ? parseOptionalExcelNumber(row[colMineralMatter]) : null,
      digestibility: colDigestibility >= 0 ? parseOptionalExcelNumber(row[colDigestibility]) : null,
      classification,
    });
  }

  if (parsedRows.length === 0) {
    throw new Error(
      'Nenhuma linha válida com "N° CODIGO DE BARRAS" foi encontrada na planilha de Qualidade.'
    );
  }

  return parsedRows;
}

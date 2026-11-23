import type { Response } from 'express';
import { toCsv } from '../infra/csvExport';

export function sendCsv(res: Response, fileName: string, header: string[], rows: Record<string, unknown>[]): void {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  // With BOM, otherwise Excel reads UTF-8 as Windows-1252.
  res.send('\uFEFF' + toCsv(header, rows));
}

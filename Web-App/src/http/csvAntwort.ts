import type { Response } from 'express';
import { toCsv } from '../infra/csvExport';

export function sendeCsv(res: Response, dateiname: string, kopf: string[], zeilen: Record<string, unknown>[]): void {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${dateiname}"`);
  // Mit BOM, sonst liest Excel UTF-8 als Windows-1252.
  res.send('\uFEFF' + toCsv(kopf, zeilen));
}

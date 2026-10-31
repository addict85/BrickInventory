/**
 * /api/v1 — Kompositions-Router.
 * Ausführlich: docs/begruendungen/routes/api_v1/index.ts.md#abschnitt
 */
import express from 'express';
import setsRouter from './sets';
import pdfRouter from './pdf';
import acquisitionsRouter from './acquisitions';
import partsRouter from './parts';
import minifigsRouter from './minifigs';
import financeRouter from './finance';
import settingsRouter from './settings';
import adminRouter from './admin';
import miscRouter from './misc';
import catalogRouter from './catalog';
import wantedRouter from './wanted';
import vouchersRouter from './vouchers';
import papierkorbRouter from './papierkorb';

const router = express.Router();

router.use(pdfRouter);          // /sets/partslist-pdf/* (literale Pfade)
router.use(setsRouter);         // /sets, /sets/barcode, /sets/:setNumber/*
router.use(acquisitionsRouter); // Kaufpreis-Erfassungen für Sets/Teile/Figuren
router.use(partsRouter);
router.use(minifigsRouter);
router.use(financeRouter);
router.use(settingsRouter);     // /settings — Einstellungen, Zugänge, Haushalt
router.use(adminRouter);
router.use(catalogRouter);      // /catalog/* — Rebrickable-Katalog (Browsen/Suchen)
router.use(wantedRouter);     // /wanted — Merkliste (eigene Tabelle, siehe 0021)
router.use(vouchersRouter);     // /vouchers — Gutscheine (eigene Tabelle, siehe 0026)
router.use(papierkorbRouter);   // /papierkorb — gelöschte Elemente (siehe 0041)
router.use(miscRouter);         // /stats + Endpoint-Übersicht unter /

export = router;

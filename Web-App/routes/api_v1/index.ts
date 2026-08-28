/**
 * /api/v1 — Kompositions-Router.
 *
 * Der frühere Monolith routes/api_v1.ts (~1.800 Zeilen) ist in Fach-Module
 * aufgeteilt; jedes Modul bringt seine eigenen Routen mit und nutzt die
 * gemeinsame Middleware aus ./middleware.ts. Die Mount-Reihenfolge ist
 * unkritisch (keine überlappenden Pfad-Muster zwischen den Modulen).
 */
import express from 'express';
import authRouter from './auth';
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

const router = express.Router();

router.use(authRouter);
router.use(pdfRouter);          // /sets/partslist-pdf/* (literale Pfade)
router.use(setsRouter);         // /sets, /sets/barcode, /sets/:setNumber/*
router.use(acquisitionsRouter); // Kaufpreis-Erfassungen für Sets/Teile/Figuren
router.use(partsRouter);
router.use(minifigsRouter);
router.use(financeRouter);
router.use(settingsRouter);
router.use(adminRouter);
router.use(catalogRouter);      // /catalog/* — Rebrickable-Katalog (Browsen/Suchen)
router.use(miscRouter);         // /stats + Endpoint-Übersicht unter /

export = router;

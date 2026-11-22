/**
 * 320 px at normal font, English (classic and noppe): every view without
 * overflow, cutting off, overlap and too small tap targets (@einzeln: Chrome).
 *
 * Counter-check (measured 03.11.2026): `.location-icon { min-width: 44px }` removed in
 * mobile.css → red: „Sicht lagerorte“ (tap target 42 × 44).
 */
require('./helpers/ui-check').checkLargeFont('schmal');

package ch.brickinventoryapp

import org.junit.Test

/**
 * Zustand gehört in eine Instanz, nicht auf Dateiebene.
 *
 * ── Der Befund ─────────────────────────────────────────────────────────────
 * Die Feature-Dateien sind Erweiterungsfunktionen auf MainViewModel, und eine
 * Erweiterung hat keine Felder. Was sie trotzdem merken mussten — welcher
 * Lade-Job abzubrechen ist, welche Filter-Generation gerade gilt — stand
 * deshalb als `private var` auf DATEIEBENE:
 *
 *     private var catalogSearchJob, catalogListJob, catalogDetailJob
 *     private var catalogGeneration
 *     private var gallerySearchJob, galleryListJob, galleryGeneration
 *
 * Das ist prozessweiter veränderlicher Zustand. Der Kommentar in
 * CatalogFeature.kt sagte es sogar selbst: „Job-Referenz prozessweit am VM".
 * Es geht nur gut, solange es genau eine Instanz je Prozess gibt. Zwei würden
 * sich Abbruch-Jobs und Generation teilen — die eine Ladung bräche die andere
 * ab, und niemand käme auf die Idee, dort zu suchen.
 *
 * Beim Katalog ist es behoben: Die Funktionen stehen in CatalogViewModel und
 * halten ihre Jobs als Felder.
 *
 * ── Die Galerie ist die benannte Ausnahme ──────────────────────────────────
 * GalleryFeature.kt hat dieselben drei und ist noch nicht umgestellt. Sie
 * steht hier ausdrücklich drin, statt die Prüfung zu verwässern: Solange der
 * Eintrag da ist, ist der Rest gesichert — und der Eintrag zeigt, was noch
 * offen ist. Fällt er weg, greift die Regel automatisch auch dort.
 *
 * Gegenprobe (durchgeführt): `private var catalogGeneration = 0` wieder auf
 * Dateiebene gelegt → die Prüfung meldet Datei und Zeile. Ohne die Rückgabe
 * meldet sie nichts.
 */
class KeinDateiweiterZustandTest {

    /** Noch nicht umgestellt — siehe KDoc. Kein Freibrief, ein Merkposten. */
    private val nochOffen = setOf("GalleryFeature.kt")

    @Test
    fun `keine Feature-Datei haelt veraenderlichen Zustand auf Dateiebene`() {
        val dateien = Quellen.unter("ui")
        val funde = mutableListOf<String>()
        for (f in dateien) {
            if (f.name in nochOffen) continue
            Quellen.ohneKommentare(f.readText()).lines().forEachIndexed { i, z ->
                // Spalte 0 UND kein `remember`. Der Einzug allein reicht in
                // diesem Baum nicht: BarcodeResultDialog.kt wurde aus
                // AppNavigation.kt herausgeloest, ohne den Rumpf neu
                // einzuruecken — dort stehen `var x by remember { … }` in
                // Spalte 0 und sind trotzdem im Composable. `remember` GIBT es
                // nur dort; es ist damit das verlaessliche Unterscheidungs-
                // merkmal, nicht die Spalte.
                if (Regex("""^(?:private |internal |public )?var \w+""").containsMatchIn(z) &&
                    !z.contains("remember")
                )
                    funde += "${f.name}:${i + 1}  ${z.trim()}"
            }
        }
        assert(funde.isEmpty()) {
            "Veraenderlicher Zustand auf Dateiebene ist prozessweit — er ueberlebt " +
                "jede Instanz und wird zwischen allen geteilt:\n  " + funde.joinToString("\n  ")
        }
    }

    @Test
    fun `die Ausnahmenliste enthaelt nichts Totes`() {
        // Dieselbe Regel wie in StateDomainBoundaryTest: Eine Ausnahme, die
        // niemand mehr braucht, ist eine Erlaubnis, die niemand mehr prueft.
        val tot = nochOffen.filter { name ->
            val f = Quellen.alle().firstOrNull { it.name == name } ?: return@filter true
            Quellen.ohneKommentare(f.readText()).lines().none {
                Regex("""^(?:private |internal |public )?var \w+""").containsMatchIn(it) &&
                    !it.contains("remember")
            }
        }
        assert(tot.isEmpty()) {
            "Diese Dateien stehen als offen in der Liste, halten aber keinen " +
                "dateiweiten Zustand mehr — Eintrag loeschen, dann gilt die Regel " +
                "auch fuer sie: ${tot.joinToString()}"
        }
    }
}

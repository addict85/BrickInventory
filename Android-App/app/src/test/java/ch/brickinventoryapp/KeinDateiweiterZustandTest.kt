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
 * ── Und die Galerie? ───────────────────────────────────────────────────────
 * Sie hatte dieselben drei. Ein eigenes GalleryViewModel wäre hier aber die
 * falsche Antwort gewesen: GalleryFeature schreibt siebzehnmal in AppUiState,
 * und `sets` wird in SECHZEHN Dateien gelesen — Barcode, SetDetail, Katalog,
 * Teileliste. Das ist App-Zustand, kein Bildschirmzustand; herausgezogen wäre
 * es dasselbe Gott-Objekt unter neuem Namen, mit Verkabelung in sechzehn
 * Dateien obendrauf.
 *
 * Die drei Variablen sind deshalb FELDER des MainViewModel geworden — genau
 * dort, wo `partsJob` seit jeher steht. Das Projekt kannte die richtige
 * Antwort also schon; die Galerie folgte nur ihrem eigenen Muster nicht.
 *
 * Damit steht keine Ausnahme mehr in der Liste, und die Regel gilt für ui/
 * vollständig.
 *
 * Gegenprobe (durchgeführt): `private var catalogGeneration = 0` wieder auf
 * Dateiebene gelegt → die Prüfung meldet Datei und Zeile. Ohne die Rückgabe
 * meldet sie nichts.
 */
class KeinDateiweiterZustandTest {

    /**
     * Leer — und das soll so bleiben.
     *
     * Der zweite Test unten meldet jeden Eintrag, der nicht mehr gebraucht
     * wird. Ein Eintrag hier ist ein Merkposten, kein Freibrief.
     */
    private val nochOffen = emptySet<String>()

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

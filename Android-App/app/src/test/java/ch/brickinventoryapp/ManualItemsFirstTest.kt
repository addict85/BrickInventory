package ch.brickinventoryapp

import org.junit.Test

/**
 * Teile und Minifiguren beginnen bei den MANUELL ERFASSTEN Einträgen.
 *
 * ── Woher dieser Test kommt (Nachtrag 122) ──────────────────────────────────
 *
 * Marcos Befund: „Der Reiter Teile startet nicht zuoberst. Man sieht die Teile
 * aus den Sets und muss nach oben scrollen, um die manuell erfassten zu sehen."
 * Seine Vermutung — die Listen würden unabhängig geladen — war richtig, und der
 * Rest folgt daraus:
 *
 *  1. Beim Betreten laufen `loadParts()` und `loadValuation()` GLEICHZEITIG los.
 *     Die Set-Teile sind meist zuerst da.
 *  2. Das Raster zeigt sie, Position 0.
 *  3. Die manuellen Teile treffen ein und werden mit zwei Zwischenüberschriften
 *     OBEN eingefügt.
 *  4. LazyGrid hält beim Ändern der Daten den SICHTBAREN Eintrag fest, nicht
 *     den Index — es sucht den Schlüssel des ersten sichtbaren Elements in der
 *     neuen Liste wieder. Beim Nachladen UNTEN ist das genau richtig; hier
 *     landet alles neu Eingefügte über dem Sichtfenster.
 *
 * Die Anordnung im Raster war also nie falsch, und ein Test, der nur sie prüft,
 * wäre die ganze Zeit grün geblieben. Deshalb prüft dieser Test beides: die
 * Reihenfolge UND die Korrektur, die den Sprung rückgängig macht.
 */
class ManualItemsFirstTest {

    // Der zweite Wert ist der AUFRUF, mit dem die Einträge aus den Sets ins
    // Raster kommen — bei den Teilen `items(...)`, bei den Minifiguren
    // `itemsIndexed(...)`, weil dort der Schlüssel den Index braucht (dieselbe
    // Figur kann aus mehreren Sets stammen).
    //
    // Als MUSTER, nicht als Zeichenkette: Die Aufrufe stehen ueber mehrere
    // Zeilen, sobald sie mehr als zwei Argumente haben —
    //
    //     items(
    //         distinctParts,
    //         key = { … },
    //         span = { … },
    //     ) { part -> … }
    //
    // Die feste Zeichenkette "items(distinctParts" fand das nicht mehr und
    // meldete „Name geaendert?", obwohl sich nur der Zeilenumbruch geaendert
    // hatte. Geprueft werden soll die REIHENFOLGE im Raster, nicht die
    // Formatierung.
    private val bildschirme = mapOf(
        "ui/screens/PartsScreen.kt" to Pair(
            Regex("""items\s*\(\s*manualParts"""),
            Regex("""items\s*\(\s*distinctParts""")),
        "ui/screens/MinifigsScreen.kt" to Pair(
            Regex("""items\s*\(\s*manualFigs"""),
            Regex("""itemsIndexed\s*\(""")),
    )

    @Test
    fun `die manuell erfassten Eintraege stehen im Raster vor denen aus Sets`() {
        for ((rel, listen) in bildschirme) {
            val (manuell, ausSets) = listen
            val s = Quellen.ohneKommentare(Quellen.lies(rel))
            val kopf = s.indexOf("\"manual-header\"")
            val manuellItems = manuell.find(s)?.range?.first ?: -1
            val setItems = ausSets.find(s)?.range?.first ?: -1
            assert(kopf >= 0) { "$rel: Zwischenüberschrift der manuellen Einträge fehlt" }
            assert(manuellItems >= 0) { "$rel: ${manuell.pattern} fehlt — Name geändert?" }
            assert(setItems >= 0) { "$rel: ${ausSets.pattern} fehlt — Name geändert?" }
            assert(kopf < manuellItems && manuellItems < setItems) {
                "$rel: Die manuell erfassten Einträge stehen nicht mehr vor denen aus Sets"
            }
        }
    }

    @Test
    fun `beide Listen zaehlen als geladen, nicht nur die aus den Sets`() {
        // Stand für die Teile auf `partsState.parts.isNotEmpty()` — also nur auf
        // der Set-Liste. Die Position wurde damit wiederhergestellt, bevor die
        // manuellen Einträge überhaupt da waren.
        //
        // Und auf `!= null` statt `isNotEmpty()`: "die Bewertung ist zurück",
        // nicht "sie enthält etwas". Bei den Minifiguren stand hier
        // `figsValuation?.figs?.isNotEmpty() == true` — wer keine manuell
        // erfassten Minifiguren hat, bekam damit NIE eine Position
        // wiederhergestellt.
        val graph = Quellen.ohneKommentare(Quellen.lies("nav/CollectionGraph.kt"))
        for ((schluessel, bewertung) in listOf(
            "\"parts\"" to "partsValuation",
            "\"minifigs\"" to "figsValuation",
        )) {
            val block = Quellen.fenster(graph, "ScrollPositionKeeper(\n                    $schluessel", 12)
            assert(block.isNotEmpty()) { "Kein ScrollPositionKeeper für $schluessel gefunden" }
            assert(block.contains("$bewertung != null")) {
                "$schluessel: `bereit` wartet nicht auf $bewertung — dann wird die " +
                    "Position gesetzt, bevor die manuellen Einträge da sind"
            }
            assert(block.contains("obenNachziehend =")) {
                "$schluessel: obenNachziehend fehlt — ohne das bleibt der Sprung, den " +
                    "das nachträgliche Einfügen oben auslöst"
            }
        }
    }

    @Test
    fun `die Korrektur laesst gespeicherte Position und eigene Geste in Ruhe`() {
        // Der Sprung an den Anfang darf NUR passieren, wenn niemand etwas
        // anderes wollte. Wer aus der Detailansicht zurückkommt, will an seine
        // Stelle; wer gerade wischt, erst recht.
        val s = Quellen.ohneKommentare(Quellen.lies("ui/ScrollMemory.kt"))
        val korrektur = Quellen.fenster(s, "LaunchedEffect(obenNachziehend)", 8)
        assert(korrektur.isNotEmpty()) { "Die Korrektur fehlt in ScrollMemory.kt" }
        for (wache in listOf("!hatteGespeicherte", "!nutzerGeste")) {
            assert(korrektur.contains(wache)) {
                "Die Korrektur prüft $wache nicht — dann reisst sie den Nutzer aus " +
                    "seiner Position"
            }
        }
        assert(s.contains("hatteGespeicherte = true")) {
            "hatteGespeicherte wird nie gesetzt — die Wache wäre wirkungslos"
        }
    }
}

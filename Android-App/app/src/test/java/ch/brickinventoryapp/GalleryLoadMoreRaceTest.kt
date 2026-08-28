package ch.brickinventoryapp

import org.junit.Test

/**
 * Der Endlos-Scroll der Galerie darf dieselbe Seite nicht zweimal anfordern.
 *
 * ── Marcos Befund (Nachtrag 106) ────────────────────────────────────────────
 * „Wenn ich schnell nach unten scrolle, werden zwar neue Einträge angezeigt,
 * nach einer Sekunde springt die Liste aber wieder nach oben — immer auf
 * dieselbe Zeile. Auch beim Schliessen des Detail-Dialogs."
 *
 * ── Die Kette ───────────────────────────────────────────────────────────────
 * Der Auslöser in GalleryScreen hängt an einem `snapshotFlow`, dessen
 * `LaunchedEffect` bei jeder Änderung von `sets.size` neu startet und sofort
 * wieder auswertet. Beim schnellen Wischen feuert er mehrfach im selben Frame.
 *
 * `galleryLoadingMore` wurde INNERHALB der Koroutine gesetzt — also erst beim
 * nächsten Ablaufschritt. Zwei Aufrufe im selben Frame lasen beide `false`,
 * kamen beide am Wächter vorbei und forderten beide `galleryPage + 1` an:
 * DIESELBE Seite. Die Sets landeten doppelt in der Liste.
 *
 * `items(sets, key = { it.setNumber })` bekam damit doppelte Schlüssel. Ein
 * LazyVerticalGrid löst eine Position über den Schlüssel auf und landet beim
 * ERSTEN Vorkommen — daher der Sprung, und daher immer auf dieselbe Zeile. Auch
 * die gemerkte Rollposition (ScrollMemory) zeigt dann dorthin, was den zweiten
 * Teil des Befunds erklärt.
 *
 * ── Warum am Quelltext geprüft ──────────────────────────────────────────────
 * Ein echter Ablauftest bräuchte ViewModel, Repository und Testdispatcher. Die
 * REGEL lässt sich schärfer festhalten: Die Sperre steht vor dem launch, und
 * beim Anhängen werden bekannte Schlüssel ausgesiebt.
 */
class GalleryLoadMoreRaceTest {

    private fun quelle(): String =
        java.io.File("src/main/java/ch/brickinventoryapp/ui/GalleryFeature.kt").readText()

    /** Der Rumpf von loadMoreSets(), ohne Kommentare. */
    private fun loadMoreSets(): String {
        val src = quelle().lines()
            .joinToString("\n") { val t = it.trim(); if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) "" else it }
        val start = src.indexOf("fun MainViewModel.loadMoreSets()")
        assert(start >= 0) { "loadMoreSets() nicht gefunden" }
        val ende = src.indexOf("\n}", start)
        return src.substring(start, if (ende > start) ende else src.length)
    }

    @Test
    fun `die Sperre wird vor dem launch gesetzt`() {
        val fn = loadMoreSets()
        val sperre = fn.indexOf("galleryLoadingMore = true")
        val launch = fn.indexOf("viewModelScope.launch")
        assert(sperre >= 0) { "Die Sperre wird gar nicht mehr gesetzt" }
        assert(launch >= 0) { "Kein launch mehr in loadMoreSets()" }
        assert(sperre < launch) {
            "galleryLoadingMore wird erst INNERHALB der Koroutine gesetzt. Zwei " +
                "Aufrufe im selben Frame lesen dann beide `false` und fordern " +
                "dieselbe Seite an — genau Marcos Sprung auf immer dieselbe Zeile."
        }
    }

    @Test
    fun `eine verworfene Antwort loest die Sperre wieder`() {
        // Die Sperre steht jetzt vor dem launch — also auch dann, wenn die
        // Antwort wegen eines Filterwechsels verworfen wird. Ohne Freigabe
        // bliebe der Endlos-Scroll für immer blockiert.
        val fn = loadMoreSets()
        val verworfen = fn.indexOf("gen != galleryGeneration")
        assert(verworfen >= 0) { "Die Generationsprüfung ist weg" }
        // NUR bis zum return@launch schauen: Weiter unten steht die Freigabe im
        // Fehlerzweig, die diese Prüfung sonst fälschlich bestehen liesse
        // (beim Nachspielen der Gegenprobe aufgefallen).
        val bisReturn = fn.substring(verworfen, fn.indexOf("return@launch", verworfen) + 1)
        assert(bisReturn.contains("galleryLoadingMore = false")) {
            "Nach einer verworfenen Antwort bleibt die Sperre stehen — der " +
                "Endlos-Scroll lädt dann nie wieder nach."
        }
    }

    @Test
    fun `beim Anhaengen werden bekannte Schluessel ausgesiebt`() {
        // Zweite Sicherung gegen doppelte Schlüssel: Der Server kann
        // Überschneidungen auch von sich aus liefern, wenn die Sortierung
        // gleiche Werte enthält (etwa nach Jahr) und die Reihenfolge innerhalb
        // einer Gruppe zwischen zwei Abfragen wechselt.
        val fn = loadMoreSets()
        assert(fn.contains("filterNot")) {
            "Neue Seiten werden ungeprüft angehängt. Ein doppelter setNumber " +
                "im Raster lässt LazyVerticalGrid auf das erste Vorkommen springen."
        }
        assert(!Regex("""sets = it\.sets \+ r\.data\.sets""").containsMatchIn(fn)) {
            "Die Seite wird wieder ungefiltert angehängt"
        }
    }
}

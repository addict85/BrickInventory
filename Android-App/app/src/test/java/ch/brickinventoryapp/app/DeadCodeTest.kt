package ch.brickinventoryapp.app

import org.junit.Test
import java.io.File
import ch.brickinventoryapp.testing.Quellen

/**
 * Was nicht mehr benutzt wird, fällt auf.
 */
class DeadCodeTest {

    /**
     * Ressourcen, die absichtlich ohne Aufrufer im Quelltext stehen.
     * Kurz halten: Jeder Eintrag ist eine Ausnahme, die niemand mehr prüft.
     */
    private val erlaubteRessourcen = setOf<String>(
        // (derzeit keine)
    )

    /**
     * `<!-- … -->` heraus, auch ueber mehrere Zeilen.
     *
     * Kotlins Zeilenfilter (Quellen.ohneKommentare) hilft in XML nicht: Dort
     * steht der Kommentar oft in einer Zeile mit Inhalt.
     */
    private fun ohneXmlKommentare(s: String) = s.replace(Regex("<!--[\\s\\S]*?-->"), "")

    @Test
    fun `jede Textressource wird benutzt`() {
        val en = File(Quellen.res, "values/strings.xml").readText()
        val schluessel = Regex("""<string name="([^"]+)"""").findAll(en)
            .map { it.groupValues[1] }.toSet()
        assert(schluessel.size > 300) { "Nur ${schluessel.size} Texte gefunden — Muster veraltet?" }

        // Gesucht wird im Kotlin-Code UND in den übrigen XML-Dateien (Themes,
        // Menüs, das Manifest binden Texte ebenfalls ein).
        //
        // OHNE KOMMENTARE. Ein Schluessel, der nur in einem
        // Kommentar VORKOMMT, wird nicht benutzt — er wird erwaehnt. Der
        // Unterschied ist nicht theoretisch: Beim Umstellen des Vergleich-
        // Suchfelds auf `cd_search_clear` wurde `comparison_clear` frei, und
        // der Kommentar, der genau DAS erklaert, nennt den alten Namen. Die
        // Pruefung sah ihn und meldete den Text als weiter benutzt.
        //
        // So haelt sich jeder tote Text am Leben, sobald irgendwo steht, warum
        // er tot ist — und das ist die Sorte Erklaerung, die man am ehesten
        // hinschreibt.
        val verwendung = buildString {
            Quellen.alle().forEach { append(Quellen.ohneKommentare(it.readText())).append('\n') }
            Quellen.res.walkTopDown()
                .filter { it.isFile && it.extension == "xml" && !it.name.startsWith("strings") }
                .forEach { append(ohneXmlKommentare(it.readText())).append('\n') }
            append(ohneXmlKommentare(Quellen.manifest.readText()))
        }
        assert(verwendung.length > 100_000) { "Zu wenig Quelltext gelesen — Pfad veraltet?" }

        val tot = schluessel.filter {
            it !in erlaubteRessourcen && !Regex("""\b${Regex.escape(it)}\b""").containsMatchIn(verwendung)
        }.sorted()
        assert(tot.isEmpty()) {
            "Diese Texte werden nirgends benutzt (${tot.size}):\n  " + tot.joinToString("\n  ") +
                "\nEntweder ist die Anzeige dazu nie gebaut worden — dann fehlt eine " +
                "Funktion —, oder sie ist entfernt worden und der Text blieb liegen."
        }
    }

    @Test
    fun `jede Funktion hat einen Aufrufer`() {
        val dateien = Quellen.alle().associateWith { Quellen.ohneKommentare(it.readText()) }
        val alles = dateien.values.joinToString("\n")
        // Die Hilfen aus core-testing sind für Tests da; ihre Aufrufer stehen dort, nicht im Hauptbaum.
        val ausTests = alles + "\n" + Quellen.tests.walkTopDown().filter { it.extension == "kt" }
            .joinToString("\n") { Quellen.ohneKommentare(it.readText()) }

        // Nur eigene Deklarationen: `override`, `operator` und Konstruktoren
        // bleiben aussen vor — die ruft das Rahmenwerk auf, nicht dieser Baum.
        val deklaration = Regex("""^(?:internal |private |public |)fun (\w+)\s*[(<]""", RegexOption.MULTILINE)
        val orte = mutableMapOf<String, MutableList<String>>()
        dateien.forEach { (datei, s) ->
            deklaration.findAll(s).forEach { orte.getOrPut(it.groupValues[1]) { mutableListOf() } += datei.invariantSeparatorsPath }
        }
        assert(orte.size > 80) { "Nur ${orte.size} Funktionen gefunden — Muster veraltet?" }

        // Einstiegspunkte, die niemand aus diesem Baum heraus aufruft.
        val einstiege = setOf("main", "onCreate", "onStart", "onResume", "onPause", "onDestroy")

        val tot = orte.filter { (name, wo) ->
            if (name in einstiege) return@filter false
            val text = if (wo.all { "/testing/" in it }) ausTests else alles
            // Ein Aufruf ist `name(`, eine Referenz `::name`, ein benanntes
            // Argument `name =`. Weniger Treffer als Deklarationen heisst:
            // ausser der Deklaration steht nichts da.
            //
            // ── Die vierte Form: `name { … }` ────────────────
            //
            // Kotlin darf den letzten Parameter als Block HINTER die Klammern
            // ziehen, und dann faellt die Klammer ganz weg:
            //
            //     KameraErlaubnisHinweis { cameraPermission.launchPermissionRequest() }
            //
            // Das IST ein Aufruf, nur ohne `(`. Dieser Test hat ihn nicht
            // gezaehlt und meldete die Funktion als tot — Lauf 105 fiel darueber.
            //
            // Die Luecke war schon vorher da und hat nur nie zugeschlagen:
            // GEMESSEN benutzen genau ZWEI eigene Funktionen diese Form,
            // `AppKarte` (3 Stellen) und die neue hier (2). `AppKarte` wird
            // daneben auch mit Klammern gerufen und rutschte deshalb durch.
            val aufrufe = Regex("""\b${Regex.escape(name)}\s*\(""").findAll(text).count()
            val alsBlock = Regex("""\b${Regex.escape(name)}\s*\{""").findAll(text).count()
            val referenzen = Regex("""::${Regex.escape(name)}\b""").findAll(text).count()
            val benannt = Regex("""\b${Regex.escape(name)}\s*=""").findAll(text).count()
            aufrufe <= wo.size && alsBlock == 0 && referenzen == 0 && benannt == 0
        }.map { "${it.key} (${it.value.joinToString { p -> p.substringAfterLast('/') }})" }.sorted()

        assert(tot.isEmpty()) {
            "Diese Funktionen haben keinen Aufrufer (${tot.size}):\n  " + tot.joinToString("\n  ") +
                "\nEntfernen — oder es fehlt die Stelle, die sie benutzen sollte. " +
                "Genau das war bei saveUserDefaultCondition der Fall (Nachtrag 115)."
        }
    }
}

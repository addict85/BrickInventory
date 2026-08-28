package ch.brickinventoryapp

import org.junit.Test

/**
 * Was nicht mehr benutzt wird, fällt auf.
 *
 * ── Woher dieser Test kommt (Nachtrag 119) ──────────────────────────────────
 *
 * Zweimal in Folge ist derselbe Fehlertyp ZUFÄLLIG aufgefallen, beim Umbau von
 * etwas anderem: `saveUserDefaultCondition()` ohne Aufrufer (Nachtrag 115),
 * `defaultPriceCondition` geladen und nie gelesen (Nachtrag 118). Beim dritten
 * Mal ergab die gezielte Suche 19 unbenutzte Textressourcen und 325 Zeilen
 * Composables ohne Aufrufer.
 *
 * Der Schaden ist selten der tote Code selbst — er ist, was er verdeckt. Zwei
 * der 19 Texte („— Globale Vorgabe —" und der Hinweis dazu) waren nicht übrig
 * geblieben, sondern nie angekommen: Die Einstellungskarte bot nur zwei Chips
 * und hatte keinen Weg zurück zur Vorgabe des Servers. Und in Nachtrag 115
 * habe ich zwei Texte ins Deutsche übersetzt, die niemand je zu sehen bekam.
 *
 * `shrinkResources` räumt ungenutzte Ressourcen aus dem Release-APK. Im
 * Quelltext bleiben sie — und dort stören sie.
 */
class DeadCodeTest {

    /**
     * Ressourcen, die absichtlich ohne Aufrufer im Quelltext stehen.
     * Kurz halten: Jeder Eintrag ist eine Ausnahme, die niemand mehr prüft.
     */
    private val erlaubteRessourcen = setOf<String>(
        // (derzeit keine)
    )

    @Test
    fun `jede Textressource wird benutzt`() {
        val en = java.io.File("src/main/res/values/strings.xml").readText()
        val schluessel = Regex("""<string name="([^"]+)"""").findAll(en)
            .map { it.groupValues[1] }.toSet()
        assert(schluessel.size > 300) { "Nur ${schluessel.size} Texte gefunden — Muster veraltet?" }

        // Gesucht wird im Kotlin-Code UND in den übrigen XML-Dateien (Themes,
        // Menüs, das Manifest binden Texte ebenfalls ein).
        val verwendung = buildString {
            Quellen.alle().forEach { append(it.readText()).append('\n') }
            java.io.File("src/main/res").walkTopDown()
                .filter { it.isFile && it.extension == "xml" && !it.name.startsWith("strings") }
                .forEach { append(it.readText()).append('\n') }
            append(java.io.File("src/main/AndroidManifest.xml").readText())
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

        // Nur eigene Deklarationen: `override`, `operator` und Konstruktoren
        // bleiben aussen vor — die ruft das Rahmenwerk auf, nicht dieser Baum.
        val deklaration = Regex("""^(?:internal |private |public |)fun (\w+)\s*[(<]""", RegexOption.MULTILINE)
        val orte = mutableMapOf<String, MutableList<String>>()
        dateien.forEach { (datei, s) ->
            deklaration.findAll(s).forEach { orte.getOrPut(it.groupValues[1]) { mutableListOf() } += datei.name }
        }
        assert(orte.size > 80) { "Nur ${orte.size} Funktionen gefunden — Muster veraltet?" }

        // Einstiegspunkte, die niemand aus diesem Baum heraus aufruft.
        val einstiege = setOf("main", "onCreate", "onStart", "onResume", "onPause", "onDestroy")

        val tot = orte.filter { (name, wo) ->
            if (name in einstiege) return@filter false
            // Ein Aufruf ist `name(`, eine Referenz `::name`, ein benanntes
            // Argument `name =`. Weniger Treffer als Deklarationen heisst:
            // ausser der Deklaration steht nichts da.
            val aufrufe = Regex("""\b${Regex.escape(name)}\s*\(""").findAll(alles).count()
            val referenzen = Regex("""::${Regex.escape(name)}\b""").findAll(alles).count()
            val benannt = Regex("""\b${Regex.escape(name)}\s*=""").findAll(alles).count()
            aufrufe <= wo.size && referenzen == 0 && benannt == 0
        }.map { "${it.key} (${it.value.joinToString()})" }.sorted()

        assert(tot.isEmpty()) {
            "Diese Funktionen haben keinen Aufrufer (${tot.size}):\n  " + tot.joinToString("\n  ") +
                "\nEntfernen — oder es fehlt die Stelle, die sie benutzen sollte. " +
                "Genau das war bei saveUserDefaultCondition der Fall (Nachtrag 115)."
        }
    }
}

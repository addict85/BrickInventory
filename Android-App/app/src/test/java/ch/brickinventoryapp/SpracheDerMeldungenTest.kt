package ch.brickinventoryapp

import org.junit.Test

/**
 * Meldungen erscheinen in der Sprache der APP, nicht in der des Systems.
 *
 * ── Der Fehler, den diese Regel verhindert ──────────────────────────────────
 * `AppCompatDelegate.setApplicationLocales()` lokalisiert nur
 * AppCompat-ACTIVITIES. Der Application-Context behält unterhalb von
 * Android 13 die SYSTEM-Sprache — minSdk ist 26, betroffen sind also
 * Android 8 bis 12. Das steht seit Langem in LanguageManager.localizedContext()
 * und war für die Foreground-Services auch umgesetzt.
 *
 * Die ViewModels waren die Lücke: dort standen zweiunddreissig direkte
 * `ctx.getString(...)` auf dem Application-Context. Wer sein Telefon auf
 * Deutsch stehen hat und die App auf Englisch stellt, bekam damit JEDE
 * Snackbar und JEDE Fehlermeldung trotzdem auf Deutsch — ausgerechnet über
 * `meldung()`, die Funktion, die es nur gibt, damit Fehlermeldungen nicht in
 * einer Sprache herauskommen, die der Nutzer nicht gewählt hat.
 *
 * Auffallen kann das hier fast nicht: Die App ist auf Deutsch entwickelt, das
 * Prüfgerät steht auf Deutsch, und dann sieht die falsche Sprache aus wie die
 * richtige. Genau deshalb steht die Regel als Test und nicht als Merksatz.
 *
 * ── Was geprüft wird ────────────────────────────────────────────────────────
 * In den ViewModels, den Feature-Dateien und den Services darf `getString(`
 * nur auf einem Empfänger stehen, der in DERSELBEN Datei aus
 * `LanguageManager.localizedContext(...)` stammt. Der Name des Empfängers ist
 * dabei gleichgültig — geprüft wird die Herkunft.
 *
 * NICHT geprüft werden die Bildschirme unter `ui/screens/`: Dort ist `ctx`
 * `LocalContext.current`, also der Activity-Context — und den lokalisiert
 * AppCompatDelegate. Sie mit derselben Regel zu belegen hiesse, eine
 * Umständlichkeit zu erzwingen, die nichts repariert.
 *
 * Gegenproben (durchgeführt, über das Ersatz-Skript im Werkzeugordner):
 *   a) In MainViewModel.text() `localizedContext(ctx)` durch `ctx` ersetzt
 *      → Teilschritt 1 rot (Empfänger stammt nicht mehr aus localizedContext).
 *   b) In GalleryFeature eine Meldung wieder auf `ctx.getString(...)` gestellt
 *      → Teilschritt 1 rot.
 *   c) In CsvImportService `loc` durch `this` ersetzt → Teilschritt 1 rot.
 *      Die Services waren schon richtig; die Probe zeigt, dass sie es bleiben
 *      müssen.
 *   d) Im Helfer `if (args.isEmpty())` entfernt → Teilschritt 3 rot.
 *
 * Beim Schreiben des Ersatz-Skripts fiel ausserdem auf, dass die erste Fassung
 * der Regel die beiden Services als Verstoss meldete: Sie binden ihren Context
 * als `private val loc: Context by lazy { … }` über zwei Zeilen, und das Muster
 * verlangte eine einzeilige Zuweisung. Wäre das so geblieben, hätte die Regel
 * genau die Dateien angeschwärzt, die es richtig machen — und man hätte sie
 * vermutlich entschärft statt korrigiert.
 */
class SpracheDerMeldungenTest {

    /** Dateien, in denen der Context NICHT von einer Activity kommt. */
    private fun betroffeneDateien(): List<Pair<String, String>> =
        Quellen.alle()
            .filter { f ->
                val p = f.absolutePath.replace('\\', '/')
                ("/ui/" in p || "/service/" in p) && "/ui/screens/" !in p
            }
            .map { it.name to Quellen.ohneKommentare(it.readText()) }

    @Test
    fun `Ressourcentexte kommen aus dem lokalisierten Context`() {
        val dateien = betroffeneDateien()
        assert(dateien.size >= 15) {
            "Nur ${dateien.size} Dateien gefunden — der Pfadfilter stimmt nicht mehr, " +
                "und die Pruefung waere still gruen."
        }

        val fehler = mutableListOf<String>()
        var geprueft = 0
        for ((name, s) in dateien) {
            // Empfaenger, die in dieser Datei aus localizedContext(...) stammen.
            // Beide Schreibweisen, und ueber die Zeile hinweg: die Services
            // binden ihn als `private val loc: Context by lazy { … }`, die
            // ViewModels als `val c = …` im Rumpf von text().
            val lokalisiert = Regex(
                """val\s+(\w+)[^\n]*?(?:=|by\s+lazy\s*\{)\s*(?:\n\s*)?[\w.]*localizedContext\(""")
                .findAll(s).map { it.groupValues[1] }.toSet()
            // Der Ausdruck kann auch direkt aufgerufen werden:
            //   localizedContext(ctx).getString(...)
            val direkt = Regex("""localizedContext\([^)]*\)\s*\.getString\(""")

            for (m in Regex("""(\w+)\s*\.getString\(""").findAll(s)) {
                geprueft++
                val empfaenger = m.groupValues[1]
                if (empfaenger in lokalisiert) continue
                // Zeile mit direktem Aufruf?
                val zeile = s.substring(s.lastIndexOf('\n', m.range.first) + 1,
                                        (s.indexOf('\n', m.range.first).takeIf { it >= 0 } ?: s.length))
                if (direkt.containsMatchIn(zeile)) continue
                fehler += "$name: $empfaenger.getString(...)"
            }
        }
        assert(geprueft > 0) { "Kein einziger getString-Aufruf gefunden — Muster veraltet?" }
        assert(fehler.isEmpty()) {
            "Diese Stellen holen Texte ueber einen Context, der unterhalb von " +
                "Android 13 die SYSTEM-Sprache traegt statt der eingestellten App-Sprache:\n  " +
                fehler.distinct().joinToString("\n  ") +
                "\nRichtig ist LanguageManager.localizedContext(...) — siehe MainViewModel.text()."
        }
    }

    @Test
    fun `die ViewModels haben den Helfer und benutzen ihn`() {
        // Ohne den Helfer schreibt der naechste Aufrufer wieder ctx.getString().
        for (datei in listOf("ui/MainViewModel.kt", "ui/viewmodel/CatalogViewModel.kt")) {
            val s = Quellen.ohneKommentare(Quellen.lies(datei))
            assert(Regex("""fun text\(id: Int, vararg args: Any\?\)""").containsMatchIn(s)) {
                "$datei hat keinen text()-Helfer mehr"
            }
            assert(s.contains("localizedContext")) {
                "$datei holt den lokalisierten Context nicht mehr"
            }
        }
    }

    @Test
    fun `ein Text ohne Argumente laeuft nicht durch String-format`() {
        // getString(id, *leer) formatiert trotzdem. Ein Text mit einem
        // einzelnen Prozentzeichen — etwa eine Prozentangabe — wuerde dort eine
        // Ausnahme werfen statt angezeigt zu werden, und zwar erst zur Laufzeit
        // und nur fuer genau diesen Text.
        for (datei in listOf("ui/MainViewModel.kt", "ui/viewmodel/CatalogViewModel.kt")) {
            val s = Quellen.ohneKommentare(Quellen.lies(datei))
            assert(s.contains("if (args.isEmpty()) c.getString(id) else c.getString(id, *args)")) {
                "$datei formatiert auch ohne Argumente — siehe MainViewModel.text()"
            }
        }
    }
}

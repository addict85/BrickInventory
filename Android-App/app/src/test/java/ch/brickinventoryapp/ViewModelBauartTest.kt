package ch.brickinventoryapp

import org.junit.Test

/**
 * Alle ViewModels sind gewöhnliche ViewModel — keines erbt seinen Context.
 *
 * ── Warum das mehr ist als Einheitlichkeit ──────────────────────────────────
 * `MainViewModel` war das EINZIGE `AndroidViewModel` im Baum. CatalogViewModel
 * und MonitoringViewModel sind gewöhnliche `ViewModel` und lassen sich den
 * Context einspritzen — genau wie ResponseCache, PreferencesManager und
 * PdfExportManager. Zwei Muster für dieselbe Sache also, und das seltenere war
 * das teurere:
 *
 * `AndroidViewModel` verlangt eine echte `Application` im Konstruktor. Damit
 * lässt sich die Klasse in einem JVM-Test nicht bauen — und das ist der Grund,
 * warum der grosse Teil der Android-Tests Quelltext LIEST, statt Code
 * auszuführen. Ein Test kann die Vermutung „loadSets() setzt den Ladezustand"
 * dann nur am Wortlaut prüfen, nicht am Ablauf.
 *
 * Der Context ist derselbe geblieben: `getApplication<Application>()
 * .applicationContext` und Hilts `@ApplicationContext` liefern dasselbe
 * Objekt. Was sich ändert, ist nur, dass er über die Tür hereinkommt statt aus
 * der Oberklasse — und damit in einem Test ersetzbar ist.
 *
 * Diese Prüfung hält den Weg offen. Sie behauptet NICHT, dass es die
 * Verhaltenstests schon gäbe; sie verhindert, dass die Tür wieder zufällt.
 *
 * Gegenproben (durchgeführt, über das Ersatz-Skript im Werkzeugordner):
 *   a) MainViewModel wieder auf `AndroidViewModel(application)` gestellt
 *      → Teilschritt 1 rot.
 *   b) Den `@ApplicationContext`-Parameter entfernt → Teilschritt 2 rot.
 */
class ViewModelBauartTest {

    private fun viewModelDateien() = Quellen.alle()
        .filter { it.name.endsWith("ViewModel.kt") }
        .map { it.name to Quellen.ohneKommentare(it.readText()) }

    @Test
    fun `kein ViewModel erbt seinen Context`() {
        val dateien = viewModelDateien()
        assert(dateien.size >= 3) {
            "Nur ${'$'}{dateien.size} ViewModel-Dateien gefunden — Muster veraltet? " +
                "Eine leere Suche wäre still grün."
        }
        val treffer = dateien.filter { (_, s) -> s.contains("AndroidViewModel") }.map { it.first }
        assert(treffer.isEmpty()) {
            "Diese ViewModels erben von AndroidViewModel: ${'$'}{treffer.joinToString()}.\n" +
                "AndroidViewModel verlangt eine echte Application im Konstruktor — die Klasse " +
                "lässt sich damit in keinem JVM-Test bauen. Den Context gibt es über " +
                "@ApplicationContext, wie in CatalogViewModel und in der ganzen Datenschicht."
        }
    }

    @Test
    fun `wer einen Context braucht, bekommt ihn eingespritzt`() {
        // Die Gegenrichtung: Ein ViewModel, das ctx benutzt, muss ihn auch
        // deklariert haben. Sonst wäre die Regel oben durch einen stillen
        // Rückgriff auf irgendeine andere Quelle zu umgehen.
        for ((name, s) in viewModelDateien()) {
            // `ctx\.` mit Punkt greift hier nicht mehr: Seit die Meldungen über
            // LanguageManager.localizedContext(ctx) laufen, steht der Context
            // fast überall als ARGUMENT, nicht als Empfänger. Die erste Fassung
            // dieser Regel war damit wirkungslos — aufgefallen an der
            // Gegenprobe, die grün blieb.
            if (!Regex("""\bctx\b""").containsMatchIn(s)) continue
            assert(s.contains("@param:ApplicationContext")) {
                "${'$'}name benutzt ctx, bekommt ihn aber nicht über @ApplicationContext"
            }
        }
    }
}

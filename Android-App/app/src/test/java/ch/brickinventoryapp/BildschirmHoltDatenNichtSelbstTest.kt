package ch.brickinventoryapp

import org.junit.Test
import java.io.File

/**
 * Kein Bildschirm greift an der Zustandsschicht vorbei in die Datenschicht.
 *
 * ── Der Befund ─────────────────────────────────────────────────────────────
 * MonitoringScreen.kt und MonitoringSections.kt riefen `vm.repo.…` an
 * sechzehn Stellen direkt aus Composables heraus — als einzige zwei Dateien
 * im Baum. Alles andere ging über MainViewModel.
 *
 * Das ist nicht bloss Stilbruch. Ladelogik in einem Lambda in einem
 * `items {}`-Block braucht die Compose-Laufzeit, um überhaupt abzulaufen —
 * ob ein fehlgeschlagenes Löschen die Liste wiederherstellt, konnte deshalb
 * niemand nachfahren. Seit sie in MonitoringViewModel steht, ist genau das
 * eine gewöhnliche Funktion.
 *
 * ── Warum die Prüfung über ALLE Bildschirme geht ───────────────────────────
 * Weil der Befund nicht „Monitoring" hiess, sondern „irgendein Bildschirm holt
 * sich seine Daten selbst". Eine Prüfung auf die zwei reparierten Dateien
 * fände den nächsten Fall nicht — und diesen Fehler hat dieses Projekt schon
 * mehrfach gemacht (Nachtrag 93, 155: eine Regel, die nur den einen
 * bekannten Ort kannte).
 *
 * Ausgenommen ist ui/ selbst (nicht die Unterordner): Dort liegen
 * MainViewModel und seine Feature-Erweiterungen. Die SIND die Zustandsschicht
 * und sollen ans Repository.
 *
 * Gegenprobe (durchgeführt): einen der entfernten Aufrufe
 * (`vm.repo.admin.getJobs()`) in MonitoringScreen.kt zurückgesetzt →
 * die erste Zusage wird rot und nennt Datei und Zeile.
 */
class BildschirmHoltDatenNichtSelbstTest {

    private val bildschirmOrdner = listOf("ui/screens", "ui/dialogs", "ui/components")

    private fun dateien(): List<File> = bildschirmOrdner
        .map { File("src/main/java/ch/brickinventoryapp/$it") }
        .filter { it.exists() }
        .flatMap { it.walkTopDown().filter { f -> f.isFile && f.extension == "kt" }.toList() }

    private fun ohneKommentare(src: String) = src.lines().joinToString("\n") {
        val t = it.trim()
        if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) "" else it
    }

    @Test
    fun `kein Composable ruft das Repository direkt auf`() {
        val alle = dateien()
        // Untergrenze: Ein leerer Dateilauf liesse jede Sammelpruefung
        // stillschweigend bestehen (dieselbe Vorsicht wie in SplitFileImportsTest).
        assert(alle.size >= 20) { "Nur ${alle.size} Bildschirmdateien gefunden — Pfade veraltet?" }

        val durchgriffe = mutableListOf<String>()
        for (f in alle) {
            ohneKommentare(f.readText()).lines().forEachIndexed { i, z ->
                if (Regex("""\brepo\s*\.\s*(sets|teile|finanzen|haushalt|admin)\s*\.""").containsMatchIn(z))
                    durchgriffe += "${f.name}:${i + 1}  ${z.trim().take(70)}"
            }
        }
        assert(durchgriffe.isEmpty()) {
            "Diese Composables holen ihre Daten selbst, statt sie von einem " +
                "ViewModel zu bekommen. Damit laesst sich die Ladelogik nur mit " +
                "Compose-Laufzeit ausfuehren — also gar nicht pruefen:\n  " +
                durchgriffe.joinToString("\n  ")
        }
    }

    @Test
    fun `das Monitoring hat ein eigenes ViewModel und der Bildschirm benutzt es`() {
        val vmDatei = File("src/main/java/ch/brickinventoryapp/ui/viewmodel/MonitoringViewModel.kt")
        assert(vmDatei.exists()) { "MonitoringViewModel.kt gibt es nicht (mehr)" }
        val vm = ohneKommentare(vmDatei.readText())

        assert(vm.contains("@HiltViewModel")) { "MonitoringViewModel wird nicht von Hilt gebaut" }
        assert(Regex("""class MonitoringViewModel @Inject constructor""").containsMatchIn(vm)) {
            "MonitoringViewModel bekommt seine Abhaengigkeiten nicht eingespritzt"
        }

        // Die sechzehn Aufrufe, die vorher in den Composables standen, muessen
        // hier gelandet sein — sonst ist der Umbau nur eine Verschiebung.
        val verlangt = listOf(
            "getJobs(", "getBricksetQueue(", "retryBricksetEntry(", "deleteBricksetEntry(",
            "reimportInstructions(", "triggerCsvSync(", "triggerPriceJob(",
            "redownloadMissingImages(", "getCacheStats(", "getApiLimits(", "getCacheTtl(",
            "setCacheTtl(", "setApiLimits(", "getDefaultCondition(", "setDefaultCondition(",
        )
        val fehlend = verlangt.filterNot { vm.contains(it) }
        assert(fehlend.isEmpty()) {
            "Diese Aufrufe standen vorher im Bildschirm und sind im ViewModel " +
                "nicht angekommen: ${fehlend.joinToString()}"
        }

        for (rel in listOf("ui/screens/MonitoringScreen.kt", "ui/screens/MonitoringSections.kt")) {
            val src = ohneKommentare(File("src/main/java/ch/brickinventoryapp/$rel").readText())
            assert(src.contains("hiltViewModel()")) { "$rel haengt das ViewModel nicht ein" }
            assert(src.contains("mon.state.collectAsStateWithLifecycle()")) {
                "$rel liest den Zustand nicht mit dem Lebenszyklus — bei einer " +
                    "Fuenf-Sekunden-Schleife heisst das Sammeln im Hintergrund"
            }
        }
    }

    @Test
    fun `jeder Zugriff auf den Monitoring-Zustand trifft ein Feld das es gibt`() {
        // Der Ersatz fuer den fehlenden Compiler — dieselbe Pruefung wie in
        // ScreenViewModelWiringTest, hier fuer die neue Zustandsklasse.
        val vm = File("src/main/java/ch/brickinventoryapp/ui/viewmodel/MonitoringViewModel.kt").readText()
        val i = vm.indexOf("data class MonitoringUiState(")
        assert(i >= 0) { "MonitoringUiState nicht gefunden" }
        var tiefe = 0
        var j = i
        while (j < vm.length) {
            if (vm[j] == '(') tiefe++ else if (vm[j] == ')') { tiefe--; if (tiefe == 0) break }
            j++
        }
        val felder = Regex("""val (\w+)\s*:""").findAll(vm.substring(i, j)).map { it.groupValues[1] }.toSet()
        assert(felder.size >= 5) { "MonitoringUiState hat nur ${felder.size} Felder — Klammersuche daneben?" }

        val fehler = mutableListOf<String>()
        for (rel in listOf("ui/screens/MonitoringScreen.kt", "ui/screens/MonitoringSections.kt")) {
            val src = ohneKommentare(File("src/main/java/ch/brickinventoryapp/$rel").readText())
            for (m in Regex("""\bmonState\.(\w+)""").findAll(src)) {
                if (m.groupValues[1] !in felder) fehler += "$rel: monState.${m.groupValues[1]}"
            }
        }
        assert(fehler.isEmpty()) { "Zustandszugriff ins Leere:\n  " + fehler.joinToString("\n  ") }
    }
}

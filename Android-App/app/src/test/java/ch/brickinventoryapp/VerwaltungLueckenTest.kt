package ch.brickinventoryapp

import org.junit.Test

/**
 * Drei Verwalter-Handlungen, die nur die Webapp konnte.
 *
 * ── Woher dieser Test kommt (Nachtrag 137) ──────────────────────────────────
 *
 * Aus derselben Messung wie die Nachtraege davor — Server-Adressen beider
 * Clients gegeneinander. Uebrig blieben drei, die zu Bildschirmen gehoeren,
 * die die App laengst hat:
 *
 *   /v1/admin/job-schedule    Zeitplan eines Jobs aendern
 *   /v1/admin/catalog-images  fehlende KATALOGbilder einreihen
 *   /v1/settings/admin/theme  das globale Design umstellen
 *
 * Beim Zeitplan war der Befund besonders deutlich: `/api/v1/admin/jobs`
 * SCHICKT `schedules` seit jeher mit, und die App hat das Feld nie eingelesen.
 * Ein Wert, der ueber die Leitung kommt und niemanden erreicht — dieselbe Sorte
 * Fund wie „geschrieben und nie gelesen", nur von der anderen Seite.
 *
 * Der Test liest nur Quelltext: kein Geraet, kein Compose.
 */
class VerwaltungLueckenTest {

    private fun read(rel: String) =
        java.io.File("src/main/java/ch/brickinventoryapp/$rel").readText()
    private fun code(s: String) = s.lines()
        .joinToString("\n") { if (it.trim().startsWith("//") || it.trim().startsWith("*")) "" else it }

    @Test
    fun `die App kennt alle drei Adressen`() {
        val api = code(read("data/api/BrickApiService.kt"))
        for (adresse in listOf(
            "api/v1/admin/job-schedule",
            "api/v1/admin/catalog-images",
            "api/v1/settings/admin/theme",
        )) {
            assert(api.contains("(\"$adresse\")")) { "Die App ruft $adresse nicht" }
        }
    }

    @Test
    fun `der Zeitplan wird eingelesen und angezeigt`() {
        val modelle = code(read("data/model/AdminKatalogModels.kt"))
        assert(modelle.contains("val schedules: Map<String, JobSchedule>")) {
            "JobsResponse liest den Zeitplan nicht ein — der Server schickt ihn seit jeher mit"
        }
        val vm = code(read("ui/viewmodel/MonitoringViewModel.kt"))
        assert(vm.contains("jobSchedules = r.data.schedules")) {
            "Der Zeitplan kommt nicht in den Zustand"
        }
        val ui = code(read("ui/screens/MonitoringScreen.kt"))
        assert(ui.contains("schedule = monState.jobSchedules[key]")) {
            "Die Job-Karte bekommt den Zeitplan nicht"
        }
    }

    @Test
    fun `nach dem Setzen wird neu geladen`() {
        // Der Server normalisiert: „7:5" wird zu „07:05", ein Abstand unter
        // fuenf Minuten wird auf fuenf angehoben. Ohne Nachladen stuende in der
        // Oberflaeche, was der Nutzer getippt hat, und nicht, was gilt.
        val vm = code(read("ui/viewmodel/MonitoringViewModel.kt"))
        val ab = vm.indexOf("suspend fun setzeJobZeitplan(")
        assert(ab > 0) { "setzeJobZeitplan fehlt" }
        val rumpf = vm.substring(ab, minOf(ab + 300, vm.length))
        assert(rumpf.contains("ladeJobs()")) { "Nach dem Setzen wird nicht neu geladen" }
    }

    @Test
    fun `die zwei Bilderknoepfe sind auseinanderzuhalten`() {
        // Der eine holt die Bilder des BESTANDS nach, der andere die des
        // KATALOGS. Zwei Knoepfe mit derselben Beschriftung waeren schlimmer
        // als einer.
        val ui = code(read("ui/screens/MonitoringScreen.kt"))
        assert(ui.contains("R.string.monitoring_redownload_missing")) { "Bestandsbilder-Knopf fehlt" }
        assert(ui.contains("R.string.monitoring_catalog_images")) { "Katalogbilder-Knopf fehlt" }
    }
}

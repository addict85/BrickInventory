package ch.brickinventoryapp

import org.junit.Test

/**
 * Das Design des Servers steht schon vor der Anmeldung fest.
 *
 * ── Woher dieser Test kommt (Nachtrag 135) ──────────────────────────────────
 *
 * `app_theme` ist eine GLOBALE Einstellung des Servers und kam bisher nur mit
 * /settings — also erst NACH der Anmeldung. Anmelde- und
 * Einrichtungsbildschirm erschienen dadurch bei jedem Kaltstart im
 * Standard-Design und sprangen nach dem Anmelden um.
 *
 * Die Webapp hat genau dieses Flackern behoben, in zwei Stufen
 * (public/js/00-theme-boot.js):
 *
 *   1. Sofort der zuletzt bekannte Wert aus dem Speicher — kein Netz, kein
 *      Aufblitzen des falschen Designs.
 *   2. Gleich danach asynchron GET /api/v1/settings/theme. Diese Adresse steht
 *      auf dem Server ABSICHTLICH vor dem Anmelde-Waechter (routes/settings.ts).
 *
 * ── Stufe NULL kam nach (Marcos zweiter Befund) ─────────────────────────────
 *
 * „Beim Starten der App sieht man teilweise das andere Design, insbesondere
 * dann wenn die Internetverbindung schlecht ist."
 *
 * Stufe eins war da — aber nur im DataStore, und der laesst sich ausschliesslich
 * ASYNCHRON lesen. MainActivity.setContent() laeuft sofort; die ersten Bilder
 * entstanden deshalb immer im Vorgabewert, und erst danach traf der gemerkte
 * Wert ein. Bei schlechtem Netz dauert der Kaltstart laenger und das Fenster
 * wird sichtbar.
 *
 * Die Webapp hatte das nie: 00-theme-boot.js ist ein BLOCKIERENDES Skript im
 * <head> und liest localStorage, bevor irgendetwas gezeichnet wird. Das
 * Gegenstueck sind SharedPreferences — synchron lesbar, und genau dafuer
 * benutzt Android sie selbst.
 *
 * Entscheidend ist, WO der Wert landet: im Startwert des Zustands, nicht in
 * einer Korrektur danach. `appTheme` wird als
 * `stateIn(..., _state.value.appTheme)` abgeleitet, und Kotlin wertet diese
 * Eigenschaft VOR dem init-Block aus.
 *
 * Gefunden durch Messen: Ein Vergleich der Server-Adressen beider Clients
 * meldete /v1/settings/theme als eine der Adressen, die nur die Webapp ruft.
 *
 * Der Test liest nur Quelltext: kein Geraet, kein Compose.
 */
class DesignVorAnmeldungTest {

    private fun read(rel: String) =
        java.io.File("src/main/java/ch/brickinventoryapp/$rel").readText()
    private fun code(s: String) = s.lines()
        .joinToString("\n") { if (it.trim().startsWith("//") || it.trim().startsWith("*")) "" else it }

    @Test
    fun `Stufe null - der gemerkte Wert ist SYNCHRON zu haben`() {
        val prefs = code(read("data/PreferencesManager.kt"))
        // Synchron heisst hier: SharedPreferences. DataStore kann es nicht,
        // und `runBlocking` auf dem Hauptthread waere die Wiederholung des
        // Fehlers, den der Bild-Interceptor schon einmal hatte.
        assert(prefs.contains("fun gemerktesDesign()")) {
            "Es gibt keinen synchron lesbaren Weg zum gemerkten Design — dann " +
                "entstehen die ersten Bilder wieder im Vorgabewert"
        }
        assert(prefs.contains("getSharedPreferences(")) {
            "gemerktesDesign() liest nicht aus SharedPreferences — DataStore " +
                "gibt den Wert nur asynchron her, und genau das war die Ursache"
        }
        assert(!prefs.contains("runBlocking")) {
            "Der Wert wird mit runBlocking geholt. Auf dem Hauptthread ist das " +
                "genau der Fehler, den der Bild-Interceptor schon einmal hatte"
        }

        // Und der Spiegel muss MIT dem DataStore geschrieben werden, sonst
        // laufen zwei Ablagen desselben Werts auseinander.
        val schreiben = Quellen.funktion(prefs, "suspend fun saveAppTheme(")
        assert(schreiben.isNotEmpty()) { "saveAppTheme fehlt" }
        assert(schreiben.contains("dataStore.edit") && schreiben.contains("designSpiegel")) {
            "saveAppTheme schreibt nur eine der beiden Ablagen — dann zeigt der " +
                "naechste Kaltstart das vorletzte Design"
        }
    }

    @Test
    fun `Stufe null - der Zustand wird MIT dem Design geboren`() {
        val vm = code(read("ui/MainViewModel.kt"))
        // Der Startwert, nicht eine Korrektur danach: `appTheme` leitet sich
        // ueber `stateIn(..., _state.value.appTheme)` ab, und diese Eigenschaft
        // wird VOR dem init-Block ausgewertet. Ein erst dort gesetzter Wert
        // kaeme zu spaet — MainActivity haette schon komponiert.
        assert(vm.contains("MutableStateFlow(AppUiState(appTheme = prefs.gemerktesDesign()))")) {
            "Der Zustand startet wieder im Vorgabe-Design. Ein Wert, der erst im " +
                "init-Block gesetzt wird, kommt nach der ersten Komposition — " +
                "genau das war Marcos aufblitzendes Design."
        }
    }

    @Test
    fun `Stufe eins - das Design wird gemerkt`() {
        val prefs = code(read("data/PreferencesManager.kt"))
        assert(prefs.contains("stringPreferencesKey(\"app_theme\")")) {
            "Das Design wird nicht gemerkt — jeder Kaltstart faengt wieder im Standard an"
        }
        // Unbekannte Werte duerfen den gemerkten Wert NICHT loeschen: "" oder
        // null heisst „keine Information", nicht „classic". Dieselbe Regel wie
        // applyTheme() in 00-theme-boot.js.
        assert(prefs.contains("if (theme == \"classic\" || theme == \"brick\")")) {
            "saveAppTheme schreibt auch unbekannte Werte — ein leerer Wert loescht dann das Design"
        }
    }

    @Test
    fun `Stufe zwei - die oeffentliche Adresse wird gerufen`() {
        val api = code(read("data/api/BrickApiService.kt"))
        assert(api.contains("@GET(\"api/v1/settings/theme\")")) {
            "Die App ruft die oeffentliche Design-Adresse nicht"
        }
        val vm = code(read("ui/MainViewModel.kt"))
        assert(vm.contains("prefs.appTheme.first()")) {
            "Der gemerkte Wert wird beim Start nicht gelesen"
        }
        assert(vm.contains("loadAppTheme()")) {
            "Die zweite Stufe fehlt — ein Wechsel am Server erreicht die App erst nach dem Anmelden"
        }
    }

    @Test
    fun `beide Wege merken sich das Ergebnis`() {
        // Sonst gilt Stufe eins nur fuer den Weg, der zufaellig zuletzt lief.
        val s = code(read("ui/SettingsFeature.kt"))
        val treffer = Regex("""prefs\.saveAppTheme\(""").findAll(s).count()
        assert(treffer >= 2) {
            "Nur $treffer Stelle(n) merken sich das Design — erwartet: /settings UND /settings/theme"
        }
    }
}

/**
 * Die Ueberwachung kann den Cache nicht nur ANSEHEN.
 *
 * ── Woher dieser Test kommt (Nachtrag 135) ──────────────────────────────────
 *
 * Aus derselben Messung wie das Design darueber: /v1/admin/cache-clear war
 * eine der Adressen, die nur die Webapp ruft. Die App zeigte die vier
 * Cache-Zahlen (Preise, veraltet, Teilmengen, Katalog) und liess die
 * Gueltigkeitsdauer einstellen — leeren konnte sie nicht. Man sah also, dass
 * tausend Preise veraltet sind, und hatte keine Handhabe.
 */
class CacheLeerenTest {

    private fun read(rel: String) =
        java.io.File("src/main/java/ch/brickinventoryapp/$rel").readText()
    private fun code(s: String) = s.lines()
        .joinToString("\n") { if (it.trim().startsWith("//") || it.trim().startsWith("*")) "" else it }

    @Test
    fun `die App kennt die Adresse und beide Umfaenge`() {
        val api = code(read("data/api/BrickApiService.kt"))
        assert(api.contains("@POST(\"api/v1/admin/cache-clear\")")) {
            "Die App ruft die Adresse zum Leeren nicht"
        }
        val repo = code(read("data/repository/AdminRepository.kt"))
        assert(repo.contains("if (alles) mapOf(\"all\" to true) else emptyMap()")) {
            "Der Umfang (nur Preise / alles) wird nicht unterschieden"
        }
    }

    @Test
    fun `nach dem Leeren werden die Zahlen neu geholt`() {
        // Ohne das staenden die alten Zahlen weiter da — bei einer Handlung,
        // die man genau einmal ausloest, ist das der ganze Unterschied
        // zwischen „hat funktioniert" und „nichts passiert".
        val s = code(read("ui/viewmodel/MonitoringViewModel.kt"))
        val ab = s.indexOf("suspend fun leereCache(")
        assert(ab > 0) { "leereCache fehlt" }
        val rumpf = s.substring(ab, minOf(ab + 300, s.length))
        assert(rumpf.contains("ladeCacheUndGrenzen()")) {
            "Nach dem Leeren werden die Cache-Zahlen nicht neu geholt"
        }
    }

    @Test
    fun `das Leeren fragt nach`() {
        // Anders als die Webapp: Jeder Neuaufbau kostet Anfragen aus dem
        // gemeinsamen Tageskontingent — das steht so im Kommentar der
        // Serverroute (routes/api_v1/admin.ts). Ein Fehlgriff nimmt also allen
        // anderen etwas weg, nicht nur dem, der danebengetippt hat.
        val s = code(read("ui/screens/MonitoringSections.kt"))
        assert(s.contains("R.string.monitoring_cache_clear_hint")) {
            "Es gibt keine Rueckfrage vor dem Leeren"
        }
        assert(s.contains("zeigeLeerenFrage = true")) {
            "Die Knoepfe leeren sofort statt nachzufragen"
        }
    }
}

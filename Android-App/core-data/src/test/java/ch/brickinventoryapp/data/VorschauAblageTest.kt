package ch.brickinventoryapp.data

import org.junit.Test
import ch.brickinventoryapp.testing.Quellen

/**
 * Was an der Vorschau-Ablage nur im Aufbau zu sehen ist: die Reihenfolge im Bild-Client,
 * der API-Client ohne Zwischenspeicher, der Anlauf beim App-Start, die erschöpfende
 * Netzlage, Manifest und Hinweis. Das Verhalten prüfen ausgeführt VorschauSpeicherTest,
 * VorschauVorwaermerTest, VorschauAbgriffTest, VorschauGeraetTest (Robolectric) und
 * SammlungVorwaermenTest (core-zustand).
 */
class VorschauAblageTest {

    private fun quelle(rel: String) =
        Quellen.ohneKommentare(Quellen.lies(rel))

    @Test
    fun `geschrieben wird ueber eine Nebendatei`() {
        // Halbe Dateien sehen aus wie Bilder; ein Abbruch mitten im Schreiben ist im Test
        // nicht herbeizuführen.
        val s = quelle("data/cache/VorschauSpeicher.kt")
        assert(s.contains(".tmp") && s.contains("renameTo")) {
            "Geschrieben wird nicht ueber eine Nebendatei — ein Abbruch " +
                "hinterlaesst dann eine halbe Datei, und die sieht aus wie ein Bild"
        }
    }

    @Test
    fun `die Verdrahtung der Clients im NetzModule`() {
        val s = Quellen.ohneKommentare(Quellen.di())
        // Anwendungs-Interceptoren laufen in der gesetzten Reihenfolge: Die Ablage sitzt
        // AUSSEN, damit sie auch den 504 des Offline-Rückfalls sieht.
        val ablage = s.indexOf(".addInterceptor(vorschauAbgriff(vorschau))")
        val rueckfall = s.indexOf("CacheControl.FORCE_CACHE")
        assert(ablage > 0 && rueckfall > 0) { "Ablage oder Offline-Rueckfall fehlen" }
        assert(ablage < rueckfall) {
            "Der Ablage-Abgriff sitzt HINTER dem Offline-Rueckfall. Dann sieht " +
                "er dessen 504 nicht und springt genau dann nicht ein, wenn es darauf ankommt."
        }
        // Aenderungen gehen nur online: Der API-Client hat weder Cache noch Rückfall.
        val ab = s.indexOf("fun provideApiOkHttpClient")
        assert(ab > 0) { "Der API-Client ist nicht mehr zu finden" }
        val bis = s.indexOf("@Provides", ab).let { if (it > 0) it else s.length }
        val apiClient = s.substring(ab, bis)
        assert(!apiClient.contains(".cache(")) { "Der API-Client hat einen Zwischenspeicher bekommen." }
        assert(!apiClient.contains("FORCE_CACHE") && !apiClient.contains("onlyIfCached")) {
            "Der API-Client hat einen Offline-Rueckfall bekommen."
        }
        // Das Vorwärmen holt je Schub zwei Bilder (VorschauVorwaermerTest); der Bild-Client
        // muss mehr Verbindungen je Host haben, sonst wartet die sichtbare Kachelwand.
        val proHost = Regex("""maxRequestsPerHost\s*=\s*(\d+)""").find(s)?.groupValues?.get(1)?.toInt()
        assert(proHost != null && proHost > 2) { "maxRequestsPerHost ist $proHost" }
    }

    @Test
    fun `der App-Start wartet den Anlauf ab und fragt vor dem Sammeln`() {
        val fe = quelle("zustand/ui/Vorwaermen.kt")
        assert(fe.contains("delay(VorschauVorwaermer.ANLAUF_MS)")) {
            "Der Anlauf fehlt — das Vorwaermen startet dann mitten in Anmeldung und erster Kachelwand"
        }
        assert(fe.contains("if (!vorwaermer.darfStarten()) return@launch")) {
            "Das Sammeln fragt nicht mehr vorher, ob es ueberhaupt losgehen darf"
        }
    }

    @Test
    fun `jede Netzlage hat ihre eigene Antwort, ohne else`() {
        val vw = quelle("data/cache/VorschauVorwaermer.kt")
        for (lage in listOf("KEIN_NETZ", "WLAN", "MOBIL", "ROAMING")) {
            assert(vw.contains("Netzlage.Art.$lage")) { "Die Netzlage $lage wird nicht mehr beantwortet" }
        }
        assert(!Regex("""netzErlaubt\(\)[\s\S]{0,400}?else\s*->""").containsMatchIn(vw)) {
            "netzErlaubt() hat einen else-Zweig bekommen. Dann faellt eine kuenftige " +
                "fuenfte Netzlage stillschweigend auf eine der bestehenden Antworten."
        }
    }

    @Test
    fun `Manifest und Einstellungen tragen die Netzlage`() {
        assert(Quellen.manifest.readText().contains("android.permission.ACCESS_NETWORK_STATE")) {
            "ACCESS_NETWORK_STATE fehlt im Manifest — dann kann die App die Netzlage gar nicht erkennen"
        }
        val ui = quelle("verwaltung/ui/screens/MonitoringCache.kt") + quelle("verwaltung/ui/screens/MonitoringScreen.kt")
        assert(ui.contains("R.string.monitoring_vorwaermen_hinweis")) {
            "Der Hinweis zum gemessenen WLAN fehlt in der Oberflaeche"
        }
    }
}

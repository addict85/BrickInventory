package ch.brickinventoryapp.data

import org.junit.Test
import ch.brickinventoryapp.testing.Quellen

/**
 * Was an der Vorschau-Ablage nur im Aufbau zu sehen ist: die Reihenfolge im Bild-Client,
 * der Anlauf beim App-Start, Manifest und Hinweis. Das Verhalten prüfen ausgeführt
 * PreviewStorageTest, PreviewWarmerTest (auch jede Netzlage),
 * PreviewTapTest, PreviewDeviceTest und CollectionWarmUpTest (core-state),
 * die Clients selbst ServerClientsTest.
 */
class PreviewStoreTest {

    private fun quelle(rel: String) =
        Quellen.withoutComments(Quellen.lies(rel))

    @Test
    fun `writing goes via a side file`() {
        // Halbe Dateien sehen aus wie Bilder; ein Abbruch mitten im Schreiben ist im Test
        // nicht herbeizuführen.
        val s = quelle("data/cache/VorschauSpeicher.kt")
        assert(s.contains(".tmp") && s.contains("renameTo")) {
            "Geschrieben wird nicht ueber eine Nebendatei — ein Abbruch " +
                "hinterlaesst dann eine halbe Datei, und die sieht aus wie ein Bild"
        }
    }

    @Test
    fun `the tap sits outside before the offline fallback`() {
        val s = Quellen.withoutComments(Quellen.di())
        // Anwendungs-Interceptoren laufen in der gesetzten Reihenfolge: Die Ablage sitzt
        // AUSSEN, damit sie auch den 504 des Offline-Rückfalls sieht.
        val ablage = s.indexOf(".addInterceptor(vorschauAbgriff(vorschau))")
        val fallback = s.indexOf("CacheControl.FORCE_CACHE")
        assert(ablage > 0 && fallback > 0) { "Ablage oder Offline-Rueckfall fehlen" }
        assert(ablage < fallback) {
            "Der Ablage-Abgriff sitzt HINTER dem Offline-Rueckfall. Dann sieht " +
                "er dessen 504 nicht und springt genau dann nicht ein, wenn es darauf ankommt."
        }
    }

    @Test
    fun `the app start waits for the startup and asks before collecting`() {
        val fe = quelle("state/ui/Vorwaermen.kt")
        assert(fe.contains("delay(VorschauVorwaermer.ANLAUF_MS)")) {
            "Der Anlauf fehlt — das Vorwaermen startet dann mitten in Anmeldung und erster Kachelwand"
        }
        assert(fe.contains("if (!vorwaermer.darfStarten()) return@launch")) {
            "Das Sammeln fragt nicht mehr vorher, ob es ueberhaupt losgehen darf"
        }
    }

    @Test
    fun `the manifest allows reading the network state`() {
        // Den Hinweis zum gemessenen WLAN bei den Netzen prüft CacheClearAsksTest (app).
        assert(Quellen.manifest.readText().contains("android.permission.ACCESS_NETWORK_STATE")) {
            "ACCESS_NETWORK_STATE fehlt im Manifest — dann kann die App die Netzlage gar nicht erkennen"
        }
    }
}

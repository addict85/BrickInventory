package ch.brickinventoryapp.data

import org.junit.Test
import ch.brickinventoryapp.testing.Quellen

/**
 * Was an der Vorschau-Ablage nur im Aufbau zu sehen ist: die Reihenfolge im Bild-Client,
 * der Anlauf beim App-Start, Manifest und Hinweis. Das Verhalten prüfen ausgeführt
 * VorschauSpeicherTest, VorschauVorwaermerTest (auch jede Netzlage),
 * VorschauAbgriffTest, VorschauGeraetTest und SammlungVorwaermenTest (core-zustand),
 * die Clients selbst ServerClientsTest.
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
    fun `der Abgriff sitzt aussen vor dem Offline-Rueckfall`() {
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
    fun `das Manifest erlaubt das Lesen der Netzlage`() {
        // Den Hinweis zum gemessenen WLAN bei den Netzen prüft CacheLeerenFragtTest (app).
        assert(Quellen.manifest.readText().contains("android.permission.ACCESS_NETWORK_STATE")) {
            "ACCESS_NETWORK_STATE fehlt im Manifest — dann kann die App die Netzlage gar nicht erkennen"
        }
    }
}

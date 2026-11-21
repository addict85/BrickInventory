package ch.brickinventoryapp.data

import org.junit.Test
import ch.brickinventoryapp.testing.Quellen

/**
 * What can only be seen in the structure of the preview store: the order in the image client,
 * the start at app launch, manifest and hint. The behavior is checked, executed, by
 * PreviewStorageTest, PreviewWarmerTest (also every network state),
 * PreviewTapTest, PreviewDeviceTest and CollectionWarmUpTest (core-state),
 * the clients themselves by ServerClientsTest.
 */
class PreviewStoreTest {

    private fun quelle(rel: String) =
        Quellen.withoutComments(Quellen.lies(rel))

    @Test
    fun `writing goes via a side file`() {
        // Half files look like images; an abort in the middle of writing cannot be
        // brought about in the test.
        val s = quelle("data/cache/VorschauSpeicher.kt")
        assert(s.contains(".tmp") && s.contains("renameTo")) {
            "Geschrieben wird nicht ueber eine Nebendatei — ein Abbruch " +
                "hinterlaesst dann eine halbe Datei, und die sieht aus wie ein Bild"
        }
    }

    @Test
    fun `the tap sits outside before the offline fallback`() {
        val s = Quellen.withoutComments(Quellen.di())
        // Application interceptors run in the set order: the store sits
        // OUTSIDE, so that it also sees the 504 of the offline fallback.
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
        // The hint about the metered Wi-Fi at the networks is checked by CacheClearAsksTest (app).
        assert(Quellen.manifest.readText().contains("android.permission.ACCESS_NETWORK_STATE")) {
            "ACCESS_NETWORK_STATE fehlt im Manifest — dann kann die App die Netzlage gar nicht erkennen"
        }
    }
}

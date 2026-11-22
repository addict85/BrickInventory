package ch.brickinventoryapp.data

import org.junit.Test
import ch.brickinventoryapp.testing.Sources

/**
 * What can only be seen in the structure of the preview store: the order in the image client,
 * the start at app launch, manifest and hint. The behavior is checked, executed, by
 * PreviewStorageTest, PreviewWarmerTest (also every network state),
 * PreviewTapTest, PreviewDeviceTest and CollectionWarmUpTest (core-state),
 * the clients themselves by ServerClientsTest.
 */
class PreviewStoreTest {

    private fun source(rel: String) =
        Sources.withoutComments(Sources.read(rel))

    @Test
    fun `writing goes via a side file`() {
        // Half files look like images; an abort in the middle of writing cannot be
        // brought about in the test.
        val s = source("data/cache/PreviewMemory.kt")
        assert(s.contains(".tmp") && s.contains("renameTo")) {
            "Geschrieben wird nicht ueber eine Nebendatei — ein Abbruch " +
                "hinterlaesst dann eine halbe Datei, und die sieht aus wie ein Bild"
        }
    }

    @Test
    fun `the tap sits outside before the offline fallback`() {
        val s = Sources.withoutComments(Sources.di())
        // Application interceptors run in the set order: the store sits
        // OUTSIDE, so that it also sees the 504 of the offline fallback.
        val store = s.indexOf(".addInterceptor(previewTap(preview))")
        val fallback = s.indexOf("CacheControl.FORCE_CACHE")
        assert(store > 0 && fallback > 0) { "Ablage oder Offline-Rueckfall fehlen" }
        assert(store < fallback) {
            "Der Ablage-Abgriff sitzt HINTER dem Offline-Rueckfall. Dann sieht " +
                "er dessen 504 nicht und springt genau dann nicht ein, wenn es darauf ankommt."
        }
    }

    @Test
    fun `the app start waits for the startup and asks before collecting`() {
        val fe = source("state/ui/Prewarm.kt")
        assert(fe.contains("delay(PreviewPrewarmer.RAMP_UP_MS)")) {
            "Der Anlauf fehlt — das Vorwaermen startet dann mitten in Anmeldung und erster Kachelwand"
        }
        assert(fe.contains("if (!prewarmer.mayStart()) return@launch")) {
            "Das Sammeln fragt nicht mehr vorher, ob es ueberhaupt losgehen darf"
        }
    }

    @Test
    fun `the manifest allows reading the network state`() {
        // The hint about the metered Wi-Fi at the networks is checked by CacheClearAsksTest (app).
        assert(Sources.manifest.readText().contains("android.permission.ACCESS_NETWORK_STATE")) {
            "ACCESS_NETWORK_STATE fehlt im Manifest — dann kann die App die Netzlage gar nicht erkennen"
        }
    }
}

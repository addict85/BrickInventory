package ch.brickinventoryapp.data

import ch.brickinventoryapp.testing.Sources
import org.junit.Test

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
            "Writing does not go through a side file — an abort " +
                "then leaves half a file behind, and it looks like an image"
        }
    }

    @Test
    fun `the tap sits outside before the offline fallback`() {
        val s = Sources.withoutComments(Sources.di())
        // Application interceptors run in the set order: the store sits
        // OUTSIDE, so that it also sees the 504 of the offline fallback.
        val store = s.indexOf(".addInterceptor(previewTap(preview))")
        val fallback = s.indexOf("CacheControl.FORCE_CACHE")
        assert(store > 0 && fallback > 0) { "Store or offline fallback missing" }
        assert(store < fallback) {
            "The store tap sits BEHIND the offline fallback. Then " +
                "it does not see its 504 and does not step in exactly when it matters."
        }
    }

    @Test
    fun `the app start waits for the startup and asks before collecting`() {
        val fe = source("state/ui/Prewarm.kt")
        assert(fe.contains("delay(PreviewPrewarmer.RAMP_UP_MS)")) {
            "The warm-up delay is missing — prewarming then starts in the middle of sign-in and the first tile wall"
        }
        assert(fe.contains("if (!prewarmer.mayStart()) return@launch")) {
            "Collecting no longer asks beforehand whether it may start at all"
        }
    }

    @Test
    fun `the manifest allows reading the network state`() {
        // The hint about the metered Wi-Fi at the networks is checked by CacheClearAsksTest (app).
        assert(Sources.manifest.readText().contains("android.permission.ACCESS_NETWORK_STATE")) {
            "ACCESS_NETWORK_STATE missing in the manifest — then the app cannot detect the network state at all"
        }
    }
}

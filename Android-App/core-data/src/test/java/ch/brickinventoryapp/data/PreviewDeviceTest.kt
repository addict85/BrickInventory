package ch.brickinventoryapp.data

import android.app.Application
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.data.cache.PreviewMemory
import ch.brickinventoryapp.data.testing.testTrustCipher
import ch.brickinventoryapp.security.StoreKey
import ch.brickinventoryapp.security.TokenEncryption
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowNetworkCapabilities
import java.io.File

/**
 * The parts of prewarming that need Android: where the preview store lies, how
 * the network situation is read from the network's capabilities, and that by default prewarming
 * happens only on Wi-Fi. Under Robolectric, with set network capabilities.
 *
 * Counter-checks (patches under counter-checks/, Robolectric, measured by CI):
 *   vorschau-im-cache           the store under cacheDir → red “the store lies under filesDir”
 *   netzlage-hotspot-als-wlan   a metered Wi-Fi counts as Wi-Fi → red “a metered Wi-Fi …”
 *   netzlage-ohne-roaming       roaming never detected → red “abroad …”
 *   vorwaermen-vorgabe-mobil    default for mobile true → red “by default warming happens only on Wi-Fi”
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class PreviewDeviceTest {

    private val ctx = ApplicationProvider.getApplicationContext<Application>()

    /** Robolectric has no AndroidKeyStore; wrapping here is only for show. */
    private object PlainVault : TokenEncryption {
        override fun encrypt(plaintext: String) = plaintext
        override fun decrypt(saved: String) = saved
    }

    private fun situation(transport: Int, vararg capable: Int): NetworkState.Kind {
        val cm = ctx.getSystemService(ConnectivityManager::class.java)
        // Created empty: neither NOT_METERED nor NOT_ROAMING, only what the case sets.
        val nc = ShadowNetworkCapabilities.newInstance()
        shadowOf(nc).addTransportType(transport)
        capable.forEach { shadowOf(nc).addCapability(it) }
        shadowOf(cm).setNetworkCapabilities(cm.activeNetwork, nc)
        return NetworkState(ctx).current()
    }

    @Test
    fun `the store lies under filesDir, where Android does not clean up`() {
        val key = StoreKey(File(ctx.noBackupFilesDir, "vorschau-test.schluessel"), PlainVault)
        PreviewMemory(ctx, key).write("https://brick.example/api/v2/images/set/1-1?thumb=1", "bild".toByteArray())
        assertTrue("Nothing lies under filesDir", File(ctx.filesDir, "vorschau").walkTopDown().any { it.isFile })
        assertFalse("The store lies (also) under cacheDir", ctx.cacheDir.walkTopDown().any { it.isFile })
    }

    @Test
    fun `a metered Wi-Fi counts as mobile`() {
        val internet = NetworkCapabilities.NET_CAPABILITY_INTERNET
        assertEquals(NetworkState.Kind.WIFI,
            situation(NetworkCapabilities.TRANSPORT_WIFI, internet, NetworkCapabilities.NET_CAPABILITY_NOT_METERED))
        assertEquals("A phone's hotspot is Wi-Fi with a data plan",
            NetworkState.Kind.MOBILE, situation(NetworkCapabilities.TRANSPORT_WIFI, internet))
        assertEquals(NetworkState.Kind.NO_NETWORK, situation(NetworkCapabilities.TRANSPORT_WIFI))
    }

    @Test
    fun `abroad mobile is roaming`() {
        val internet = NetworkCapabilities.NET_CAPABILITY_INTERNET
        assertEquals(NetworkState.Kind.MOBILE,
            situation(NetworkCapabilities.TRANSPORT_CELLULAR, internet, NetworkCapabilities.NET_CAPABILITY_NOT_ROAMING))
        assertEquals(NetworkState.Kind.ROAMING, situation(NetworkCapabilities.TRANSPORT_CELLULAR, internet))
    }

    @Test
    fun `by default warming happens only on Wi-Fi`() = runBlocking {
        val store = PreferenceDataStoreFactory.create { File(ctx.filesDir, "vorwaermen-${System.nanoTime()}.preferences_pb") }
        val device = DevicesStore(ctx, store, testTrustCipher())
        val default = PrewarmNetwork.entries.associateWith { device.warmUpAllowed(it).first() }
        assertEquals(mapOf(PrewarmNetwork.WIFI to true, PrewarmNetwork.MOBILE to false, PrewarmNetwork.ROAMING to false), default)
        device.warmUpSet(PrewarmNetwork.ROAMING, true)
        assertTrue("The choice is remembered", device.warmUpAllowed(PrewarmNetwork.ROAMING).first())
    }
}

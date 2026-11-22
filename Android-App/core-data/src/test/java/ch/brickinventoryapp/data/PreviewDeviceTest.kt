package ch.brickinventoryapp.data

import android.app.Application
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.data.cache.VorschauSpeicher
import ch.brickinventoryapp.security.Ablageschluessel
import ch.brickinventoryapp.security.TokenEncryption
import ch.brickinventoryapp.testing.testVertrauenschiffre
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
 * Counter-checks (patches under gegenproben/, Robolectric, measured by CI):
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
    private object Klartresor : TokenEncryption {
        override fun verschluessle(klartext: String) = klartext
        override fun entschluessle(gespeichert: String) = gespeichert
    }

    private fun situation(transport: Int, vararg capable: Int): Netzlage.Art {
        val cm = ctx.getSystemService(ConnectivityManager::class.java)
        // Created empty: neither NOT_METERED nor NOT_ROAMING, only what the case sets.
        val nc = ShadowNetworkCapabilities.newInstance()
        shadowOf(nc).addTransportType(transport)
        capable.forEach { shadowOf(nc).addCapability(it) }
        shadowOf(cm).setNetworkCapabilities(cm.activeNetwork, nc)
        return Netzlage(ctx).aktuell()
    }

    @Test
    fun `the store lies under filesDir, where Android does not clean up`() {
        val schluessel = Ablageschluessel(File(ctx.noBackupFilesDir, "vorschau-test.schluessel"), Klartresor)
        VorschauSpeicher(ctx, schluessel).schreibe("https://brick.example/api/v1/images/set/1-1?thumb=1", "bild".toByteArray())
        assertTrue("Unter filesDir liegt nichts", File(ctx.filesDir, "vorschau").walkTopDown().any { it.isFile })
        assertFalse("Die Ablage liegt (auch) unter cacheDir", ctx.cacheDir.walkTopDown().any { it.isFile })
    }

    @Test
    fun `a metered Wi-Fi counts as mobile`() {
        val internet = NetworkCapabilities.NET_CAPABILITY_INTERNET
        assertEquals(Netzlage.Art.WLAN,
            situation(NetworkCapabilities.TRANSPORT_WIFI, internet, NetworkCapabilities.NET_CAPABILITY_NOT_METERED))
        assertEquals("Der Hotspot eines Telefons ist WLAN mit Datentarif",
            Netzlage.Art.MOBILE, situation(NetworkCapabilities.TRANSPORT_WIFI, internet))
        assertEquals(Netzlage.Art.KEIN_NETZ, situation(NetworkCapabilities.TRANSPORT_WIFI))
    }

    @Test
    fun `abroad mobile is roaming`() {
        val internet = NetworkCapabilities.NET_CAPABILITY_INTERNET
        assertEquals(Netzlage.Art.MOBILE,
            situation(NetworkCapabilities.TRANSPORT_CELLULAR, internet, NetworkCapabilities.NET_CAPABILITY_NOT_ROAMING))
        assertEquals(Netzlage.Art.ROAMING, situation(NetworkCapabilities.TRANSPORT_CELLULAR, internet))
    }

    @Test
    fun `by default warming happens only on Wi-Fi`() = runBlocking {
        val store = PreferenceDataStoreFactory.create { File(ctx.filesDir, "vorwaermen-${System.nanoTime()}.preferences_pb") }
        val geraet = DevicesStore(ctx, store, testVertrauenschiffre())
        val vorgabe = VorwaermNetwork.entries.associateWith { geraet.warmUpAllowed(it).first() }
        assertEquals(mapOf(VorwaermNetwork.WLAN to true, VorwaermNetwork.MOBILE to false, VorwaermNetwork.ROAMING to false), vorgabe)
        geraet.warmUpSet(VorwaermNetwork.ROAMING, true)
        assertTrue("Die Wahl wird gemerkt", geraet.warmUpAllowed(VorwaermNetwork.ROAMING).first())
    }
}

package ch.brickinventoryapp.data

import android.app.Application
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.data.cache.VorschauSpeicher
import ch.brickinventoryapp.data.util.Ablageschluessel
import ch.brickinventoryapp.data.util.TokenVerschluesselung
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
 * Die Teile des Vorwärmens, die Android brauchen: wo die Vorschau-Ablage liegt, wie
 * die Netzlage aus den Fähigkeiten des Netzes gelesen wird, und dass ab Werk nur im
 * WLAN vorgewärmt wird. Unter Robolectric, mit gesetzten Netzfähigkeiten.
 *
 * Gegenproben (Patches unter gegenproben/, Robolectric, misst die CI):
 *   vorschau-im-cache           die Ablage unter cacheDir → rot „die Ablage liegt unter filesDir“
 *   netzlage-hotspot-als-wlan   ein gemessenes WLAN gilt als WLAN → rot „ein gemessenes WLAN …“
 *   netzlage-ohne-roaming       Roaming nie erkannt → rot „im Ausland …“
 *   vorwaermen-vorgabe-mobil    Vorgabe für Mobilfunk true → rot „ab Werk nur im WLAN“
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class VorschauGeraetTest {

    private val ctx = ApplicationProvider.getApplicationContext<Application>()

    /** Robolectric hat keinen AndroidKeyStore; umhüllt wird hier nur zum Schein. */
    private object Klartresor : TokenVerschluesselung {
        override fun verschluessle(klartext: String) = klartext
        override fun entschluessle(gespeichert: String) = gespeichert
    }

    private fun lage(transport: Int, vararg faehig: Int): Netzlage.Art {
        val cm = ctx.getSystemService(ConnectivityManager::class.java)
        // Leer angelegt: weder NOT_METERED noch NOT_ROAMING, nur was der Fall setzt.
        val nc = ShadowNetworkCapabilities.newInstance()
        shadowOf(nc).addTransportType(transport)
        faehig.forEach { shadowOf(nc).addCapability(it) }
        shadowOf(cm).setNetworkCapabilities(cm.activeNetwork, nc)
        return Netzlage(ctx).aktuell()
    }

    @Test
    fun `die Ablage liegt unter filesDir, wo Android nicht aufraeumt`() {
        val schluessel = Ablageschluessel(File(ctx.noBackupFilesDir, "vorschau-test.schluessel"), Klartresor)
        VorschauSpeicher(ctx, schluessel).schreibe("https://brick.example/api/v1/images/set/1-1?thumb=1", "bild".toByteArray())
        assertTrue("Unter filesDir liegt nichts", File(ctx.filesDir, "vorschau").walkTopDown().any { it.isFile })
        assertFalse("Die Ablage liegt (auch) unter cacheDir", ctx.cacheDir.walkTopDown().any { it.isFile })
    }

    @Test
    fun `ein gemessenes WLAN zaehlt als Mobilfunk`() {
        val internet = NetworkCapabilities.NET_CAPABILITY_INTERNET
        assertEquals(Netzlage.Art.WLAN,
            lage(NetworkCapabilities.TRANSPORT_WIFI, internet, NetworkCapabilities.NET_CAPABILITY_NOT_METERED))
        assertEquals("Der Hotspot eines Telefons ist WLAN mit Datentarif",
            Netzlage.Art.MOBIL, lage(NetworkCapabilities.TRANSPORT_WIFI, internet))
        assertEquals(Netzlage.Art.KEIN_NETZ, lage(NetworkCapabilities.TRANSPORT_WIFI))
    }

    @Test
    fun `im Ausland ist Mobilfunk Roaming`() {
        val internet = NetworkCapabilities.NET_CAPABILITY_INTERNET
        assertEquals(Netzlage.Art.MOBIL,
            lage(NetworkCapabilities.TRANSPORT_CELLULAR, internet, NetworkCapabilities.NET_CAPABILITY_NOT_ROAMING))
        assertEquals(Netzlage.Art.ROAMING, lage(NetworkCapabilities.TRANSPORT_CELLULAR, internet))
    }

    @Test
    fun `ab Werk wird nur im WLAN vorgewaermt`() = runBlocking {
        val store = PreferenceDataStoreFactory.create { File(ctx.filesDir, "vorwaermen-${System.nanoTime()}.preferences_pb") }
        val geraet = GeraeteAblage(ctx, store, testVertrauenschiffre())
        val vorgabe = VorwaermNetz.entries.associateWith { geraet.vorwaermenErlaubt(it).first() }
        assertEquals(mapOf(VorwaermNetz.WLAN to true, VorwaermNetz.MOBIL to false, VorwaermNetz.ROAMING to false), vorgabe)
        geraet.setzeVorwaermen(VorwaermNetz.ROAMING, true)
        assertTrue("Die Wahl wird gemerkt", geraet.vorwaermenErlaubt(VorwaermNetz.ROAMING).first())
    }
}

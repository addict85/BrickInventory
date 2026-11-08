package ch.brickinventoryapp.data

import android.app.Application
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.datastore.preferences.core.Preferences
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.data.util.TokenVerschluesselung
import ch.brickinventoryapp.testing.testVertrauenschiffre
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File
import java.util.concurrent.atomic.AtomicInteger

/**
 * Der Wächter sieht neuen Token und neue Adresse, BEVOR die erste Anfrage hinausgeht:
 * Die TokenAblage setzt den Speicherwert vor der Plattenschreibung, und ein neuer
 * Prozess bekommt beide aus dem DataStore nachgefüllt. Ausgeführt mit einem DataStore,
 * der jede Schreibung anhält, bis der Test sie freigibt.
 *
 * Gegenproben (Patches unter gegenproben/, Robolectric, misst die CI):
 *   token-nach-der-schreibung    _authTokenState erst nach dataStore.edit gesetzt → rot „Token und Adresse …“
 *   adresse-nach-der-schreibung  _serverUrlState erst nach dataStore.edit gesetzt → rot, derselbe Test
 *   token-ohne-nachlauf          der Spiegel für _authTokenState entfernt → rot „ein neuer Prozess …“
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class TokenSpeicherwertTest {

    private val ctx = ApplicationProvider.getApplicationContext<Application>()
    private val bereich = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val datei = File(ctx.filesDir, "token-${System.nanoTime()}.preferences_pb")
    private val echt = PreferenceDataStoreFactory.create(scope = bereich) { datei }
    private val geraet = GeraeteAblage(ctx,
        PreferenceDataStoreFactory.create { File(ctx.filesDir, "geraet-${System.nanoTime()}.preferences_pb") },
        testVertrauenschiffre())

    /** Robolectric hat keinen AndroidKeyStore; umhüllt wird hier nur zum Schein. */
    private object Klartresor : TokenVerschluesselung {
        override fun verschluessle(klartext: String) = klartext
        override fun entschluessle(gespeichert: String) = gespeichert
    }

    /** Hält jede Schreibung an, solange [tor] gesetzt ist; [wartend] zählt die angehaltenen. */
    private class Zoegernd(private val echt: DataStore<Preferences>) : DataStore<Preferences> {
        @Volatile var tor: CompletableDeferred<Unit>? = null
        val wartend = AtomicInteger()
        override val data: Flow<Preferences> = echt.data
        override suspend fun updateData(transform: suspend (t: Preferences) -> Preferences): Preferences {
            tor?.let { wartend.incrementAndGet(); it.await() }
            return echt.updateData(transform)
        }
    }

    @After
    fun zu() { bereich.cancel() }

    /** Startet [schreiben], hält es an der Platte an und gibt den Speicherwert in diesem Moment zurück. */
    private fun waehrendDerSchreibung(store: Zoegernd, schreiben: suspend () -> Unit, lies: () -> String?): String? = runBlocking {
        val tor = CompletableDeferred<Unit>()
        store.tor = tor
        val vorher = store.wartend.get()
        val lauf = bereich.launch { schreiben() }
        withTimeout(5_000) { while (store.wartend.get() == vorher) delay(5) }
        val gesehen = lies()
        store.tor = null
        tor.complete(Unit)
        lauf.join()
        gesehen
    }

    @Test
    fun `Token und Adresse gelten schon waehrend der Plattenschreibung`() {
        val store = Zoegernd(echt)
        val ablage = TokenAblage(store, Klartresor, geraet, bereich).also { it.warteAufStart() }
        val adresse = "https://brick.example"
        assertEquals("Die Adresse folgt erst der Platte", adresse,
            waehrendDerSchreibung(store, { ablage.saveServerUrl(adresse) }) { ablage.serverUrlState.value })
        assertEquals("Der Token folgt erst der Platte", "token-marco",
            waehrendDerSchreibung(store, { ablage.saveAuthToken("token-marco") }) { ablage.authTokenState.value })
    }

    @Test
    fun `ein neuer Prozess bekommt Token und Adresse aus dem DataStore`() = runBlocking {
        val erste = TokenAblage(echt, Klartresor, geraet, bereich).also { it.warteAufStart() }
        erste.saveServerUrl("https://brick.example")
        erste.saveAuthToken("token-marco")

        val neu = TokenAblage(echt, Klartresor, geraet, bereich).also { it.warteAufStart() }
        assertEquals("https://brick.example", neu.serverUrlState.value)
        assertEquals("token-marco", neu.authTokenState.value)
    }
}

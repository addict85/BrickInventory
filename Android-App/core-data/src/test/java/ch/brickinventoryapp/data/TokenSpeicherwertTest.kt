package ch.brickinventoryapp.data

import android.app.Application
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.datastore.preferences.core.Preferences
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.security.TokenEncryption
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
    private val geraet = DevicesStore(ctx,
        PreferenceDataStoreFactory.create { File(ctx.filesDir, "geraet-${System.nanoTime()}.preferences_pb") },
        testVertrauenschiffre())

    /** Robolectric hat keinen AndroidKeyStore; umhüllt wird hier nur zum Schein. */
    private object Klartresor : TokenEncryption {
        override fun verschluessle(klartext: String) = klartext
        override fun entschluessle(gespeichert: String) = gespeichert
    }

    /** Hält jede Schreibung an, solange [gate] gesetzt ist; [waiting] zählt die angehaltenen. */
    private class Hesitant(private val echt: DataStore<Preferences>) : DataStore<Preferences> {
        @Volatile var gate: CompletableDeferred<Unit>? = null
        val waiting = AtomicInteger()
        override val data: Flow<Preferences> = echt.data
        override suspend fun updateData(transform: suspend (t: Preferences) -> Preferences): Preferences {
            gate?.let { waiting.incrementAndGet(); it.await() }
            return echt.updateData(transform)
        }
    }

    @After
    fun zu() { bereich.cancel() }

    /** Startet [schreiben], hält es an der Platte an und gibt den Speicherwert in diesem Moment zurück. */
    private fun duringTheSpelling(store: Hesitant, schreiben: suspend () -> Unit, lies: () -> String?): String? = runBlocking {
        val gate = CompletableDeferred<Unit>()
        store.gate = gate
        val vorher = store.waiting.get()
        val lauf = bereich.launch { schreiben() }
        withTimeout(5_000) { while (store.waiting.get() == vorher) delay(5) }
        val gesehen = lies()
        store.gate = null
        gate.complete(Unit)
        lauf.join()
        gesehen
    }

    @Test
    fun `token and address apply already while writing to disk`() {
        val store = Hesitant(echt)
        val ablage = TokenAblage(store, Klartresor, geraet, bereich).also { it.waitOnStart() }
        val adresse = "https://brick.example"
        assertEquals("Die Adresse folgt erst der Platte", adresse,
            duringTheSpelling(store, { ablage.saveServerUrl(adresse) }) { ablage.serverUrlState.value })
        assertEquals("Der Token folgt erst der Platte", "token-marco",
            duringTheSpelling(store, { ablage.saveAuthToken("token-marco") }) { ablage.authTokenState.value })
    }

    @Test
    fun `a new process gets token and address from the DataStore`() = runBlocking {
        val erste = TokenAblage(echt, Klartresor, geraet, bereich).also { it.waitOnStart() }
        erste.saveServerUrl("https://brick.example")
        erste.saveAuthToken("token-marco")

        val neu = TokenAblage(echt, Klartresor, geraet, bereich).also { it.waitOnStart() }
        assertEquals("https://brick.example", neu.serverUrlState.value)
        assertEquals("token-marco", neu.authTokenState.value)
    }
}

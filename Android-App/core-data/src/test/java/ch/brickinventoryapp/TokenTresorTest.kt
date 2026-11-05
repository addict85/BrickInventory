package ch.brickinventoryapp

import android.content.Context
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.data.PreferencesManager
import ch.brickinventoryapp.data.dataStore
import ch.brickinventoryapp.util.KeystoreTokenTresor
import ch.brickinventoryapp.util.TokenVerschluesselung
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Das Token liegt nur verschlüsselt, ein Klartext älterer Fassungen wird einmal
 * übernommen, und Abmelden räumt beide Einträge weg — ausgeführt am echten
 * PreferencesManager; ein Neustart ist eine neue Instanz auf derselben Platte.
 *
 * Gegenproben (Robolectric, misst die CI; Job `gegenproben`):
 *   klartext-bleibt-nach-speichern  saveAuthToken() ohne remove(AUTH_TOKEN) → rot
 *                                   „Speichern legt nur noch verschluesselt ab“
 *   abmelden-laesst-geheimtext      clearSession() ohne remove(AUTH_TOKEN_ENC) → rot
 *                                   „Abmelden entfernt beide Eintraege“
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class TokenTresorTest {

    /** Umkehrbar, aber erkennbar anders als der Klartext; [kaputt]: Schlüssel weg. */
    private class Attrappe(val kaputt: Boolean = false) : TokenVerschluesselung {
        override fun verschluessle(klartext: String) = "ENC(" + klartext.reversed() + ")"
        override fun entschluessle(gespeichert: String): String? =
            if (kaputt || !gespeichert.startsWith("ENC(") || !gespeichert.endsWith(")")) null
            else gespeichert.removePrefix("ENC(").removeSuffix(")").reversed()
    }

    private val ctx = ApplicationProvider.getApplicationContext<Context>()
    private val bereiche = mutableListOf<CoroutineScope>()

    private fun start(tresor: TokenVerschluesselung = Attrappe()): PreferencesManager {
        val bereich = CoroutineScope(SupervisorJob() + Dispatchers.IO).also { bereiche += it }
        return PreferencesManager(ctx, tresor, bereich).also { it.warteAufStart() }
    }

    private fun platte(): Preferences = runBlocking { ctx.dataStore.data.first() }

    private fun lege(klartext: String? = null, geheim: String? = null) = runBlocking {
        ctx.dataStore.edit {
            it[PreferencesManager.SERVER_URL] = "https://brick.example"
            klartext?.let { k -> it[PreferencesManager.AUTH_TOKEN] = k }
            geheim?.let { g -> it[PreferencesManager.AUTH_TOKEN_ENC] = g }
        }
        Unit
    }

    @Before
    fun leer() = runBlocking { ctx.dataStore.edit { it.clear() }; Unit }

    @After
    fun zu() = bereiche.forEach { it.cancel() }

    @Test
    fun `ein bestehendes Klartext-Token bleibt nach dem Update lesbar und wird einmal uebernommen`() {
        lege(klartext = "altes-token-123")
        val prefs = start()
        assertEquals("altes-token-123", runBlocking { prefs.tokenJetzt() })
        assertTrue("Es gab etwas zu übernehmen", runBlocking { prefs.uebernehmeAltesToken() })
        assertNull("Der Klartext muss weg sein", platte()[PreferencesManager.AUTH_TOKEN])
        assertEquals("ENC(321-nekot-setla)", platte()[PreferencesManager.AUTH_TOKEN_ENC])
        assertFalse("Beim zweiten Start gibt es nichts mehr zu tun", runBlocking { prefs.uebernehmeAltesToken() })
        assertEquals("altes-token-123", runBlocking { start().tokenJetzt() })
    }

    @Test
    fun `ein leerer Alteintrag wird entfernt, gilt aber nicht als Uebernahme`() {
        lege(klartext = "")
        val prefs = start()
        assertFalse(runBlocking { prefs.uebernehmeAltesToken() })
        assertFalse(PreferencesManager.AUTH_TOKEN in platte().asMap())
        assertEquals("", runBlocking { prefs.tokenJetzt() })
    }

    @Test
    fun `Speichern legt nur noch verschluesselt ab`() {
        lege(klartext = "alt")
        val prefs = start()
        runBlocking { prefs.saveAuthToken("neu") }
        assertNull("Der alte Klartext verschwindet beim Schreiben", platte()[PreferencesManager.AUTH_TOKEN])
        assertEquals("ENC(uen)", platte()[PreferencesManager.AUTH_TOKEN_ENC])
        assertEquals("neu", runBlocking { start().tokenJetzt() })
    }

    @Test
    fun `der Lesepfad versucht zuerst den verschluesselten Wert`() {
        lege(klartext = "alt", geheim = "ENC(uen)")
        assertEquals("neu", runBlocking { start().tokenJetzt() })
    }

    @Test
    fun `Abmelden entfernt beide Eintraege`() {
        lege(klartext = "alt", geheim = "ENC(uen)")
        val prefs = start()
        runBlocking { prefs.clearSession() }
        assertFalse(PreferencesManager.AUTH_TOKEN in platte().asMap())
        assertFalse(PreferencesManager.AUTH_TOKEN_ENC in platte().asMap())
        assertEquals("Über den Altbestand wieder angemeldet", "", runBlocking { start().tokenJetzt() })
    }

    @Test
    fun `ein nicht entschluesselbarer Eintrag gilt als kein Token`() {
        lege(geheim = "ENC(sinnlos)")
        assertEquals("", runBlocking { start(Attrappe(kaputt = true)).tokenJetzt() })
    }

    @Test
    fun `der Keystore-Tresor gibt Unlesbares nie als Klartext zurueck`() {
        // Robolectric hat keinen AndroidKeyStore: Jeder Versuch scheitert, und das darf
        // nur „nicht lesbar“ heissen, nie der Eingabewert.
        assertNull(KeystoreTokenTresor("test_alias").entschluessle("klartext-statt-geheimtext"))
    }
}

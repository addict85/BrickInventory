package ch.brickinventoryapp.data

import ch.brickinventoryapp.testing.testVertrauenschiffre
import android.content.Context
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.sicherheit.EntsperrTresor
import ch.brickinventoryapp.sicherheit.TokenVerschluesselung
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
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File

/**
 * Das Token liegt nur verschlüsselt, ein Klartext älterer Fassungen gilt nie und wird
 * entfernt, Adresse und Name liegen verschlüsselt, und Abmelden räumt beide Einträge
 * weg — ausgeführt an der echten TokenAblage; ein Neustart ist eine neue Instanz auf
 * derselben Platte.
 *
 * Gegenproben (Robolectric, misst die CI; Job `gegenproben`):
 *   klartext-bleibt-nach-speichern  saveAuthToken() ohne remove(AUTH_TOKEN) → rot
 *                                   „Speichern legt nur noch verschluesselt ab“
 *   abmelden-laesst-geheimtext      clearSession() ohne remove(AUTH_TOKEN_ENC) → rot
 *                                   „Abmelden entfernt beide Eintraege“
 *   altbestand-nicht-umgeschluesselt  uebernehmeAltesToken() ohne umschluesseln(prefs) → rot
 *                                   „ein Token unter dem alten Schluessel kommt beim Start …“
 *   klartext-token-gilt-wieder      der Spiegel liest AUTH_TOKEN wieder als Token → rot
 *                                   „ein Klartext-Token aelterer Fassungen gilt nie …“
 *   angaben-im-klartext             setzeAngabe() schreibt den Klartext → rot
 *                                   „Adresse und Name liegen nur verschluesselt …“
 *   angaben-ohne-uebernahme         uebernimmAngaben() lässt den Klartext stehen → rot, derselbe Test
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

    /** Je Test eine eigene Datei; DataStore erlaubt je Datei nur eine Instanz im Prozess. */
    private val store = PreferenceDataStoreFactory.create { File(ctx.filesDir, "tresor-${System.nanoTime()}.preferences_pb") }

    private fun start(tresor: TokenVerschluesselung = Attrappe()): TokenAblage {
        val bereich = CoroutineScope(SupervisorJob() + Dispatchers.IO).also { bereiche += it }
        return TokenAblage(store, tresor, GeraeteAblage(ctx, store, testVertrauenschiffre()), bereich).also { it.warteAufStart() }
    }

    private fun platte(): Preferences = runBlocking { store.data.first() }

    private fun lege(klartext: String? = null, geheim: String? = null) = runBlocking {
        store.edit {
            it[TokenAblage.SERVER_URL] = "https://brick.example"
            klartext?.let { k -> it[TokenAblage.AUTH_TOKEN] = k }
            geheim?.let { g -> it[TokenAblage.AUTH_TOKEN_ENC] = g }
        }
        Unit
    }

    @After
    fun zu() = bereiche.forEach { it.cancel() }

    @Test
    fun `ein Klartext-Token aelterer Fassungen gilt nie und wird beim Start entfernt`() {
        lege(klartext = "altes-token-123")
        val prefs = start()
        assertEquals("Ein Klartext-Token gilt nicht als Anmeldung", "", runBlocking { prefs.tokenJetzt() })
        assertEquals("", runBlocking { prefs.authToken.first() })
        assertTrue("Es gab etwas zu entfernen", runBlocking { prefs.uebernehmeAltesToken() })
        assertNull("Der Klartext muss weg sein", platte()[TokenAblage.AUTH_TOKEN])
        assertNull("Nichts wird aus dem Klartext übernommen", platte()[TokenAblage.AUTH_TOKEN_ENC])
        assertFalse("Beim zweiten Start gibt es nichts mehr zu tun", runBlocking { prefs.uebernehmeAltesToken() })
    }

    @Test
    fun `Adresse und Name liegen nur verschluesselt, alte Klartexte werden beim Start uebernommen`() {
        lege()
        runBlocking { store.edit { it[TokenAblage.USERNAME] = "marco" } }
        val prefs = start()
        val p = platte()
        assertNull("Die Adresse liegt nach dem Start noch im Klartext", p[TokenAblage.SERVER_URL])
        assertNull("Der Name liegt nach dem Start noch im Klartext", p[TokenAblage.USERNAME])
        for (geheim in listOf(p[TokenAblage.SERVER_URL_ENC], p[TokenAblage.USERNAME_ENC]))
            assertTrue("Geheimtext fehlt oder verrät den Wert: $geheim",
                geheim != null && "brick" !in geheim && "marco" !in geheim)
        assertEquals("https://brick.example", runBlocking { prefs.serverUrlJetzt() })
        assertEquals("marco", runBlocking { prefs.username.first() })

        runBlocking { prefs.saveServerUrl("https://brick.example/neu"); prefs.saveUsername("anna") }
        val danach = platte()
        assertFalse(TokenAblage.SERVER_URL in danach.asMap() || TokenAblage.USERNAME in danach.asMap())
        val neu = start()
        assertEquals("https://brick.example/neu", runBlocking { neu.serverUrlJetzt() })
        assertEquals("anna", runBlocking { neu.username.first() })
    }

    @Test
    fun `ein leerer Alteintrag wird entfernt, gilt aber nicht als Uebernahme`() {
        lege(klartext = "")
        val prefs = start()
        assertFalse(runBlocking { prefs.uebernehmeAltesToken() })
        assertFalse(TokenAblage.AUTH_TOKEN in platte().asMap())
        assertEquals("", runBlocking { prefs.tokenJetzt() })
    }

    @Test
    fun `Speichern legt nur noch verschluesselt ab`() {
        lege(klartext = "alt")
        val prefs = start()
        runBlocking { prefs.saveAuthToken("neu") }
        assertNull("Der alte Klartext verschwindet beim Schreiben", platte()[TokenAblage.AUTH_TOKEN])
        assertEquals("ENC(uen)", platte()[TokenAblage.AUTH_TOKEN_ENC])
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
        assertFalse(TokenAblage.AUTH_TOKEN in platte().asMap())
        assertFalse(TokenAblage.AUTH_TOKEN_ENC in platte().asMap())
        assertEquals("Über den Altbestand wieder angemeldet", "", runBlocking { start().tokenJetzt() })
    }

    @Test
    fun `ein nicht entschluesselbarer Eintrag gilt als kein Token`() {
        lege(geheim = "ENC(sinnlos)")
        assertEquals("", runBlocking { start(Attrappe(kaputt = true)).tokenJetzt() })
    }

    /** Streng wie das Gerät: verschlüsselt nur, solange [gesperrt] nein sagt. */
    private class Streng(val gesperrt: () -> Boolean) : TokenVerschluesselung {
        override fun verschluessle(klartext: String): String {
            check(!gesperrt()) { "Gerät gesperrt" }
            return "S(" + klartext.reversed() + ")"
        }
        override fun entschluessle(gespeichert: String): String? =
            gespeichert.takeIf { it.startsWith("S(") }?.removePrefix("S(")?.removeSuffix(")")?.reversed()
    }

    @Test
    fun `ein Token unter dem alten Schluessel kommt beim Start unter den strengen`() {
        lege(geheim = "ENC(tla)")
        var gesperrt = true
        val tresor = EntsperrTresor(Streng { gesperrt }, Attrappe())
        runBlocking { start(tresor).uebernehmeAltesToken() }
        assertEquals("Gesperrt bleibt der Altbestand, wie er ist", "ENC(tla)", platte()[TokenAblage.AUTH_TOKEN_ENC])

        gesperrt = false
        val prefs = start(tresor)
        runBlocking { prefs.uebernehmeAltesToken() }
        val geheim = platte()[TokenAblage.AUTH_TOKEN_ENC]!!
        assertFalse("Umgeschlüsselt: $geheim", tresor.veraltet(geheim))
        assertEquals("alt", runBlocking { start(tresor).tokenJetzt() })
    }
}

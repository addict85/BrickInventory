package ch.brickinventoryapp.data

import ch.brickinventoryapp.testing.testVertrauenschiffre
import android.content.Context
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.security.EntsperrVault
import ch.brickinventoryapp.security.TokenEncryption
import ch.brickinventoryapp.security.Tresorbefund
import ch.brickinventoryapp.security.Vertrauenschiffre
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
import java.io.IOException

/**
 * Das Token liegt nur verschlüsselt, ein Klartext älterer Fassungen gilt nie und wird
 * entfernt, Adresse und Name liegen verschlüsselt, und Abmelden räumt beide Einträge
 * weg — ausgeführt an der echten TokenAblage; ein Neustart ist eine neue Instanz auf
 * derselben Platte.
 *
 * Gegenproben (Robolectric, misst die CI; Job `gegenproben`):
 *   klartext-bleibt-nach-speichern  saveAuthToken() ohne remove(AUTH_TOKEN) → rot
 *                                   „saving stores only encrypted now“
 *   abmelden-laesst-geheimtext      clearSession() ohne remove(AUTH_TOKEN_ENC) → rot
 *                                   „sign-out removes both entries“
 *   altbestand-nicht-umgeschluesselt  adoptOldToken() ohne umschluesseln(prefs) → rot
 *                                   „ein Token unter dem alten Schluessel kommt beim Start …“
 *   klartext-token-gilt-wieder      der Spiegel liest AUTH_TOKEN wieder als Token → rot
 *                                   „ein Klartext-Token aelterer Fassungen gilt nie …“
 *   angaben-im-klartext             setze() schreibt zusätzlich den Klartext → rot
 *                                   „Adresse und Name liegen nur verschluesselt …“
 *   angaben-ohne-uebernahme         adoptDetails() lässt den Klartext stehen → rot, derselbe Test
 *   angaben-unter-pin-schluessel    verschluessleDetail() nimmt wieder den Schlüssel der Pins →
 *                                   rot „Adresse und Name frueherer Fassungen kommen unter den
 *                                   Entsperr-Schluessel …“
 *   angaben-gesperrt-geloescht      adoptDetails() entfernt die frühere Form auch ohne neue →
 *                                   rot „gesperrt bleibt die fruehere Form liegen …“
 *   hochstufen-erst-beim-start      levelTokenHigh() ohne Wirkung → rot „nach dem Entsperren kommt
 *                                   ein Token …“
 *   token-alter-alias-bleibt        levelTokenHigh() ohne forgetLegacyStock → rot, derselbe Test
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class TokenVaultTest {

    /** Umkehrbar, aber erkennbar anders als der Klartext; [kaputt]: Schlüssel weg. */
    private class Attrappe(val kaputt: Boolean = false) : TokenEncryption {
        /** Wie oft der Schlüssel selbst gelöscht wurde. */
        var vergessen = 0
        override fun vergiss() { vergessen++ }
        override fun verschluessle(klartext: String) = "ENC(" + klartext.reversed() + ")"
        override fun entschluessle(gespeichert: String): String? =
            if (kaputt || !gespeichert.startsWith("ENC(") || !gespeichert.endsWith(")")) null
            else gespeichert.removePrefix("ENC(").removeSuffix(")").reversed()
    }

    private val ctx = ApplicationProvider.getApplicationContext<Context>()
    private val areas = mutableListOf<CoroutineScope>()

    /** Je Test eine eigene Datei; DataStore erlaubt je Datei nur eine Instanz im Prozess. */
    private val store = PreferenceDataStoreFactory.create { File(ctx.filesDir, "tresor-${System.nanoTime()}.preferences_pb") }

    private fun start(tresor: TokenEncryption = Attrappe(), cipher: Vertrauenschiffre = testVertrauenschiffre()): TokenAblage {
        val bereich = CoroutineScope(SupervisorJob() + Dispatchers.IO).also { areas += it }
        return TokenAblage(store, tresor, DevicesStore(ctx, store, cipher), bereich).also { it.waitOnStart() }
    }

    private fun platte(): Preferences = runBlocking { store.data.first() }

    private fun put(klartext: String? = null, geheim: String? = null) = runBlocking {
        store.edit {
            it[TokenAblage.SERVER_URL] = "https://brick.example"
            klartext?.let { k -> it[TokenAblage.AUTH_TOKEN] = k }
            geheim?.let { g -> it[TokenAblage.AUTH_TOKEN_ENC] = g }
        }
        Unit
    }

    @After
    fun zu() = areas.forEach { it.cancel() }

    @Test
    fun `a plaintext token of older versions never counts and is removed at start`() {
        put(klartext = "altes-token-123")
        val prefs = start()
        assertEquals("Ein Klartext-Token gilt nicht als Anmeldung", "", runBlocking { prefs.tokenJetzt() })
        assertEquals("", runBlocking { prefs.authToken.first() })
        assertTrue("Es gab etwas zu entfernen", runBlocking { prefs.adoptOldToken() })
        assertNull("Der Klartext muss weg sein", platte()[TokenAblage.AUTH_TOKEN])
        assertNull("Nichts wird aus dem Klartext übernommen", platte()[TokenAblage.AUTH_TOKEN_ENC])
        assertFalse("Beim zweiten Start gibt es nichts mehr zu tun", runBlocking { prefs.adoptOldToken() })
    }

    @Test
    fun `address and name lie only encrypted, old plaintexts are taken over at start`() {
        put()
        runBlocking { store.edit { it[TokenAblage.USERNAME] = "marco" } }
        val prefs = start()
        val p = platte()
        assertNull("Die Adresse liegt nach dem Start noch im Klartext", p[TokenAblage.SERVER_URL])
        assertNull("Der Name liegt nach dem Start noch im Klartext", p[TokenAblage.USERNAME])
        for (geheim in listOf(p[TokenAblage.SERVER_URL_SECRET], p[TokenAblage.USERNAME_SECRET]))
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

    /** Die Angaben unter dem eigenen Schlüssel, die Pins unter einem anderen: so im Gerät (SecurityModule). */
    private var gesperrt = false
    private val twoKey = Vertrauenschiffre(angaben = {
        if (gesperrt) throw IOException("Keystore gerade nicht bereit")
        ByteArray(32) { 3 }
    }) { ByteArray(32) { 7 } }

    @Test
    fun `address and name of earlier versions go under the unlock key`() {
        runBlocking {
            store.edit {
                it[TokenAblage.SERVER_URL_ENC] = testVertrauenschiffre().verschluessle("https://brick.example", "angabe:server_url_enc")!!
                it[TokenAblage.USERNAME_ENC] = testVertrauenschiffre().verschluessle("marco", "angabe:username_enc")!!
            }
        }
        val prefs = start(cipher = twoKey)
        assertEquals("https://brick.example", runBlocking { prefs.serverUrlJetzt() })
        assertEquals("marco", runBlocking { prefs.username.first() })
        val p = platte()
        assertFalse("Die frühere Form ist weg", TokenAblage.SERVER_URL_ENC in p.asMap() || TokenAblage.USERNAME_ENC in p.asMap())
        assertEquals(Tresorbefund.Readable("https://brick.example"),
            twoKey.openDetail(p[TokenAblage.SERVER_URL_SECRET]!!, TokenAblage.SERVER_URL_SECRET.name))
        assertEquals("Nicht unter dem Schlüssel der Pins", null,
            testVertrauenschiffre().entschluessle(p[TokenAblage.SERVER_URL_SECRET]!!, "angabe:server_url_geheim"))
    }

    @Test
    fun `locked the earlier form stays and the new one applies after unlocking`() {
        put()
        gesperrt = true
        val vorher = start(cipher = twoKey)
        assertEquals("Ein Klartext älterer Fassung bleibt lesbar", "https://brick.example", runBlocking { vorher.serverUrlJetzt() })
        assertEquals("Gesperrt nicht übernommen, aber auch nicht verloren", "https://brick.example", platte()[TokenAblage.SERVER_URL])
        gesperrt = false
        val danach = start(cipher = twoKey)
        assertEquals("https://brick.example", runBlocking { danach.serverUrlJetzt() })
        assertNull(platte()[TokenAblage.SERVER_URL])
        gesperrt = true
        assertEquals("Gesperrt ist die Adresse nicht lesbar", "", runBlocking { start(cipher = twoKey).serverUrlJetzt() })
        assertTrue("Und doch nicht gelöscht", TokenAblage.SERVER_URL_SECRET in platte().asMap())
        gesperrt = false
        assertEquals("https://brick.example", runBlocking { start(cipher = twoKey).serverUrlJetzt() })
    }

    @Test
    fun `an empty old entry is removed but does not count as a takeover`() {
        put(klartext = "")
        val prefs = start()
        assertFalse(runBlocking { prefs.adoptOldToken() })
        assertFalse(TokenAblage.AUTH_TOKEN in platte().asMap())
        assertEquals("", runBlocking { prefs.tokenJetzt() })
    }

    @Test
    fun `saving stores only encrypted now`() {
        put(klartext = "alt")
        val prefs = start()
        runBlocking { prefs.saveAuthToken("neu") }
        assertNull("Der alte Klartext verschwindet beim Schreiben", platte()[TokenAblage.AUTH_TOKEN])
        assertEquals("ENC(uen)", platte()[TokenAblage.AUTH_TOKEN_ENC])
        assertEquals("neu", runBlocking { start().tokenJetzt() })
    }

    @Test
    fun `the read path tries the encrypted value first`() {
        put(klartext = "alt", geheim = "ENC(uen)")
        assertEquals("neu", runBlocking { start().tokenJetzt() })
    }

    @Test
    fun `sign-out removes both entries`() {
        put(klartext = "alt", geheim = "ENC(uen)")
        val prefs = start()
        runBlocking { prefs.clearSession() }
        assertFalse(TokenAblage.AUTH_TOKEN in platte().asMap())
        assertFalse(TokenAblage.AUTH_TOKEN_ENC in platte().asMap())
        assertEquals("Über den Altbestand wieder angemeldet", "", runBlocking { start().tokenJetzt() })
    }

    @Test
    fun `an entry that cannot be decrypted counts as no token`() {
        put(geheim = "ENC(sinnlos)")
        assertEquals("", runBlocking { start(Attrappe(kaputt = true)).tokenJetzt() })
    }

    /** Streng wie das Gerät: verschlüsselt nur, solange [gesperrt] nein sagt. */
    private class Strict(val gesperrt: () -> Boolean) : TokenEncryption {
        override fun verschluessle(klartext: String): String {
            check(!gesperrt()) { "Gerät gesperrt" }
            return "S(" + klartext.reversed() + ")"
        }
        override fun entschluessle(gespeichert: String): String? =
            gespeichert.takeIf { it.startsWith("S(") }?.removePrefix("S(")?.removeSuffix(")")?.reversed()
    }

    @Test
    fun `a token under the old key goes under the strict one at start`() {
        put(geheim = "ENC(tla)")
        var gesperrt = true
        val tresor = EntsperrVault(Strict { gesperrt }, Attrappe())
        runBlocking { start(tresor).adoptOldToken() }
        assertEquals("Gesperrt bleibt der Altbestand, wie er ist", "ENC(tla)", platte()[TokenAblage.AUTH_TOKEN_ENC])

        gesperrt = false
        val prefs = start(tresor)
        runBlocking { prefs.adoptOldToken() }
        val geheim = platte()[TokenAblage.AUTH_TOKEN_ENC]!!
        assertFalse("Umgeschlüsselt: $geheim", tresor.veraltet(geheim))
        assertEquals("alt", runBlocking { start(tresor).tokenJetzt() })
    }

    /** Nicht erst beim nächsten Start: Das Entsperren (ACTION_USER_PRESENT) stuft gleich hoch. */
    @Test
    fun `after unlocking a token under the old key goes under the strict one immediately`() {
        put(geheim = "ENC(tla)")
        var gesperrt = true
        val alt = Attrappe()
        val tresor = EntsperrVault(Strict { gesperrt }, alt)
        val prefs = start(tresor)
        runBlocking { prefs.levelTokenHigh() }
        assertEquals("Gesperrt bleibt es, wie es ist", "ENC(tla)", platte()[TokenAblage.AUTH_TOKEN_ENC])
        assertEquals("Gesperrt bleibt der alte Schlüssel", 0, alt.vergessen)

        gesperrt = false
        runBlocking { prefs.levelTokenHigh() }
        val geheim = platte()[TokenAblage.AUTH_TOKEN_ENC]!!
        assertFalse("Hochgestuft ohne Neustart: $geheim", tresor.veraltet(geheim))
        assertEquals("alt", runBlocking { prefs.tokenJetzt() })
        assertEquals("Der alte Schlüssel ist danach gelöscht", 1, alt.vergessen)
    }
}

package ch.brickinventoryapp.data

import ch.brickinventoryapp.testing.testTrustCipher
import android.content.Context
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.security.UnlockVault
import ch.brickinventoryapp.security.TokenEncryption
import ch.brickinventoryapp.security.VaultFinding
import ch.brickinventoryapp.security.TrustCipher
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
 * The token lies only encrypted, a plaintext of older versions never counts and is
 * removed, address and name lie encrypted, and sign-out clears away both entries
 * — executed on the real TokenStore; a restart is a new instance on
 * the same disk.
 *
 * Counter-checks (Robolectric, measured by CI; job `counter-checks`):
 *   klartext-bleibt-nach-speichern  saveAuthToken() without remove(AUTH_TOKEN) → red
 *                                   “saving stores only encrypted now”
 *   abmelden-laesst-geheimtext      clearSession() without remove(AUTH_TOKEN_ENC) → red
 *                                   “sign-out removes both entries”
 *   altbestand-nicht-umgeschluesselt  adoptOldToken() without umschluesseln(prefs) → red
 *                                   “a token under the old key goes under the strict one at start”
 *   klartext-token-gilt-wieder      the mirror reads AUTH_TOKEN as token again → red
 *                                   “a plaintext token of older versions never counts …”
 *   angaben-im-klartext             set() additionally writes the plaintext → red
 *                                   “address and name lie only encrypted …”
 *   angaben-ohne-uebernahme         adoptDetails() leaves the plaintext standing → red, the same test
 *   angaben-unter-pin-schluessel    encryptDetail() takes the pins' key again →
 *                                   red “address and name of earlier versions go under the
 *                                   unlock key”
 *   angaben-gesperrt-geloescht      adoptDetails() removes the earlier form even without a new one →
 *                                   red “locked the earlier form stays …”
 *   hochstufen-erst-beim-start      levelTokenHigh() without effect → red “after unlocking
 *                                   a token …”
 *   token-alter-alias-bleibt        levelTokenHigh() without forgetLegacyStock → red, the same test
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class TokenVaultTest {

    /** Reversible, but recognizably different from the plaintext; [broken]: key gone. */
    private class Fake(val broken: Boolean = false) : TokenEncryption {
        /** How often the key itself was deleted. */
        var forget = 0
        override fun forgetNow() { forget++ }
        override fun encrypt(plaintext: String) = "ENC(" + plaintext.reversed() + ")"
        override fun decrypt(saved: String): String? =
            if (broken || !saved.startsWith("ENC(") || !saved.endsWith(")")) null
            else saved.removePrefix("ENC(").removeSuffix(")").reversed()
    }

    private val ctx = ApplicationProvider.getApplicationContext<Context>()
    private val areas = mutableListOf<CoroutineScope>()

    /** One file per test; DataStore allows only one instance per file in the process. */
    private val store = PreferenceDataStoreFactory.create { File(ctx.filesDir, "tresor-${System.nanoTime()}.preferences_pb") }

    private fun start(vault: TokenEncryption = Fake(), cipher: TrustCipher = testTrustCipher()): TokenStore {
        val area = CoroutineScope(SupervisorJob() + Dispatchers.IO).also { areas += it }
        return TokenStore(store, vault, DevicesStore(ctx, store, cipher), area).also { it.waitOnStart() }
    }

    private fun plate(): Preferences = runBlocking { store.data.first() }

    private fun put(plaintext: String? = null, secret: String? = null) = runBlocking {
        store.edit {
            it[TokenStore.SERVER_URL] = "https://brick.example"
            plaintext?.let { k -> it[TokenStore.AUTH_TOKEN] = k }
            secret?.let { g -> it[TokenStore.AUTH_TOKEN_ENC] = g }
        }
        Unit
    }

    @After
    fun tearDown() = areas.forEach { it.cancel() }

    @Test
    fun `a plaintext token of older versions never counts and is removed at start`() {
        put(plaintext = "altes-token-123")
        val prefs = start()
        assertEquals("Ein Klartext-Token gilt nicht als Anmeldung", "", runBlocking { prefs.tokenNow() })
        assertEquals("", runBlocking { prefs.authToken.first() })
        assertTrue("Es gab etwas zu entfernen", runBlocking { prefs.adoptOldToken() })
        assertNull("Der Klartext muss weg sein", plate()[TokenStore.AUTH_TOKEN])
        assertNull("Nichts wird aus dem Klartext übernommen", plate()[TokenStore.AUTH_TOKEN_ENC])
        assertFalse("Beim zweiten Start gibt es nichts mehr zu tun", runBlocking { prefs.adoptOldToken() })
    }

    @Test
    fun `address and name lie only encrypted, old plaintexts are taken over at start`() {
        put()
        runBlocking { store.edit { it[TokenStore.USERNAME] = "marco" } }
        val prefs = start()
        val p = plate()
        assertNull("Die Adresse liegt nach dem Start noch im Klartext", p[TokenStore.SERVER_URL])
        assertNull("Der Name liegt nach dem Start noch im Klartext", p[TokenStore.USERNAME])
        for (secret in listOf(p[TokenStore.SERVER_URL_SECRET], p[TokenStore.USERNAME_SECRET]))
            assertTrue("Geheimtext fehlt oder verrät den Wert: $secret",
                secret != null && "brick" !in secret && "marco" !in secret)
        assertEquals("https://brick.example", runBlocking { prefs.serverUrlNow() })
        assertEquals("marco", runBlocking { prefs.username.first() })

        runBlocking { prefs.saveServerUrl("https://brick.example/neu"); prefs.saveUsername("anna") }
        val after = plate()
        assertFalse(TokenStore.SERVER_URL in after.asMap() || TokenStore.USERNAME in after.asMap())
        val newValue = start()
        assertEquals("https://brick.example/neu", runBlocking { newValue.serverUrlNow() })
        assertEquals("anna", runBlocking { newValue.username.first() })
    }

    /** The details under their own key, the pins under another: as on the device (SecurityModule). */
    private var locked = false
    private val twoKey = TrustCipher(info = {
        if (locked) throw IOException("Keystore gerade nicht bereit")
        ByteArray(32) { 3 }
    }) { ByteArray(32) { 7 } }

    @Test
    fun `address and name of earlier versions go under the unlock key`() {
        runBlocking {
            store.edit {
                it[TokenStore.SERVER_URL_ENC] = testTrustCipher().encrypt("https://brick.example", "angabe:server_url_enc")!!
                it[TokenStore.USERNAME_ENC] = testTrustCipher().encrypt("marco", "angabe:username_enc")!!
            }
        }
        val prefs = start(cipher = twoKey)
        assertEquals("https://brick.example", runBlocking { prefs.serverUrlNow() })
        assertEquals("marco", runBlocking { prefs.username.first() })
        val p = plate()
        assertFalse("Die frühere Form ist weg", TokenStore.SERVER_URL_ENC in p.asMap() || TokenStore.USERNAME_ENC in p.asMap())
        assertEquals(VaultFinding.Readable("https://brick.example"),
            twoKey.openDetail(p[TokenStore.SERVER_URL_SECRET]!!, TokenStore.SERVER_URL_SECRET.name))
        assertEquals("Nicht unter dem Schlüssel der Pins", null,
            testTrustCipher().decrypt(p[TokenStore.SERVER_URL_SECRET]!!, "angabe:server_url_geheim"))
    }

    @Test
    fun `locked the earlier form stays and the new one applies after unlocking`() {
        put()
        locked = true
        val before = start(cipher = twoKey)
        assertEquals("Ein Klartext älterer Fassung bleibt lesbar", "https://brick.example", runBlocking { before.serverUrlNow() })
        assertEquals("Gesperrt nicht übernommen, aber auch nicht verloren", "https://brick.example", plate()[TokenStore.SERVER_URL])
        locked = false
        val after = start(cipher = twoKey)
        assertEquals("https://brick.example", runBlocking { after.serverUrlNow() })
        assertNull(plate()[TokenStore.SERVER_URL])
        locked = true
        assertEquals("Gesperrt ist die Adresse nicht lesbar", "", runBlocking { start(cipher = twoKey).serverUrlNow() })
        assertTrue("Und doch nicht gelöscht", TokenStore.SERVER_URL_SECRET in plate().asMap())
        locked = false
        assertEquals("https://brick.example", runBlocking { start(cipher = twoKey).serverUrlNow() })
    }

    @Test
    fun `an empty old entry is removed but does not count as a takeover`() {
        put(plaintext = "")
        val prefs = start()
        assertFalse(runBlocking { prefs.adoptOldToken() })
        assertFalse(TokenStore.AUTH_TOKEN in plate().asMap())
        assertEquals("", runBlocking { prefs.tokenNow() })
    }

    @Test
    fun `saving stores only encrypted now`() {
        put(plaintext = "alt")
        val prefs = start()
        runBlocking { prefs.saveAuthToken("neu") }
        assertNull("Der alte Klartext verschwindet beim Schreiben", plate()[TokenStore.AUTH_TOKEN])
        assertEquals("ENC(uen)", plate()[TokenStore.AUTH_TOKEN_ENC])
        assertEquals("neu", runBlocking { start().tokenNow() })
    }

    @Test
    fun `the read path tries the encrypted value first`() {
        put(plaintext = "alt", secret = "ENC(uen)")
        assertEquals("neu", runBlocking { start().tokenNow() })
    }

    @Test
    fun `sign-out removes both entries`() {
        put(plaintext = "alt", secret = "ENC(uen)")
        val prefs = start()
        runBlocking { prefs.clearSession() }
        assertFalse(TokenStore.AUTH_TOKEN in plate().asMap())
        assertFalse(TokenStore.AUTH_TOKEN_ENC in plate().asMap())
        assertEquals("Über den Altbestand wieder angemeldet", "", runBlocking { start().tokenNow() })
    }

    @Test
    fun `an entry that cannot be decrypted counts as no token`() {
        put(secret = "ENC(sinnlos)")
        assertEquals("", runBlocking { start(Fake(broken = true)).tokenNow() })
    }

    /** Strict like the device: encrypts only as long as [locked] says no. */
    private class Strict(val locked: () -> Boolean) : TokenEncryption {
        override fun encrypt(plaintext: String): String {
            check(!locked()) { "Gerät gesperrt" }
            return "S(" + plaintext.reversed() + ")"
        }
        override fun decrypt(saved: String): String? =
            saved.takeIf { it.startsWith("S(") }?.removePrefix("S(")?.removeSuffix(")")?.reversed()
    }

    @Test
    fun `a token under the old key goes under the strict one at start`() {
        put(secret = "ENC(tla)")
        var locked = true
        val vault = UnlockVault(Strict { locked }, Fake())
        runBlocking { start(vault).adoptOldToken() }
        assertEquals("Gesperrt bleibt der Altbestand, wie er ist", "ENC(tla)", plate()[TokenStore.AUTH_TOKEN_ENC])

        locked = false
        val prefs = start(vault)
        runBlocking { prefs.adoptOldToken() }
        val secret = plate()[TokenStore.AUTH_TOKEN_ENC]!!
        assertFalse("Umgeschlüsselt: $secret", vault.stale(secret))
        assertEquals("alt", runBlocking { start(vault).tokenNow() })
    }

    /** Not only at the next start: unlocking (ACTION_USER_PRESENT) levels up right away. */
    @Test
    fun `after unlocking a token under the old key goes under the strict one immediately`() {
        put(secret = "ENC(tla)")
        var locked = true
        val old = Fake()
        val vault = UnlockVault(Strict { locked }, old)
        val prefs = start(vault)
        runBlocking { prefs.levelTokenHigh() }
        assertEquals("Gesperrt bleibt es, wie es ist", "ENC(tla)", plate()[TokenStore.AUTH_TOKEN_ENC])
        assertEquals("Gesperrt bleibt der alte Schlüssel", 0, old.forget)

        locked = false
        runBlocking { prefs.levelTokenHigh() }
        val secret = plate()[TokenStore.AUTH_TOKEN_ENC]!!
        assertFalse("Hochgestuft ohne Neustart: $secret", vault.stale(secret))
        assertEquals("alt", runBlocking { prefs.tokenNow() })
        assertEquals("Der alte Schlüssel ist danach gelöscht", 1, old.forget)
    }
}

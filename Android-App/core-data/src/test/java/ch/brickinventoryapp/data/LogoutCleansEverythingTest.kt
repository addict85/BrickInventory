package ch.brickinventoryapp.data

import android.Manifest
import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import androidx.core.app.NotificationCompat
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.contract.SetItem
import ch.brickinventoryapp.contract.mapping.asView
import ch.brickinventoryapp.data.cache.PreviewMemory
import ch.brickinventoryapp.data.repository.AccountDataDeletion
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.MetricsView
import ch.brickinventoryapp.offline.Editing
import ch.brickinventoryapp.offline.Slots
import ch.brickinventoryapp.security.StoreCipher
import ch.brickinventoryapp.security.StoreKey
import ch.brickinventoryapp.security.TokenEncryption
import ch.brickinventoryapp.session.Session
import ch.brickinventoryapp.state.ui.Logout
import ch.brickinventoryapp.state.ui.LogoutHook
import ch.brickinventoryapp.state.ui.Scope
import ch.brickinventoryapp.testing.StorageStore
import ch.brickinventoryapp.testing.TestApi
import ch.brickinventoryapp.testing.TestStore
import ch.brickinventoryapp.testing.testAccountRepository
import ch.brickinventoryapp.testing.testHouseholdRepository
import ch.brickinventoryapp.testing.testPartsRepository
import ch.brickinventoryapp.testing.testTrustCipher
import coil3.ImageLoader
import coil3.disk.DiskCache
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import okhttp3.Cache
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import okio.Path.Companion.toOkioPath
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.io.File

/**
 * After signing out nothing of the account remains: Abmelden.execute() with the real
 * DevicesCleanup and real stores, each filled before, empty afterwards — and what lay
 * encrypted with the old store key is no longer readable. Here in core-data,
 * because the cleanup is module-internal; a dummy stands in for the widget hook.
 *
 * Counter-checks (Robolectric, measured by CI; job `counter-checks`):
 *   abmelden-laesst-vorschau     vorschau.clearAll() removed → red „… Vorschau“
 *   abmelden-laesst-teileliste   cleanUpAccountFiles removed → red „… Teileliste“
 *   abmelden-laesst-meldungen    cancelAll() removed → red „… Preisalarm-Meldung“
 *   abmelden-ohne-neuen-schluessel  ablage.erneuere() removed → red „… alten Schlüssel“
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class LogoutCleansEverythingTest {

    private val ctx = ApplicationProvider.getApplicationContext<Application>()
    private val area = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val server = MockWebServer().apply {
        dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest) = when (request.path) {
                "/bild.png" -> MockResponse().setHeader("Cache-Control", "max-age=600").setBody("bild")
                else -> MockResponse().setBody("""{"success":true}""")
            }
        }
        start()
    }

    /** Robolectric has no AndroidKeyStore; wrapping here is only for show. */
    private object PlainVault : TokenEncryption {
        override fun encrypt(plaintext: String) = plaintext
        override fun decrypt(saved: String) = saved
    }

    @After
    fun tearDown() {
        area.cancel()
        runCatching { server.shutdown() }
    }

    private fun file(basis: File, path: String) = File(basis, path).apply { parentFile?.mkdirs(); writeText("inhalt") }

    /** Parts list, update APK, instruction, widget numbers and a price alert notification. */
    private fun createFilesAndMessage(): Triple<File, File, File> {
        val files = Triple(file(ctx.filesDir, "pdf/teileliste.bin"), file(ctx.filesDir, "update/BrickInventory.apk"),
            file(ctx.cacheDir, "anleitung_x.bin"))
        ctx.getSharedPreferences("widget", Context.MODE_PRIVATE).edit().putString("zahlen", "geheim").commit()
        shadowOf(ctx).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)
        val nm = ctx.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel("preisalarm", "Preisalarm", NotificationManager.IMPORTANCE_DEFAULT))
        nm.notify(1, NotificationCompat.Builder(ctx, "preisalarm").setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle("10294-1 unter 500 CHF").build())
        return files
    }

    @Test
    fun `after sign-out every store is empty and the old key worthless`() = runBlocking {
        val address = server.url("/").toString().trimEnd('/')
        val store = PreferenceDataStoreFactory.create { File(ctx.filesDir, "abmelden-${System.nanoTime()}.preferences_pb") }
        val device = DevicesStore(ctx, store, testTrustCipher())
        val prefs = TokenStore(store, PlainVault, device, area).also { it.waitOnStart() }
        prefs.saveServerUrl(address)
        prefs.saveAuthToken("token-marco")
        prefs.saveUsername("marco")
        device.setAlarmBrand("2026-11-05T10:00:00Z")

        val storeKey = StoreKey(File(ctx.noBackupFilesDir, "test.key"), PlainVault)
        val secret = StoreCipher { storeKey.forTarget("x") }.encrypt("Sammlung von marco".toByteArray(), "x/1")
        val api = TestApi.forTarget(server)
        val offline = TestStore()
        offline.adopt(Slots.SETS, listOf(SetItem(setNumber = "10294-1")).map { it.asView() })
        offline.adopt(Slots.METRICS, listOf(MetricsView(totalSets = 1, totalQuantity = 1, totalInstructions = 0, totalParts = 0, totalMinifigs = 0)))
        offline.buffer(Editing.DeleteWantedItem("10294-1", Condition.NEW, 1))
        val preview = PreviewMemory({ File(ctx.filesDir, "vorschau") }, StoreCipher { storeKey.forTarget("vorschau") }) { storeKey.forTarget("namen") }
        preview.write("$address/images/sets/10294-1_thumb.jpg", "vorschaubild".toByteArray())
        val imageClient = OkHttpClient.Builder().cache(Cache(File(ctx.cacheDir, "bild-http"), 1_000_000)).build()
        imageClient.newCall(Request.Builder().url("$address/bild.png").build()).execute().close()
        val loader = ImageLoader.Builder(ctx)
            .diskCache { DiskCache.Builder().directory(File(ctx.cacheDir, "coil").toOkioPath()).build() }.build()
        val coil = checkNotNull(loader.diskCache)
        coil.openEditor("bild")!!.apply { coil.fileSystem.write(data) { writeUtf8("bild") }; coil.fileSystem.write(metadata) { writeUtf8("m") } }.commit()
        val (partList, update, instruction) = createFilesAndMessage()
        val messages = shadowOf(ctx.getSystemService(NotificationManager::class.java))
        assertEquals("Vorbedingung: eine Meldung steht da", 1, messages.allNotifications.size)
        assertTrue("Vorbedingung: Bildcache gefüllt", imageClient.cache!!.urls().hasNext())
        assertTrue("Vorbedingung: Vorschau abgelegt", File(ctx.filesDir, "vorschau").walkTopDown().any { it.isFile })
        val session = Session().apply { loggedIn(admin = false) }
        val oldKey = storeKey.fetch().copyOf()

        val cleanup = DevicesCleanup(ctx, prefs, AccountDataDeletion(offline), PasswordRequired(),
            SecondFactorRequired(), imageClient, preview, loader, Dispatchers.IO, storeKey)
        // The real hook (AppModule) clears the widget numbers; it lives in the app.
        val widget = LogoutHook { ctx.getSharedPreferences("widget", Context.MODE_PRIVATE).edit().clear().commit() }
        val logout = Logout(cleanup, widget, session,
            Scope(StorageStore(), testHouseholdRepository(api), testPartsRepository(api)),
            LogoutState(testAccountRepository(api), prefs) { })
        assertEquals(LogoutPath.IMMEDIATE, logout.execute())

        val plate = store.data.first()
        assertEquals("Token", "", prefs.tokenNow())
        assertFalse("Benutzername", listOf(TokenStore.USERNAME, TokenStore.USERNAME_ENC, TokenStore.USERNAME_SECRET)
            .any { it in plate.asMap() })
        assertFalse("Marke des Preisalarms", DevicesStore.ALARM_BRAND in plate.asMap())
        assertNull("Kennzahlen", offline.read(Slots.METRICS)?.list?.takeIf { it.isNotEmpty() })
        assertNull("Bestand", offline.read(Slots.SETS)?.list?.takeIf { it.isNotEmpty() })
        assertFalse("Ausgang", offline.waiting())
        // Looked at on disk: the names hang on the store key, and that is a different one afterwards.
        assertTrue("Vorschau", File(ctx.filesDir, "vorschau").walkTopDown().none { it.isFile })
        assertFalse("HTTP-Bildcache", imageClient.cache!!.urls().hasNext())
        assertNull("Coil-Bildcache", coil.openSnapshot("bild"))
        assertFalse("PartList", partList.exists())
        assertFalse("Update-APK", update.exists())
        assertFalse("Anleitung", instruction.exists())
        assertNull("Widget-Zahlen", ctx.getSharedPreferences("widget", Context.MODE_PRIVATE).getString("zahlen", null))
        assertEquals("Preisalarm-Meldung", 0, messages.allNotifications.size)
        assertNotEquals("Der Ablageschlüssel ist noch der alte", oldKey.toList(), storeKey.fetch().toList())
        assertNull("Mit dem alten Schlüssel verschlüsselte Reste sind lesbar",
            StoreCipher { storeKey.forTarget("x") }.decrypt(secret, "x/1"))
    }
}

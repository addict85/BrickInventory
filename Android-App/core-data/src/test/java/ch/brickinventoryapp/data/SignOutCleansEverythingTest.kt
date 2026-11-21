package ch.brickinventoryapp.data

import ch.brickinventoryapp.model.domain.MetricsView
import ch.brickinventoryapp.contract.mapping.alsAnsicht
import ch.brickinventoryapp.model.domain.Zustand
import ch.brickinventoryapp.testing.testVertrauenschiffre
import android.Manifest
import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import androidx.core.app.NotificationCompat
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.data.cache.VorschauSpeicher
import ch.brickinventoryapp.offline.Slots
import ch.brickinventoryapp.testing.Testablage
import ch.brickinventoryapp.contract.SetItem
import ch.brickinventoryapp.offline.Editing
import ch.brickinventoryapp.data.repository.AccountDataDeletion
import ch.brickinventoryapp.state.ui.Abmeldehaken
import ch.brickinventoryapp.state.ui.Abmelden
import ch.brickinventoryapp.state.ui.Scope
import ch.brickinventoryapp.session.Sitzung
import ch.brickinventoryapp.security.StoreCipher
import ch.brickinventoryapp.security.Ablageschluessel
import ch.brickinventoryapp.security.TokenEncryption
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
import ch.brickinventoryapp.testing.testHouseholdRepository
import ch.brickinventoryapp.testing.testAccountRepository
import ch.brickinventoryapp.testing.StorageStore
import ch.brickinventoryapp.testing.testPartsRepository
import ch.brickinventoryapp.testing.TestApi

/**
 * Nach dem Abmelden bleibt nichts vom Konto: Abmelden.ausfuehren() mit der echten
 * DevicesCleanup und echten Ablagen, jede vorher befüllt, danach leer — und was mit
 * dem alten Ablageschlüssel verschlüsselt lag, ist nicht mehr lesbar. Hier in core-data,
 * weil die Bereinigung modulintern ist; den Widget-Haken vertritt eine Attrappe.
 *
 * Gegenproben (Robolectric, misst die CI; Job `gegenproben`):
 *   abmelden-laesst-vorschau     vorschau.leeren() entfernt → rot „… Vorschau“
 *   abmelden-laesst-teileliste   raeumeKontoDateienAuf entfernt → rot „… Teileliste“
 *   abmelden-laesst-meldungen    cancelAll() entfernt → rot „… Preisalarm-Meldung“
 *   abmelden-ohne-neuen-schluessel  ablage.erneuere() entfernt → rot „… alten Schlüssel“
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class SignOutCleansEverythingTest {

    private val ctx = ApplicationProvider.getApplicationContext<Application>()
    private val bereich = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val server = MockWebServer().apply {
        dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest) = when (request.path) {
                "/bild.png" -> MockResponse().setHeader("Cache-Control", "max-age=600").setBody("bild")
                else -> MockResponse().setBody("""{"success":true}""")
            }
        }
        start()
    }

    /** Robolectric hat keinen AndroidKeyStore; umhüllt wird hier nur zum Schein. */
    private object Klartresor : TokenEncryption {
        override fun verschluessle(klartext: String) = klartext
        override fun entschluessle(gespeichert: String) = gespeichert
    }

    @After
    fun zu() {
        bereich.cancel()
        runCatching { server.shutdown() }
    }

    private fun datei(basis: File, pfad: String) = File(basis, pfad).apply { parentFile?.mkdirs(); writeText("inhalt") }

    /** Teileliste, Update-APK, Anleitung, Widget-Zahlen und eine Preisalarm-Meldung. */
    private fun putFilesAndMessageAn(): Triple<File, File, File> {
        val dateien = Triple(datei(ctx.filesDir, "pdf/teileliste.bin"), datei(ctx.filesDir, "update/BrickInventory.apk"),
            datei(ctx.cacheDir, "anleitung_x.bin"))
        ctx.getSharedPreferences("widget", Context.MODE_PRIVATE).edit().putString("zahlen", "geheim").commit()
        shadowOf(ctx).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)
        val nm = ctx.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel("preisalarm", "Preisalarm", NotificationManager.IMPORTANCE_DEFAULT))
        nm.notify(1, NotificationCompat.Builder(ctx, "preisalarm").setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle("10294-1 unter 500 CHF").build())
        return dateien
    }

    @Test
    fun `after sign-out every store is empty and the old key worthless`() = runBlocking {
        val adresse = server.url("/").toString().trimEnd('/')
        val store = PreferenceDataStoreFactory.create { File(ctx.filesDir, "abmelden-${System.nanoTime()}.preferences_pb") }
        val geraet = DevicesStore(ctx, store, testVertrauenschiffre())
        val prefs = TokenAblage(store, Klartresor, geraet, bereich).also { it.waitOnStart() }
        prefs.saveServerUrl(adresse)
        prefs.saveAuthToken("token-marco")
        prefs.saveUsername("marco")
        geraet.setAlarmBrand("2026-11-05T10:00:00Z")

        val ablage = Ablageschluessel(File(ctx.noBackupFilesDir, "test.schluessel"), Klartresor)
        val geheim = StoreCipher { ablage.fuer("x") }.verschluessle("Sammlung von marco".toByteArray(), "x/1")
        val api = TestApi.fuer(server)
        val offline = Testablage()
        offline.adopt(Slots.SETS, listOf(SetItem(setNumber = "10294-1")).map { it.alsAnsicht() })
        offline.adopt(Slots.KENNZAHLEN, listOf(MetricsView(totalSets = 1, totalQuantity = 1, totalInstructions = 0, totalParts = 0, totalMinifigs = 0)))
        offline.buffer(Editing.MerkpostenLoeschen("10294-1", Zustand.NEU, 1))
        val vorschau = VorschauSpeicher({ File(ctx.filesDir, "vorschau") }, StoreCipher { ablage.fuer("vorschau") }) { ablage.fuer("namen") }
        vorschau.schreibe("$adresse/images/sets/10294-1_thumb.jpg", "vorschaubild".toByteArray())
        val imageClient = OkHttpClient.Builder().cache(Cache(File(ctx.cacheDir, "bild-http"), 1_000_000)).build()
        imageClient.newCall(Request.Builder().url("$adresse/bild.png").build()).execute().close()
        val loader = ImageLoader.Builder(ctx)
            .diskCache { DiskCache.Builder().directory(File(ctx.cacheDir, "coil").toOkioPath()).build() }.build()
        val coil = checkNotNull(loader.diskCache)
        coil.openEditor("bild")!!.apply { coil.fileSystem.write(data) { writeUtf8("bild") }; coil.fileSystem.write(metadata) { writeUtf8("m") } }.commit()
        val (teileliste, update, anleitung) = putFilesAndMessageAn()
        val meldungen = shadowOf(ctx.getSystemService(NotificationManager::class.java))
        assertEquals("Vorbedingung: eine Meldung steht da", 1, meldungen.allNotifications.size)
        assertTrue("Vorbedingung: Bildcache gefüllt", imageClient.cache!!.urls().hasNext())
        assertTrue("Vorbedingung: Vorschau abgelegt", File(ctx.filesDir, "vorschau").walkTopDown().any { it.isFile })
        val sitzung = Sitzung().apply { angemeldet(admin = false) }
        val alterKey = ablage.fetch().copyOf()

        val cleanup = DevicesCleanup(ctx, prefs, AccountDataDeletion(offline), PasswordRequired(),
            SecondFactorRequired(), imageClient, vorschau, loader, Dispatchers.IO, ablage)
        // Der echte Haken (AppModule) leert die Widget-Zahlen; er liegt in der App.
        val widget = Abmeldehaken { ctx.getSharedPreferences("widget", Context.MODE_PRIVATE).edit().clear().commit() }
        val abmelden = Abmelden(cleanup, widget, sitzung,
            Scope(StorageStore(), testHouseholdRepository(api), testPartsRepository(api)),
            Abmeldung(testAccountRepository(api), prefs) { })
        assertEquals(Abmeldeweg.SOFORT, abmelden.ausfuehren())

        val platte = store.data.first()
        assertEquals("Token", "", prefs.tokenJetzt())
        assertFalse("Benutzername", listOf(TokenAblage.USERNAME, TokenAblage.USERNAME_ENC, TokenAblage.USERNAME_SECRET)
            .any { it in platte.asMap() })
        assertFalse("Marke des Preisalarms", DevicesStore.ALARM_BRAND in platte.asMap())
        assertNull("Kennzahlen", offline.lies(Slots.KENNZAHLEN)?.liste?.takeIf { it.isNotEmpty() })
        assertNull("Bestand", offline.lies(Slots.SETS)?.liste?.takeIf { it.isNotEmpty() })
        assertFalse("Ausgang", offline.wartet())
        // Auf die Platte gesehen: Die Namen hängen am Ablageschlüssel, und der ist danach ein anderer.
        assertTrue("Vorschau", File(ctx.filesDir, "vorschau").walkTopDown().none { it.isFile })
        assertFalse("HTTP-Bildcache", imageClient.cache!!.urls().hasNext())
        assertNull("Coil-Bildcache", coil.openSnapshot("bild"))
        assertFalse("Teileliste", teileliste.exists())
        assertFalse("Update-APK", update.exists())
        assertFalse("Anleitung", anleitung.exists())
        assertNull("Widget-Zahlen", ctx.getSharedPreferences("widget", Context.MODE_PRIVATE).getString("zahlen", null))
        assertEquals("Preisalarm-Meldung", 0, meldungen.allNotifications.size)
        assertNotEquals("Der Ablageschlüssel ist noch der alte", alterKey.toList(), ablage.fetch().toList())
        assertNull("Mit dem alten Schlüssel verschlüsselte Reste sind lesbar",
            StoreCipher { ablage.fuer("x") }.entschluessle(geheim, "x/1"))
    }
}

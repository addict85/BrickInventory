package ch.brickinventoryapp.data

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
import ch.brickinventoryapp.data.cache.ResponseCache
import ch.brickinventoryapp.data.lokal.Faecher
import ch.brickinventoryapp.data.lokal.Offlineablage
import ch.brickinventoryapp.model.data.model.SetItem
import ch.brickinventoryapp.data.lokal.Bearbeitung
import ch.brickinventoryapp.data.repository.KontoDatenLoeschung
import ch.brickinventoryapp.testing.ResponseCache
import ch.brickinventoryapp.zustand.ui.Abmeldehaken
import ch.brickinventoryapp.zustand.ui.Abmelden
import ch.brickinventoryapp.zustand.ui.Blickfeld
import ch.brickinventoryapp.zustand.ui.Sitzung
import ch.brickinventoryapp.data.util.AblageChiffre
import ch.brickinventoryapp.data.util.Ablageschluessel
import ch.brickinventoryapp.data.util.TokenVerschluesselung
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
import ch.brickinventoryapp.testing.HaushaltRepository
import ch.brickinventoryapp.testing.KontoRepository
import ch.brickinventoryapp.testing.SpeicherAblage
import ch.brickinventoryapp.testing.TeileRepository
import ch.brickinventoryapp.testing.TestApi

/**
 * Nach dem Abmelden bleibt nichts vom Konto: Abmelden.ausfuehren() mit der echten
 * GeraeteBereinigung und echten Ablagen, jede vorher befüllt, danach leer — und was mit
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
class AbmeldenRaeumtAllesTest {

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
    private object Klartresor : TokenVerschluesselung {
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
    private fun legeDateienUndMeldungAn(): Triple<File, File, File> {
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
    fun `nach dem Abmelden ist jede Ablage leer und der alte Schluessel wertlos`() = runBlocking {
        val adresse = server.url("/").toString().trimEnd('/')
        val store = PreferenceDataStoreFactory.create { File(ctx.filesDir, "abmelden-${System.nanoTime()}.preferences_pb") }
        val geraet = GeraeteAblage(ctx, store, testVertrauenschiffre())
        val prefs = TokenAblage(store, Klartresor, geraet, bereich).also { it.warteAufStart() }
        prefs.saveServerUrl(adresse)
        prefs.saveAuthToken("token-marco")
        prefs.saveUsername("marco")
        geraet.setzeAlarmMarke("2026-11-05T10:00:00Z")

        val ablage = Ablageschluessel(File(ctx.noBackupFilesDir, "test.schluessel"), Klartresor)
        val geheim = AblageChiffre { ablage.fuer("x") }.verschluessle("Sammlung von marco".toByteArray(), "x/1")
        val antwortOrdner = File(ctx.cacheDir, "antworten-test")
        val cache = ResponseCache(chiffre = AblageChiffre { ablage.fuer("antworten") }) { antwortOrdner }
        cache.put("test", "sets", SetItem.serializer(), SetItem(setNumber = "10294-1"))
        val api = TestApi.fuer(server)
        val offline = Offlineablage.fluechtig()
        offline.uebernimm(Faecher.SETS, listOf(SetItem(setNumber = "10294-1")))
        offline.puffere(Bearbeitung.MerkpostenLoeschen("10294-1", "N", 1))
        val vorschau = VorschauSpeicher({ File(ctx.filesDir, "vorschau") }, AblageChiffre { ablage.fuer("vorschau") })
        vorschau.schreibe("$adresse/images/sets/10294-1_thumb.jpg", "vorschaubild".toByteArray())
        val bildClient = OkHttpClient.Builder().cache(Cache(File(ctx.cacheDir, "bild-http"), 1_000_000)).build()
        bildClient.newCall(Request.Builder().url("$adresse/bild.png").build()).execute().close()
        val loader = ImageLoader.Builder(ctx)
            .diskCache { DiskCache.Builder().directory(File(ctx.cacheDir, "coil").toOkioPath()).build() }.build()
        val coil = checkNotNull(loader.diskCache)
        coil.openEditor("bild")!!.apply { coil.fileSystem.write(data) { writeUtf8("bild") }; coil.fileSystem.write(metadata) { writeUtf8("m") } }.commit()
        val (teileliste, update, anleitung) = legeDateienUndMeldungAn()
        val meldungen = shadowOf(ctx.getSystemService(NotificationManager::class.java))
        assertEquals("Vorbedingung: eine Meldung steht da", 1, meldungen.allNotifications.size)
        assertTrue("Vorbedingung: Bildcache gefüllt", bildClient.cache!!.urls().hasNext())
        val sitzung = Sitzung().apply { angemeldet(admin = false) }
        val alterSchluessel = ablage.hole().copyOf()

        val bereinigung = GeraeteBereinigung(ctx, prefs, KontoDatenLoeschung(cache, offline), PasswortPflicht(),
            ZweiterFaktorPflicht(), bildClient, vorschau, loader, Dispatchers.IO, ablage)
        // Der echte Haken (AppModule) leert die Widget-Zahlen; er liegt in der App.
        val widget = Abmeldehaken { ctx.getSharedPreferences("widget", Context.MODE_PRIVATE).edit().clear().commit() }
        val abmelden = Abmelden(bereinigung, widget, sitzung,
            Blickfeld(SpeicherAblage(), HaushaltRepository(api, cache), TeileRepository(api, cache)),
            Abmeldung(KontoRepository(api, cache), prefs) { })
        assertEquals(Abmeldeweg.SOFORT, abmelden.ausfuehren())

        val platte = store.data.first()
        assertEquals("Token", "", prefs.tokenJetzt())
        assertFalse("Benutzername", TokenAblage.USERNAME in platte.asMap())
        assertFalse("Marke des Preisalarms", GeraeteAblage.ALARM_MARKE in platte.asMap())
        assertTrue("Antwort-Cache", antwortOrdner.walkTopDown().none { it.isFile })
        assertNull("Bestand", offline.lies(Faecher.SETS)?.liste?.takeIf { it.isNotEmpty() })
        assertFalse("Ausgang", offline.wartet())
        assertFalse("Vorschau", vorschau.hat("$adresse/images/sets/10294-1_thumb.jpg"))
        assertFalse("HTTP-Bildcache", bildClient.cache!!.urls().hasNext())
        assertNull("Coil-Bildcache", coil.openSnapshot("bild"))
        assertFalse("Teileliste", teileliste.exists())
        assertFalse("Update-APK", update.exists())
        assertFalse("Anleitung", anleitung.exists())
        assertNull("Widget-Zahlen", ctx.getSharedPreferences("widget", Context.MODE_PRIVATE).getString("zahlen", null))
        assertEquals("Preisalarm-Meldung", 0, meldungen.allNotifications.size)
        assertNotEquals("Der Ablageschlüssel ist noch der alte", alterSchluessel.toList(), ablage.hole().toList())
        assertNull("Mit dem alten Schlüssel verschlüsselte Reste sind lesbar",
            AblageChiffre { ablage.fuer("x") }.entschluessle(geheim, "x/1"))
    }
}

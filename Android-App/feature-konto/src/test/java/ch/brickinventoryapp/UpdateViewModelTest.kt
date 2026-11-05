package ch.brickinventoryapp

import ch.brickinventoryapp.data.UpdateLader
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.data.Anmeldestand
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.UpdateUiState
import ch.brickinventoryapp.ui.viewmodel.UpdateViewModel
import ch.brickinventoryapp.util.AppFassung
import ch.brickinventoryapp.util.UPDATE_RELEASE_BASIS
import ch.brickinventoryapp.util.UPDATE_VERSION_URL
import ch.brickinventoryapp.util.UpdateFrische
import ch.brickinventoryapp.util.UpdateGeraet
import ch.brickinventoryapp.util.UpdateStand
import ch.brickinventoryapp.util.UpdateStandAblage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.File
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.MessageDigest
import java.security.Signature
import java.util.Base64

/**
 * Die Selbstaktualisierung ausgeführt: signierte Beschreibung, Download, Prüfsumme,
 * Signatur, Fassung und Installer, mit einem Gerät im Speicher, einem Client ohne
 * Netz und virtueller Zeit.
 *
 * Gegenproben (05.11.2026, gemessen mit kotlinc lokal):
 *   update-angebot-ohne-frische  Angebot mit istNeuer statt anzubietendeFassung →
 *                                rot „eine zurueckgesetzte Beschreibung bietet nichts an“
 *   update-signatur-ungeprueft   die Signaturprüfung nach dem Download entfernt →
 *                                rot „eine fremde Signatur loescht das APK …“
 *   update-zweiter-weg-ungeprueft  starteInstallation() ohne signaturPasst →
 *                                rot „ohne Erlaubnis wartet das APK …“
 *   update-ohne-obergrenze       die Grenze im Download nie erreicht →
 *                                rot „mehr als angekuendigt wird nicht geschrieben“
 *   update-still-mit-fehler      die stille Prüfung meldet Fehler →
 *                                rot „eine unsignierte Beschreibung meldet sich nur auf Knopfdruck“
 *   update-abmelden-behaelt      kein Zurücksetzen beim Abmelden → rot „beim Abmelden verfaellt …“
 */
@OptIn(ExperimentalCoroutinesApi::class)
class UpdateViewModelTest {

    private val takt = StandardTestDispatcher()
    private val ordner = File(System.getProperty("java.io.tmpdir"), "bim-update-${System.nanoTime()}").apply { mkdirs() }
    private val eigen: KeyPair = KeyPairGenerator.getInstance("EC").apply { initialize(256) }.generateKeyPair()
    private val jetzt = System.currentTimeMillis() / 1000
    private val apkAdresse = "$UPDATE_RELEASE_BASIS/BrickInventory.apk"
    private val apk = ByteArray(200_000) { (it % 251).toByte() }

    /** Antwort je Adresse; der Client geht nie ins Netz. */
    private val antworten = mutableMapOf<String, Pair<Int, ByteArray>>()
    private val client = OkHttpClient.Builder().addInterceptor { kette ->
        val (code, rumpf) = antworten[kette.request().url.toString()] ?: (404 to ByteArray(0))
        Response.Builder().request(kette.request()).protocol(Protocol.HTTP_1_1).code(code).message("x")
            .body(rumpf.toResponseBody("application/octet-stream".toMediaType())).build()
    }.build()

    private inner class Geraet : UpdateGeraet {
        var signaturGut = true
        var fassungImApk: Long? = 20
        var erlaubt = true
        val installiert = mutableListOf<File>()
        val datei = File(ordner, "BrickInventory.apk")
        override fun beschreibungsSchluessel() = listOf(eigen.public.encoded)
        override fun eigeneZertifikate() = emptyList<ByteArray>()
        override fun updateDatei() = datei
        override fun signaturPasst(apk: File) = signaturGut
        override fun apkFassung(apk: File) = fassungImApk
        override fun darfInstallieren() = erlaubt
        override fun installiere(apk: File) { installiert += apk }
    }

    private val ablage = object : UpdateStandAblage {
        var stand: UpdateStand? = null
        override suspend fun updateStand() = stand
        override suspend fun merkeUpdateStand(stand: UpdateStand) { this.stand = stand }
    }
    private val token = MutableStateFlow<String?>("token")
    private val geraet = Geraet()
    private lateinit var vm: UpdateViewModel

    private fun hex(b: ByteArray) = MessageDigest.getInstance("SHA-256").digest(b).joinToString("") { "%02x".format(it) }

    /** Wie der Signierjob: Base64 der Beschreibung und ihre ECDSA-Signatur. */
    private fun beschreibung(code: Int = 20, groesse: Long = apk.size.toLong(), sha: String = hex(apk), schluessel: KeyPair = eigen): ByteArray {
        val daten = """{"versionCode":$code,"versionName":"2.$code","apkUrl":"$apkAdresse","apkSize":$groesse,""" +
            """"apkSha256":"$sha","ausgestellt":${jetzt - 60},"gueltigBis":${jetzt + 86_400}}"""
        val signatur = Signature.getInstance("SHA256withECDSA").run {
            initSign(schluessel.private); update(daten.toByteArray()); sign()
        }
        val b64 = Base64.getEncoder()
        return """{"daten":"${b64.encodeToString(daten.toByteArray())}","beschreibungssignatur":"${b64.encodeToString(signatur)}"}"""
            .toByteArray()
    }

    @Before fun auf() {
        Dispatchers.setMain(takt)
        antworten[UPDATE_VERSION_URL] = 200 to beschreibung()
        antworten[apkAdresse] = 200 to apk
        vm = UpdateViewModel(UpdateLader(client, AppFassung("2.10", 10), takt), NummernTexte,
            object : Anmeldestand { override val authTokenState = token }, ablage, geraet, takt)
    }

    @After fun ab() {
        vm.viewModelScope.cancel()
        Dispatchers.resetMain()
        ordner.deleteRecursively()
    }

    private fun zustand(): UpdateUiState = vm.updateState.value

    @Test
    fun `eine signierte, aktuelle Beschreibung bietet die neuere Fassung an`() = runTest(takt) {
        vm.pruefeAufUpdate(still = false)
        advanceUntilIdle()
        assertEquals(20, zustand().neuereFassung?.versionCode)
        assertEquals(UpdateFrische.AKTUELL, zustand().frische)
        assertEquals("Der Stand wird fortgeschrieben", 20, ablage.stand?.hoechsterCode)
        assertNull(zustand().fehler)
    }

    @Test
    fun `eine unsignierte Beschreibung meldet sich nur auf Knopfdruck`() = runTest(takt) {
        val fremd = KeyPairGenerator.getInstance("EC").apply { initialize(256) }.generateKeyPair()
        antworten[UPDATE_VERSION_URL] = 200 to beschreibung(schluessel = fremd)
        vm.pruefeAufUpdate(still = true)
        advanceUntilIdle()
        assertTrue(zustand().geprueft)
        assertNull("Die stille Prüfung hinterlässt keinen Fehler", zustand().fehler)
        assertNull(zustand().neuereFassung)
        vm.pruefeAufUpdate(still = false)
        advanceUntilIdle()
        assertEquals("t${R.string.update_beschreibung_unsigniert}", zustand().fehler)
    }

    @Test
    fun `eine zurueckgesetzte Beschreibung bietet nichts an`() = runTest(takt) {
        ablage.stand = UpdateStand(hoechsterCode = 25, ausgestellt = 0)
        vm.pruefeAufUpdate(still = false)
        advanceUntilIdle()
        assertEquals(UpdateFrische.ZURUECKGESETZT, zustand().frische)
        assertNull("Eine ältere Beschreibung hält nicht auf einer Zwischenfassung fest", zustand().neuereFassung)
    }

    @Test
    fun `ein passendes APK wird nach allen Pruefungen installiert`() = runTest(takt) {
        vm.pruefeAufUpdate(still = false)
        advanceUntilIdle()
        vm.ladeUpdate()
        advanceUntilIdle()
        assertEquals(listOf(geraet.datei), geraet.installiert)
        assertTrue(zustand().bereitZurInstallation)
        assertNull(zustand().fortschritt)
        assertNull(zustand().fehler)
    }

    @Test
    fun `eine fremde Signatur loescht das APK und installiert nicht`() = runTest(takt) {
        // Ohne Erlaubnis endet ladeUpdate() vor dem zweiten Weg: Geprüft hat dann nur der Download.
        geraet.signaturGut = false
        geraet.erlaubt = false
        vm.pruefeAufUpdate(still = false)
        advanceUntilIdle()
        vm.ladeUpdate()
        advanceUntilIdle()
        assertEquals("t${R.string.update_signatur_falsch}", zustand().fehler)
        assertFalse(zustand().bereitZurInstallation)
        assertFalse("Ein APK unbekannter Herkunft bleibt nicht liegen", geraet.datei.exists())
        assertTrue(geraet.installiert.isEmpty())
    }

    @Test
    fun `eine falsche Pruefsumme oder Fassung installiert nicht`() = runTest(takt) {
        antworten[UPDATE_VERSION_URL] = 200 to beschreibung(sha = hex(byteArrayOf(1)))
        vm.pruefeAufUpdate(still = false)
        advanceUntilIdle()
        vm.ladeUpdate()
        advanceUntilIdle()
        assertEquals("t${R.string.update_pruefsumme_falsch}", zustand().fehler)
        antworten[UPDATE_VERSION_URL] = 200 to beschreibung()
        geraet.fassungImApk = 19
        vm.pruefeAufUpdate(still = false)
        advanceUntilIdle()
        vm.ladeUpdate()
        advanceUntilIdle()
        assertEquals("t${R.string.update_fassung_falsch}", zustand().fehler)
        assertFalse(geraet.datei.exists())
        assertTrue(geraet.installiert.isEmpty())
    }

    @Test
    fun `mehr als angekuendigt wird nicht geschrieben`() = runTest(takt) {
        // Angekündigt 10 Bytes; erlaubt ist das plus ein Megabyte, geliefert wird mehr.
        val zuViel = ByteArray(1024 * 1024 + 64 * 1024)
        antworten[apkAdresse] = 200 to zuViel
        antworten[UPDATE_VERSION_URL] = 200 to beschreibung(groesse = 10, sha = hex(zuViel))
        vm.pruefeAufUpdate(still = false)
        advanceUntilIdle()
        vm.ladeUpdate()
        advanceUntilIdle()
        assertEquals("t${R.string.update_laden_fehlgeschlagen}", zustand().fehler)
        assertFalse(geraet.datei.exists())
        assertTrue(geraet.installiert.isEmpty())
    }

    @Test
    fun `ohne Erlaubnis wartet das APK, und der zweite Weg prueft erneut`() = runTest(takt) {
        geraet.erlaubt = false
        vm.pruefeAufUpdate(still = false)
        advanceUntilIdle()
        vm.ladeUpdate()
        advanceUntilIdle()
        assertTrue(zustand().erlaubnisFehlt)
        assertTrue(zustand().bereitZurInstallation)
        assertTrue(geraet.installiert.isEmpty())
        // Während des Ausflugs in die Systemeinstellungen lag die Datei auf der Platte.
        geraet.erlaubt = true
        geraet.signaturGut = false
        vm.starteInstallation()
        advanceUntilIdle()
        assertEquals("t${R.string.update_signatur_falsch}", zustand().fehler)
        assertFalse(geraet.datei.exists())
        assertTrue(geraet.installiert.isEmpty())
    }

    @Test
    fun `beim Abmelden verfaellt der Zustand, Spaeter nur fuer diesen Lauf`() = runTest(takt) {
        vm.pruefeAufUpdate(still = false)
        advanceUntilIdle()
        vm.updateHinweisSchliessen()
        assertTrue(zustand().dialogAbgelehnt)
        assertEquals("Der Befund bleibt, nur die Frage ist weg", 20, zustand().neuereFassung?.versionCode)
        token.value = ""
        advanceUntilIdle()
        assertEquals("beim Abmelden verfaellt der Zustand", UpdateUiState(), zustand())
    }
}

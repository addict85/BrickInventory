package ch.brickinventoryapp.account

import ch.brickinventoryapp.model.ui.laeuft
import ch.brickinventoryapp.update.data.UpdateLoader
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.data.Anmeldestand
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.account.ui.UpdateUiState
import ch.brickinventoryapp.account.ui.viewmodel.UpdateViewModel
import ch.brickinventoryapp.model.util.AppVersion
import ch.brickinventoryapp.update.util.UPDATE_RELEASE_BASE
import ch.brickinventoryapp.update.util.UPDATE_VERSION_URL
import ch.brickinventoryapp.update.util.UpdateFresh
import ch.brickinventoryapp.update.util.UpdateDevice
import ch.brickinventoryapp.update.util.UpdateStatus
import ch.brickinventoryapp.update.util.UpdateStatusStore
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
import ch.brickinventoryapp.model.ui.Meldung

/**
 * Die Selbstaktualisierung ausgeführt: signierte Beschreibung, Download, Prüfsumme,
 * Signatur, Fassung und Installer, mit einem Gerät im Speicher, einem Client ohne
 * Netz und virtueller Zeit.
 *
 * Gegenproben:
 *   update-angebot-ohne-frische  Angebot mit isNew statt offerableVersion →
 *                                rot „eine zurueckgesetzte Beschreibung bietet nichts an“
 *   update-vm-abgelaufen-ohne-angebot  Angebot nur bei AKTUELL → rot „eine abgelaufene,
 *                                neuere Beschreibung bietet die Fassung mit Hinweis an“
 *   update-signatur-ungeprueft   die Signaturprüfung nach dem Download entfernt →
 *                                rot „eine fremde Signatur loescht das APK …“
 *   update-zweiter-weg-ungeprueft  startInstallation() ohne signatureFits →
 *                                rot „ohne Erlaubnis wartet das APK …“
 *   update-ohne-obergrenze       die Grenze im Download nie erreicht →
 *                                rot „mehr als angekuendigt wird nicht geschrieben“
 *   update-still-mit-fehler      die stille Prüfung meldet Fehler →
 *                                rot „eine unsignierte Beschreibung meldet sich nur auf Knopfdruck“
 *   update-start-ohne-schalter   pruefeBeimStart() fragt den Schalter nicht →
 *                                rot „ausgeschaltet fragt der Start nicht bei GitHub“
 *   update-abmelden-behaelt      kein Zurücksetzen beim Abmelden → rot „beim Abmelden verfaellt …“
 *   update-ohne-anmeldefolge     die Prüfung beim Anmelden aus dem init gestrichen →
 *                                rot „die Anmeldung prueft still“
 */
@OptIn(ExperimentalCoroutinesApi::class)
class UpdateViewModelTest {

    private val takt = StandardTestDispatcher()
    private val folder = File(System.getProperty("java.io.tmpdir"), "bim-update-${System.nanoTime()}").apply { mkdirs() }
    private val own: KeyPair = KeyPairGenerator.getInstance("EC").apply { initialize(256) }.generateKeyPair()
    private val jetzt = System.currentTimeMillis() / 1000
    private val apkAddress = "$UPDATE_RELEASE_BASE/BrickInventory.apk"
    private val apk = ByteArray(200_000) { (it % 251).toByte() }

    /** Antwort je Adresse; der Client geht nie ins Netz. */
    private val antworten = mutableMapOf<String, Pair<Int, ByteArray>>()
    /** Jede Anfrage des Update-Clients; ins Netz geht keine. */
    private val angefragt = mutableListOf<String>()
    private val client = OkHttpClient.Builder().addInterceptor { kette ->
        angefragt += kette.request().url.toString()
        val (code, rumpf) = antworten[kette.request().url.toString()] ?: (404 to ByteArray(0))
        Response.Builder().request(kette.request()).protocol(Protocol.HTTP_1_1).code(code).message("x")
            .body(rumpf.toResponseBody("application/octet-stream".toMediaType())).build()
    }.build()

    private inner class Geraet : UpdateDevice {
        var signatureGood = true
        var versionInApk: Long? = 20
        var erlaubt = true
        val installiert = mutableListOf<File>()
        val datei = File(folder, "BrickInventory.apk")
        override fun descriptionKey() = listOf(own.public.encoded)
        override fun updateFile() = datei
        override fun signatureFits(apk: File) = signatureGood
        override fun apkVersion(apk: File) = versionInApk
        override fun installMay() = erlaubt
        override fun install(apk: File) { installiert += apk }
    }

    private val ablage = object : UpdateStatusStore {
        var stand: UpdateStatus? = null
        override suspend fun updateStatus() = stand
        override suspend fun rememberUpdateStatus(stand: UpdateStatus) { this.stand = stand }
        var onStart = true
        override fun startpruefungAn() = onStart
        override fun setStartpruefung(an: Boolean) { onStart = an }
    }
    private val token = MutableStateFlow<String?>("token")
    private val geraet = Geraet()
    private lateinit var vm: UpdateViewModel

    private fun hex(b: ByteArray) = MessageDigest.getInstance("SHA-256").digest(b).joinToString("") { "%02x".format(it) }

    /** Wie der Signierjob: Base64 der Beschreibung und ihre ECDSA-Signatur. */
    private fun beschreibung(
        code: Int = 20, groesse: Long = apk.size.toLong(), sha: String = hex(apk), schluessel: KeyPair = own,
        ausgestellt: Long = jetzt - 60, gueltigBis: Long = jetzt + 86_400,
    ): ByteArray {
        val daten = """{"versionCode":$code,"versionName":"2.$code","apkUrl":"$apkAddress","apkSize":$groesse,""" +
            """"apkSha256":"$sha","ausgestellt":$ausgestellt,"gueltigBis":$gueltigBis}"""
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
        antworten[apkAddress] = 200 to apk
        vm = UpdateViewModel(UpdateLoader(client, AppVersion("2.10", 10), takt),
            object : Anmeldestand { override val authTokenState = token }, ablage, geraet, takt)
    }

    @After fun ab() {
        vm.viewModelScope.cancel()
        Dispatchers.resetMain()
        folder.deleteRecursively()
    }

    private fun zustand(): UpdateUiState = vm.updateState.value

    @Test
    fun `eine signierte, aktuelle Beschreibung bietet die neuere Fassung an`() = runTest(takt) {
        vm.pruefeAufUpdate(still = false)
        advanceUntilIdle()
        assertEquals(20, zustand().newerVersion?.versionCode)
        assertEquals(UpdateFresh.AKTUELL, zustand().frische)
        assertEquals("Der Stand wird fortgeschrieben", 20, ablage.stand?.highestCode)
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
        assertNull(zustand().newerVersion)
        vm.pruefeAufUpdate(still = false)
        advanceUntilIdle()
        assertEquals(Meldung.Resource(R.string.update_beschreibung_unsigniert), zustand().fehler)
    }

    @Test
    fun `eine zurueckgesetzte Beschreibung bietet nichts an`() = runTest(takt) {
        ablage.stand = UpdateStatus(highestCode = 25, ausgestellt = 0)
        vm.pruefeAufUpdate(still = false)
        advanceUntilIdle()
        assertEquals(UpdateFresh.ZURUECKGESETZT, zustand().frische)
        assertNull("Eine ältere Beschreibung hält nicht auf einer Zwischenfassung fest", zustand().newerVersion)
    }

    @Test
    fun `eine abgelaufene, neuere Beschreibung bietet die Fassung mit Hinweis an`() = runTest(takt) {
        antworten[UPDATE_VERSION_URL] = 200 to beschreibung(ausgestellt = jetzt - 8 * 86_400, gueltigBis = jetzt - 86_400)
        vm.pruefeAufUpdate(still = false)
        advanceUntilIdle()
        assertEquals(UpdateFresh.ABGELAUFEN, zustand().frische)
        assertEquals("Sonst bliebe das Gerät auf der alten Fassung", 20, zustand().newerVersion?.versionCode)
        assertNull("Eine abgelaufene setzt keine Messlatte", ablage.stand)
    }

    @Test
    fun `ein passendes APK wird nach allen Pruefungen installiert`() = runTest(takt) {
        vm.pruefeAufUpdate(still = false)
        advanceUntilIdle()
        vm.ladeUpdate()
        advanceUntilIdle()
        assertEquals(listOf(geraet.datei), geraet.installiert)
        assertTrue(zustand().readyToInstallation)
        assertNull(zustand().fortschritt)
        assertNull(zustand().fehler)
    }

    @Test
    fun `eine fremde Signatur loescht das APK und installiert nicht`() = runTest(takt) {
        // Ohne Erlaubnis endet ladeUpdate() vor dem zweiten Weg: Geprüft hat dann nur der Download.
        geraet.signatureGood = false
        geraet.erlaubt = false
        vm.pruefeAufUpdate(still = false)
        advanceUntilIdle()
        vm.ladeUpdate()
        advanceUntilIdle()
        assertEquals(Meldung.Resource(R.string.update_signatur_falsch), zustand().fehler)
        assertFalse(zustand().readyToInstallation)
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
        assertEquals(Meldung.Resource(R.string.update_pruefsumme_falsch), zustand().fehler)
        antworten[UPDATE_VERSION_URL] = 200 to beschreibung()
        geraet.versionInApk = 19
        vm.pruefeAufUpdate(still = false)
        advanceUntilIdle()
        vm.ladeUpdate()
        advanceUntilIdle()
        assertEquals(Meldung.Resource(R.string.update_fassung_falsch), zustand().fehler)
        assertFalse(geraet.datei.exists())
        assertTrue(geraet.installiert.isEmpty())
    }

    @Test
    fun `mehr als angekuendigt wird nicht geschrieben`() = runTest(takt) {
        // Angekündigt 10 Bytes; erlaubt ist das plus ein Megabyte, geliefert wird mehr.
        val toMuch = ByteArray(1024 * 1024 + 64 * 1024)
        antworten[apkAddress] = 200 to toMuch
        antworten[UPDATE_VERSION_URL] = 200 to beschreibung(groesse = 10, sha = hex(toMuch))
        vm.pruefeAufUpdate(still = false)
        advanceUntilIdle()
        vm.ladeUpdate()
        advanceUntilIdle()
        assertEquals(Meldung.Resource(R.string.update_laden_fehlgeschlagen), zustand().fehler)
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
        assertTrue(zustand().permissionAbsent)
        assertTrue(zustand().readyToInstallation)
        assertTrue(geraet.installiert.isEmpty())
        // Während des Ausflugs in die Systemeinstellungen lag die Datei auf der Platte.
        geraet.erlaubt = true
        geraet.signatureGood = false
        vm.startInstallation()
        advanceUntilIdle()
        assertEquals(Meldung.Resource(R.string.update_signatur_falsch), zustand().fehler)
        assertFalse(geraet.datei.exists())
        assertTrue(geraet.installiert.isEmpty())
    }

    @Test
    fun `beim Abmelden verfaellt der Zustand, Spaeter nur fuer diesen Lauf`() = runTest(takt) {
        vm.pruefeAufUpdate(still = false)
        advanceUntilIdle()
        vm.closeUpdateHint()
        assertTrue(zustand().dialogRejected)
        assertEquals("Der Befund bleibt, nur die Frage ist weg", 20, zustand().newerVersion?.versionCode)
        token.value = ""
        advanceUntilIdle()
        assertEquals("beim Abmelden verfaellt der Zustand", UpdateUiState(), zustand())
    }

    @Test
    fun `die Anmeldung prueft still, ohne Anmeldung fragt niemand`() = runTest(takt) {
        val anmeldung = MutableStateFlow<String?>(null)
        val eigenes = UpdateViewModel(UpdateLoader(client, AppVersion("2.10", 10), takt),
            object : Anmeldestand { override val authTokenState = anmeldung }, ablage, geraet, takt)
        try {
            advanceUntilIdle()
            angefragt.clear()
            advanceUntilIdle()
            assertEquals("Abgemeldet fragt niemand bei GitHub", emptyList<String>(), angefragt)
            anmeldung.value = "token"
            advanceUntilIdle()
            assertEquals(listOf(UPDATE_VERSION_URL), angefragt)
            assertEquals("Die Prüfung beim Start ist still", 20, eigenes.updateState.value.newerVersion?.versionCode)
            assertNull(eigenes.updateState.value.fehler)
            assertFalse("kein Ladebalken", eigenes.updateState.value.check.laeuft)
        } finally {
            eigenes.viewModelScope.cancel()
        }
    }

    @Test
    fun `ausgeschaltet fragt der Start nicht bei GitHub, eingeschaltet genau einmal`() = runTest(takt) {
        // Das vm aus auf() ist angemeldet und prüft im init, solange der Schalter noch an
        // ist; diese Prüfung erst ablaufen lassen, sonst zählt sie hier mit.
        advanceUntilIdle()
        angefragt.clear()
        vm.setStartpruefung(false)
        assertFalse("Der Schalter steht im Zustand", vm.updateState.value.startpruefung)
        vm.pruefeBeimStart()
        advanceUntilIdle()
        assertEquals("Ausgeschaltet ging eine Anfrage hinaus", emptyList<String>(), angefragt)
        vm.setStartpruefung(true)
        vm.pruefeBeimStart()
        advanceUntilIdle()
        assertEquals(listOf(UPDATE_VERSION_URL), angefragt)
    }
}

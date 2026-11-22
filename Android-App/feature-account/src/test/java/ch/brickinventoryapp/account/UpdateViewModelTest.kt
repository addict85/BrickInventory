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
 * The self-update run: signed description, download, checksum,
 * signature, version and installer, with a device held in memory, a client with no
 * network and virtual time.
 *
 * Counter-checks:
 *   update-angebot-ohne-frische  offer with isNew instead of offerableVersion →
 *                                red "a reset description offers nothing"
 *   update-vm-abgelaufen-ohne-angebot  offer only on AKTUELL → red "eine abgelaufene,
 *                                neuere Beschreibung bietet die Fassung mit Hinweis an"
 *   update-signatur-ungeprueft   the signature check after the download removed →
 *                                red "eine fremde Signatur loescht das APK …"
 *   update-zweiter-weg-ungeprueft  startInstallation() without signatureFits →
 *                                red "ohne Erlaubnis wartet das APK …"
 *   update-ohne-obergrenze       the limit never reached in the download →
 *                                red "more than announced is not written"
 *   update-still-mit-fehler      the silent check reports errors →
 *                                red "an unsigned description reports only on button press"
 *   update-start-ohne-schalter   pruefeBeimStart() doesn't ask the switch →
 *                                red "ausgeschaltet fragt der Start nicht bei GitHub"
 *   update-abmelden-behaelt      no reset on sign-out → red "beim Abmelden verfaellt …"
 *   update-ohne-anmeldefolge     the check on sign-in removed from init →
 *                                red "die Anmeldung prueft still"
 */
@OptIn(ExperimentalCoroutinesApi::class)
class UpdateViewModelTest {

    private val takt = StandardTestDispatcher()
    private val folder = File(System.getProperty("java.io.tmpdir"), "bim-update-${System.nanoTime()}").apply { mkdirs() }
    private val own: KeyPair = KeyPairGenerator.getInstance("EC").apply { initialize(256) }.generateKeyPair()
    private val jetzt = System.currentTimeMillis() / 1000
    private val apkAddress = "$UPDATE_RELEASE_BASE/BrickInventory.apk"
    private val apk = ByteArray(200_000) { (it % 251).toByte() }

    /** Response per address; the client never goes onto the network. */
    private val antworten = mutableMapOf<String, Pair<Int, ByteArray>>()
    /** Every request of the update client; none goes onto the network. */
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

    /** Like the signing job: base64 of the description and its ECDSA signature. */
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
    fun `a signed, current description offers the newer version`() = runTest(takt) {
        vm.pruefeAufUpdate(still = false)
        advanceUntilIdle()
        assertEquals(20, zustand().newerVersion?.versionCode)
        assertEquals(UpdateFresh.AKTUELL, zustand().frische)
        assertEquals("Der Stand wird fortgeschrieben", 20, ablage.stand?.highestCode)
        assertNull(zustand().fehler)
    }

    @Test
    fun `an unsigned description reports only on button press`() = runTest(takt) {
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
    fun `a reset description offers nothing`() = runTest(takt) {
        ablage.stand = UpdateStatus(highestCode = 25, ausgestellt = 0)
        vm.pruefeAufUpdate(still = false)
        advanceUntilIdle()
        assertEquals(UpdateFresh.ZURUECKGESETZT, zustand().frische)
        assertNull("Eine ältere Beschreibung hält nicht auf einer Zwischenfassung fest", zustand().newerVersion)
    }

    @Test
    fun `an expired, newer description offers the version with a hint`() = runTest(takt) {
        antworten[UPDATE_VERSION_URL] = 200 to beschreibung(ausgestellt = jetzt - 8 * 86_400, gueltigBis = jetzt - 86_400)
        vm.pruefeAufUpdate(still = false)
        advanceUntilIdle()
        assertEquals(UpdateFresh.ABGELAUFEN, zustand().frische)
        assertEquals("Sonst bliebe das Gerät auf der alten Fassung", 20, zustand().newerVersion?.versionCode)
        assertNull("Eine abgelaufene setzt keine Messlatte", ablage.stand)
    }

    @Test
    fun `a matching APK is installed after all checks`() = runTest(takt) {
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
    fun `a foreign signature deletes the APK and does not install`() = runTest(takt) {
        // Without permission, ladeUpdate() ends before the second path: only the download has been checked then.
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
    fun `a wrong checksum or version does not install`() = runTest(takt) {
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
    fun `more than announced is not written`() = runTest(takt) {
        // Announced 10 bytes; allowed is that plus one megabyte, more is delivered.
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
    fun `without permission the APK waits, and the second path checks again`() = runTest(takt) {
        geraet.erlaubt = false
        vm.pruefeAufUpdate(still = false)
        advanceUntilIdle()
        vm.ladeUpdate()
        advanceUntilIdle()
        assertTrue(zustand().permissionAbsent)
        assertTrue(zustand().readyToInstallation)
        assertTrue(geraet.installiert.isEmpty())
        // The file sat on disk during the detour into the system settings.
        geraet.erlaubt = true
        geraet.signatureGood = false
        vm.startInstallation()
        advanceUntilIdle()
        assertEquals(Meldung.Resource(R.string.update_signatur_falsch), zustand().fehler)
        assertFalse(geraet.datei.exists())
        assertTrue(geraet.installiert.isEmpty())
    }

    @Test
    fun `on sign-out the state expires, Later only for this run`() = runTest(takt) {
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
    fun `the sign-in checks silently, without sign-in nobody asks`() = runTest(takt) {
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
    fun `switched off the start does not ask GitHub, switched on exactly once`() = runTest(takt) {
        // The vm from auf() is signed in and checks in init as long as the switch is still
        // on; let that check expire first, otherwise it counts here too.
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

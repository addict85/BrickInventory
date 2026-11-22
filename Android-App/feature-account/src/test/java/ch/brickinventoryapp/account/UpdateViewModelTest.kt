package ch.brickinventoryapp.account

import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.account.ui.UpdateUiState
import ch.brickinventoryapp.account.ui.viewmodel.UpdateViewModel
import ch.brickinventoryapp.data.LoginState
import ch.brickinventoryapp.model.ui.Message
import ch.brickinventoryapp.model.ui.running
import ch.brickinventoryapp.model.util.AppVersion
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.update.data.UpdateLoader
import ch.brickinventoryapp.update.util.UPDATE_RELEASE_BASE
import ch.brickinventoryapp.update.util.UPDATE_VERSION_URL
import ch.brickinventoryapp.update.util.UpdateDevice
import ch.brickinventoryapp.update.util.UpdateFresh
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

/**
 * The self-update run: signed description, download, checksum,
 * signature, version and installer, with a device held in memory, a client with no
 * network and virtual time.
 *
 * Counter-checks:
 *   update-offer-without-freshness  offer with isNew instead of offerableVersion →
 *                                red "a reset description offers nothing"
 *   update-vm-expired-without-offer  offer only on AKTUELL → red "eine abgelaufene, neuere Beschreibung bietet die Fassung mit Hinweis an"
 *   update-signature-unchecked   the signature check after the download removed →
 *                                red "eine fremde Signatur loescht das APK …"
 *   update-second-path-unchecked  startInstallation() without signatureFits →
 *                                red "ohne Erlaubnis wartet das APK …"
 *   update-without-upper-limit       the limit never reached in the download →
 *                                red "more than announced is not written"
 *   update-silent-on-error      the silent check reports errors →
 *                                red "an unsigned description reports only on button press"
 *   update-start-without-switch   checkOnStart() doesn't ask the switch →
 *                                red "ausgeschaltet fragt der Start nicht bei GitHub"
 *   update-logout-keeps      no reset on sign-out → red "beim Abmelden verfaellt …"
 *   update-without-login-sequence     the check on sign-in removed from init →
 *                                red "die Anmeldung prueft still"
 */
@OptIn(ExperimentalCoroutinesApi::class)
class UpdateViewModelTest {

    private val tick = StandardTestDispatcher()
    private val folder = File(System.getProperty("java.io.tmpdir"), "bim-update-${System.nanoTime()}").apply { mkdirs() }
    private val own: KeyPair = KeyPairGenerator.getInstance("EC").apply { initialize(256) }.generateKeyPair()
    private val now = System.currentTimeMillis() / 1000
    private val apkAddress = "$UPDATE_RELEASE_BASE/BrickInventory.apk"
    private val apk = ByteArray(200_000) { (it % 251).toByte() }

    /** Response per address; the client never goes onto the network. */
    private val responses = mutableMapOf<String, Pair<Int, ByteArray>>()
    /** Every request of the update client; none goes onto the network. */
    private val requested = mutableListOf<String>()
    private val client = OkHttpClient.Builder().addInterceptor { chain ->
        requested += chain.request().url.toString()
        val (code, body) = responses[chain.request().url.toString()] ?: (404 to ByteArray(0))
        Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(code).message("x")
            .body(body.toResponseBody("application/octet-stream".toMediaType())).build()
    }.build()

    private inner class Device : UpdateDevice {
        var signatureGood = true
        var versionInApk: Long? = 20
        var allowed = true
        val installed = mutableListOf<File>()
        val file = File(folder, "BrickInventory.apk")
        override fun descriptionKey() = listOf(own.public.encoded)
        override fun updateFile() = file
        override fun signatureFits(apk: File) = signatureGood
        override fun apkVersion(apk: File) = versionInApk
        override fun installMay() = allowed
        override fun install(apk: File) { installed += apk }
    }

    private val store = object : UpdateStatusStore {
        var state: UpdateStatus? = null
        override suspend fun updateStatus() = state
        override suspend fun rememberUpdateStatus(state: UpdateStatus) { this.state = state }
        var onStart = true
        override fun startCheckEnabled() = onStart
        override fun setStartCheck(an: Boolean) { onStart = an }
    }
    private val token = MutableStateFlow<String?>("token")
    private val device = Device()
    private lateinit var vm: UpdateViewModel

    private fun hex(b: ByteArray) = MessageDigest.getInstance("SHA-256").digest(b).joinToString("") { "%02x".format(it) }

    /** Like the signing job: base64 of the description and its ECDSA signature. */
    private fun description(
        code: Int = 20, size: Long = apk.size.toLong(), sha: String = hex(apk), key: KeyPair = own,
        issued: Long = now - 60, validUntil: Long = now + 86_400,
    ): ByteArray {
        val data = """{"versionCode":$code,"versionName":"2.$code","apkUrl":"$apkAddress","apkSize":$size,""" +
            """"apkSha256":"$sha","ausgestellt":$issued,"gueltigBis":$validUntil}"""
        val signature = Signature.getInstance("SHA256withECDSA").run {
            initSign(key.private); update(data.toByteArray()); sign()
        }
        val b64 = Base64.getEncoder()
        return """{"daten":"${b64.encodeToString(data.toByteArray())}","beschreibungssignatur":"${b64.encodeToString(signature)}"}"""
            .toByteArray()
    }

    @Before fun setUp() {
        Dispatchers.setMain(tick)
        responses[UPDATE_VERSION_URL] = 200 to description()
        responses[apkAddress] = 200 to apk
        vm = UpdateViewModel(UpdateLoader(client, AppVersion("2.10", 10), tick),
            object : LoginState { override val authTokenState = token }, store, device, tick)
    }

    @After fun ab() {
        vm.viewModelScope.cancel()
        Dispatchers.resetMain()
        folder.deleteRecursively()
    }

    private fun condition(): UpdateUiState = vm.updateState.value

    @Test
    fun `a signed, current description offers the newer version`() = runTest(tick) {
        vm.checkOnUpdate(still = false)
        advanceUntilIdle()
        assertEquals(20, condition().newerVersion?.versionCode)
        assertEquals(UpdateFresh.CURRENT, condition().freshness)
        assertEquals("the status is carried forward", 20, store.state?.highestCode)
        assertNull(condition().error)
    }

    @Test
    fun `an unsigned description reports only on button press`() = runTest(tick) {
        val foreign = KeyPairGenerator.getInstance("EC").apply { initialize(256) }.generateKeyPair()
        responses[UPDATE_VERSION_URL] = 200 to description(key = foreign)
        vm.checkOnUpdate(still = true)
        advanceUntilIdle()
        assertTrue(condition().checked)
        assertNull("the silent check leaves no error behind", condition().error)
        assertNull(condition().newerVersion)
        vm.checkOnUpdate(still = false)
        advanceUntilIdle()
        assertEquals(Message.Resource(R.string.update_description_unsigned), condition().error)
    }

    @Test
    fun `a reset description offers nothing`() = runTest(tick) {
        store.state = UpdateStatus(highestCode = 25, issued = 0)
        vm.checkOnUpdate(still = false)
        advanceUntilIdle()
        assertEquals(UpdateFresh.RESET, condition().freshness)
        assertNull("an older description does not hold on to an intermediate version", condition().newerVersion)
    }

    @Test
    fun `an expired, newer description offers the version with a hint`() = runTest(tick) {
        responses[UPDATE_VERSION_URL] = 200 to description(issued = now - 8 * 86_400, validUntil = now - 86_400)
        vm.checkOnUpdate(still = false)
        advanceUntilIdle()
        assertEquals(UpdateFresh.EXPIRED, condition().freshness)
        assertEquals("otherwise the device would stay on the old version", 20, condition().newerVersion?.versionCode)
        assertNull("an expired one sets no bar", store.state)
    }

    @Test
    fun `a matching APK is installed after all checks`() = runTest(tick) {
        vm.checkOnUpdate(still = false)
        advanceUntilIdle()
        vm.loadUpdate()
        advanceUntilIdle()
        assertEquals(listOf(device.file), device.installed)
        assertTrue(condition().readyToInstallation)
        assertNull(condition().progress)
        assertNull(condition().error)
    }

    @Test
    fun `a foreign signature deletes the APK and does not install`() = runTest(tick) {
        // Without permission, loadUpdate() ends before the second path: only the download has been checked then.
        device.signatureGood = false
        device.allowed = false
        vm.checkOnUpdate(still = false)
        advanceUntilIdle()
        vm.loadUpdate()
        advanceUntilIdle()
        assertEquals(Message.Resource(R.string.update_signature_wrong), condition().error)
        assertFalse(condition().readyToInstallation)
        assertFalse("an APK of unknown origin does not stay around", device.file.exists())
        assertTrue(device.installed.isEmpty())
    }

    @Test
    fun `a wrong checksum or version does not install`() = runTest(tick) {
        responses[UPDATE_VERSION_URL] = 200 to description(sha = hex(byteArrayOf(1)))
        vm.checkOnUpdate(still = false)
        advanceUntilIdle()
        vm.loadUpdate()
        advanceUntilIdle()
        assertEquals(Message.Resource(R.string.update_checksum_wrong), condition().error)
        responses[UPDATE_VERSION_URL] = 200 to description()
        device.versionInApk = 19
        vm.checkOnUpdate(still = false)
        advanceUntilIdle()
        vm.loadUpdate()
        advanceUntilIdle()
        assertEquals(Message.Resource(R.string.update_version_wrong), condition().error)
        assertFalse(device.file.exists())
        assertTrue(device.installed.isEmpty())
    }

    @Test
    fun `more than announced is not written`() = runTest(tick) {
        // Announced 10 bytes; allowed is that plus one megabyte, more is delivered.
        val toMuch = ByteArray(1024 * 1024 + 64 * 1024)
        responses[apkAddress] = 200 to toMuch
        responses[UPDATE_VERSION_URL] = 200 to description(size = 10, sha = hex(toMuch))
        vm.checkOnUpdate(still = false)
        advanceUntilIdle()
        vm.loadUpdate()
        advanceUntilIdle()
        assertEquals(Message.Resource(R.string.update_load_failed), condition().error)
        assertFalse(device.file.exists())
        assertTrue(device.installed.isEmpty())
    }

    @Test
    fun `without permission the APK waits, and the second path checks again`() = runTest(tick) {
        device.allowed = false
        vm.checkOnUpdate(still = false)
        advanceUntilIdle()
        vm.loadUpdate()
        advanceUntilIdle()
        assertTrue(condition().permissionAbsent)
        assertTrue(condition().readyToInstallation)
        assertTrue(device.installed.isEmpty())
        // The file sat on disk during the detour into the system settings.
        device.allowed = true
        device.signatureGood = false
        vm.startInstallation()
        advanceUntilIdle()
        assertEquals(Message.Resource(R.string.update_signature_wrong), condition().error)
        assertFalse(device.file.exists())
        assertTrue(device.installed.isEmpty())
    }

    @Test
    fun `on sign-out the state expires, Later only for this run`() = runTest(tick) {
        vm.checkOnUpdate(still = false)
        advanceUntilIdle()
        vm.closeUpdateHint()
        assertTrue(condition().dialogRejected)
        assertEquals("the finding stays, only the question is gone", 20, condition().newerVersion?.versionCode)
        token.value = ""
        advanceUntilIdle()
        assertEquals("on sign-out the state expires", UpdateUiState(), condition())
    }

    @Test
    fun `the sign-in checks silently, without sign-in nobody asks`() = runTest(tick) {
        val login = MutableStateFlow<String?>(null)
        val own = UpdateViewModel(UpdateLoader(client, AppVersion("2.10", 10), tick),
            object : LoginState { override val authTokenState = login }, store, device, tick)
        try {
            advanceUntilIdle()
            requested.clear()
            advanceUntilIdle()
            assertEquals("signed out, nobody asks GitHub", emptyList<String>(), requested)
            login.value = "token"
            advanceUntilIdle()
            assertEquals(listOf(UPDATE_VERSION_URL), requested)
            assertEquals("the check at start is silent", 20, own.updateState.value.newerVersion?.versionCode)
            assertNull(own.updateState.value.error)
            assertFalse("no loading bar", own.updateState.value.check.running)
        } finally {
            own.viewModelScope.cancel()
        }
    }

    @Test
    fun `switched off the start does not ask GitHub, switched on exactly once`() = runTest(tick) {
        // The vm from setUp() is signed in and checks in init as long as the switch is still
        // on; let that check expire first, otherwise it counts here too.
        advanceUntilIdle()
        requested.clear()
        vm.setStartCheck(false)
        assertFalse("the switch stands in the state", vm.updateState.value.startCheck)
        vm.checkOnStart()
        advanceUntilIdle()
        assertEquals("switched off, a request went out", emptyList<String>(), requested)
        vm.setStartCheck(true)
        vm.checkOnStart()
        advanceUntilIdle()
        assertEquals(listOf(UPDATE_VERSION_URL), requested)
    }
}

package ch.brickinventoryapp.account

import ch.brickinventoryapp.account.ui.viewmodel.AccountViewModel
import ch.brickinventoryapp.data.testing.RowsServer
import ch.brickinventoryapp.data.testing.TestApi
import ch.brickinventoryapp.data.testing.testAccountRepository
import ch.brickinventoryapp.data.testing.text
import ch.brickinventoryapp.dataapi.message.MessageChannel
import ch.brickinventoryapp.model.text.Message
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.session.testing.SessionFake
import ch.brickinventoryapp.session.testing.testSession
import ch.brickinventoryapp.uistate.errorMessage
import ch.brickinventoryapp.uistate.loading
import ch.brickinventoryapp.uistate.running
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestCoroutineScheduler
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.File
import java.time.Instant

/**
 * The account ViewModel, run against a test server.
 *
 * Counter-checks:
 *  - The check `list.none { it.current }` removed from redeemQuestion():
 *    "without a recognized own device, nothing is revoked" red — the
 *    confirmation went ahead.
 *  - Patch counter-checks/devices-question-stays-after-refusal.patch (prompt cleared only on
 *    success): "a refused sign-out closes the question …" red. Patch
 *    counter-checks/devices-end-others-with-password.patch: "other devices go in one request …" red.
 *  - The call `sessionService.logout()` removed from changePassword(): "nach dem Passwortwechsel wird abgemeldet" red.
 *  - In secondFactor() `successText` no longer reported: "der bestätigte zweite Faktor zeigt die Codes" red on the message.
 *  - In asDevice() `.minOrNull()` → `.maxOrNull()`: "die Geräteliste zeigt Vollzugriff und die frühere Frist" red (2027 instead of 2026);
 *    `accesses` ignored when counting: "ein schon entwertetes Gerät zählt nicht" red.
 *  - In declined() `codeNeeded` not set: "without a code the second factor requires the code field …" red; in changePassword()
 *    the code not passed to changePassword(): same check red (no
 *    "code" in the body).
 *  - In setUpSecondFactorOne() `d.otpauth` taken unchecked:
 *    "a foreign address instead of otpauth is not opened" red.
 *  - Patch counter-checks/profile-save-returns-early.patch (saveProfile() stops before the
 *    request, as it did without a password): "the profile is saved without password or code" red.
 *  - Patch counter-checks/second-factor-off-with-password.patch: "new codes and turning off
 *    need neither password nor code" red.
 *  - Patch counter-checks/profile-mail-not-sent-silent.patch (`emailSent` not
 *    evaluated): "eine neue E-Mail ohne gesendete Mail …" red. Patch
 *    counter-checks/profile-reload-clears-error.patch (fetchProfile() clears the
 *    error with withoutError()): same check red on "übersteht das Neuladen".
 *  - Patch counter-checks/account-does-not-load-on-observe.patch (observeLoadOn for
 *    devices and second factor removed): "Geräte und zweiter Faktor laden, sobald …" red.
 *  - Patch counter-checks/account-page-does-not-load.patch (observeLoadOn of the account page
 *    removed): "Profil und Design laden mit der Kontoseite …" red.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class AccountViewModelTest {

    private val clock = TestCoroutineScheduler()
    private val tick = UnconfinedTestDispatcher(clock)
    private lateinit var server: RowsServer
    private lateinit var cacheDir: File
    private lateinit var channel: MessageChannel
    private lateinit var vm: AccountViewModel

    @Volatile private var loggedOut = false

    private fun response(body: String, code: Int = 200) = TestApi.response(body, code)

    /** On the turn, a state is there once the pending steps have run, or never. */
    private fun until(was: String, condition: () -> Boolean) {
        clock.runCurrent()
        assertTrue(was, condition())
    }

    @Before
    fun setUp() {
        Dispatchers.setMain(tick)
        server = RowsServer()
        cacheDir = File(System.getProperty("java.io.tmpdir"), "bim-konto-${System.nanoTime()}")
        cacheDir.mkdirs()
        channel = MessageChannel()
        vm = AccountViewModel(testAccountRepository(server.api, tick), channel,
                            testSession(), SessionFake { loggedOut = true })
    }

    @After
    fun tearDown() {
        server.shutdown()
        server.checkReadIn()
        cacheDir.deleteRecursively()
        Dispatchers.resetMain()
    }

    @Test
    fun `devices and second factor load as soon as someone observes their state`() {
        clock.runCurrent()
        assertEquals("no fetch without an observer", 0, server.requestCount)
        server.enqueue(response(devices(currentAlong = true)))
        val devicesPage = CoroutineScope(tick).launch { vm.devicesState.collect {} }
        until("devices") { vm.devicesState.value.devices.size == 3 && !vm.devicesState.value.fetch.loading }
        server.enqueue(response("""{"success":true,"active":true,"codes_left":8}"""))
        val factorPage = CoroutineScope(tick).launch { vm.secondFactorState.collect {} }
        until("second factor") { vm.secondFactorState.value.active == true && vm.secondFactorState.value.codesRemaining == 8 }
        devicesPage.cancel()
        factorPage.cancel()
        assertEquals(2, server.requestCount)
    }

    @Test
    fun `profile and design load with the account page, not with the start password form`() {
        val mask = CoroutineScope(tick).launch { vm.accountState.collect {} }
        clock.runCurrent()
        assertEquals("the mask loads nothing", 0, server.requestCount)
        server.enqueue(response("""{"success":false,"error":"aus"}""", 500))
        server.enqueue(response("""{"success":false,"error":"aus"}""", 500))
        val page = CoroutineScope(tick).launch { vm.accountPage.collect {} }
        until("profile and design fetched") { server.requestCount == 2 }
        mask.cancel()
        page.cancel()
    }

    private fun devices(currentAlong: Boolean) = """{"success":true,"tokens":[
        {"token_id":"a1","label":"Telefon","current":$currentAlong},
        {"token_id":"b2","label":"Tablet"},
        {"token_id":"c3","label":"Alt"}]}"""

    @Test
    fun `other devices go in one request after the question, the own one stays`() {
        server.enqueue(response(devices(currentAlong = true)))
        vm.loadDevices()
        until("list") { vm.devicesState.value.devices.size == 3 && !vm.devicesState.value.fetch.loading }
        server.takeRequest()

        vm.redeemQuestion(null)
        until("confirmation") { vm.devicesState.value.prompt?.tokenId == null && vm.devicesState.value.prompt != null }
        assertEquals("no request before the question is answered", 1, server.requestCount)
        server.enqueue(response("""{"success":true,"deleted":0,"accesses":2}"""))
        server.enqueue(response(devices(currentAlong = true)))
        vm.redeemConfirm()
        until("reloaded") { server.requestCount == 3 && !vm.devicesState.value.fetch.loading }

        val r = server.takeRequest()
        assertTrue(r.path.orEmpty(), r.path.orEmpty().endsWith("/settings/sessions/end-others"))
        val body = JSONObject(r.body.readUtf8())
        assertTrue("$body", body.getBoolean("accesses") && body.isNull("password") && body.isNull("code"))
        assertNull(vm.devicesState.value.prompt)
        assertEquals("m${R.plurals.tokens_revoked_n}:2", channel.text)
    }

    @Test
    fun `a foreign device is signed out after the question, without password or code`() {
        server.enqueue(response(devices(currentAlong = true)))
        vm.loadDevices()
        until("list") { vm.devicesState.value.devices.size == 3 && !vm.devicesState.value.fetch.loading }
        server.takeRequest()

        vm.redeemQuestion("b2")
        assertEquals("b2", vm.devicesState.value.prompt?.tokenId)
        server.enqueue(response("""{"success":true,"deleted":1}"""))
        server.enqueue(response(devices(currentAlong = true)))
        vm.redeemConfirm()
        until("done") { server.requestCount == 3 && vm.devicesState.value.prompt == null }
        val r = server.takeRequest()
        assertEquals("DELETE", r.method)
        assertTrue(r.path.orEmpty(), r.path.orEmpty().endsWith("/settings/tokens/b2"))
        val body = JSONObject(r.body.readUtf8())
        assertTrue("$body", body.isNull("password") && body.isNull("code"))
        assertEquals("t${R.string.tokens_revoked}", channel.text)
    }

    @Test
    fun `a refused sign-out closes the question and reports the reason`() {
        server.enqueue(response(devices(currentAlong = true)))
        vm.loadDevices()
        until("list") { vm.devicesState.value.devices.size == 3 && !vm.devicesState.value.fetch.loading }
        vm.redeemQuestion("b2")
        server.enqueue(response("""{"success":false,"error":"Gerät gesperrt"}""", 400))
        vm.redeemConfirm()
        until("refusal") { channel.text != null }
        assertNull("no question left that cannot be answered", vm.devicesState.value.prompt)
        assertEquals("Gerät gesperrt", channel.text)
        assertEquals("the list stays", 3, vm.devicesState.value.devices.size)
    }

    @Test
    fun `the device list shows full access and the earlier deadline`() {
        server.enqueue(response("""{"success":true,"tokens":[
            {"token_prefix":"abcd1234","token_id":"abcd1234abcd1234","label":"Rechner","created_at":"2026-01-01T00:00:00Z",
             "last_used":null,"expires_at":"2027-03-01T00:00:00Z","hard_expires_at":"2026-12-01T00:00:00Z",
             "never_expires":false,"scope":"voll","ip_range":"192.168.1.0/24","rotated_at":"2026-09-01T00:00:00Z","current":false},
            {"token_prefix":"ffff0000","token_id":"ffff0000ffff0000","label":"","created_at":"2026-01-01T00:00:00Z",
             "last_used":null,"expires_at":null,"hard_expires_at":null,"never_expires":true,"scope":"app",
             "ip_range":null,"rotated_at":"2026-10-01T00:00:00Z","current":true}]}"""))
        vm.loadDevices()
        until("list") { vm.devicesState.value.devices.size == 2 }
        val (full, own) = vm.devicesState.value.devices
        assertTrue(full.fullAccess)
        assertEquals(Instant.parse("2026-12-01T00:00:00Z"), full.expiresAt)
        assertEquals("192.168.1.0/24", full.ipArea)
        assertFalse(own.fullAccess)
        assertEquals("unbegrenzt", null, own.expiresAt)
        assertEquals("—", own.name)
    }

    @Test
    fun `an already invalidated device does not count`() {
        server.enqueue(response(devices(currentAlong = true)))
        vm.loadDevices()
        until("list") { vm.devicesState.value.devices.size == 3 && !vm.devicesState.value.fetch.loading }
        vm.redeemQuestion(null)
        server.enqueue(response("""{"success":true,"deleted":1,"accesses":0}"""))
        server.enqueue(response(devices(currentAlong = true)))
        vm.redeemConfirm()
        until("reloaded") { server.requestCount == 3 && !vm.devicesState.value.fetch.loading }
        assertEquals("m${R.plurals.tokens_revoked_n}:0", channel.text)
    }

    @Test
    fun `without a recognized own device nothing is invalidated`() {
        server.enqueue(response(devices(currentAlong = false)))
        vm.loadDevices()
        until("list") { vm.devicesState.value.devices.size == 3 && !vm.devicesState.value.fetch.loading }

        vm.redeemQuestion(null)
        until("error") { vm.devicesState.value.fetch.errorMessage != null }
        assertEquals("t${R.string.tokens_self_unknown}", vm.devicesState.value.fetch.errorMessage.text)
        assertNull(vm.devicesState.value.prompt)
        assertEquals(1, server.requestCount)
    }

    @Test
    fun `after the password change it signs out`() {
        server.enqueue(response("""{"success":true}"""))
        vm.changePassword("alt", "neuNeuNeu123!")
        until("message") { channel.text != null }

        assertTrue(loggedOut)
        assertEquals("t${R.string.account_password_changed}", channel.text)
        assertFalse(vm.accountState.value.save.running)
    }

    @Test
    fun `a rejected password change does not report to sign out`() {
        server.enqueue(response("""{"success":false,"error":"Aktuelles Passwort falsch","code":"passwort_falsch"}""", 400))
        vm.changePassword("falsch", "neuNeuNeu123!")
        until("error") { vm.accountState.value.save.errorMessage != null }

        assertFalse(loggedOut)
        // The rejection comes as an error status with the server's message.
        assertEquals("Aktuelles Passwort falsch", vm.accountState.value.save.errorMessage.text)
        assertNull(channel.text)
    }

    @Test
    fun `the confirmed second factor shows the codes`() {
        server.enqueue(response("""{"success":true,"codes":["aaaa-1111","bbbb-2222"]}"""))
        vm.confirmSecondFactor(" 123456 ")
        until("codes") { vm.secondFactorState.value.codes.isNotEmpty() }

        val z = vm.secondFactorState.value
        assertEquals(true, z.active)
        assertEquals(2, z.codesRemaining)
        assertNull(z.secret)
        assertFalse(z.fetch.loading)
        assertEquals("t${R.string.zf_enabled}", channel.text)
        // The code goes out without spaces.
        assertTrue(server.takeRequest().body.readUtf8().contains("\"123456\""))
    }

    @Test
    fun `a foreign address instead of otpauth is not opened`() {
        server.enqueue(response("""{"success":true,"secret":"JBSWY3DPEHPK3PXP",
            "otpauth":"intent://totp/#Intent;scheme=otpauth;end"}"""))
        vm.setUpSecondFactorOne()
        until("setup") { vm.secondFactorState.value.secret != null }
        assertNull("only otpauth:// goes to ACTION_VIEW", vm.secondFactorState.value.otpauth)
        assertEquals("the key stays for typing it in", "JBSWY3DPEHPK3PXP", vm.secondFactorState.value.secret)

        val real = "otpauth://totp/BrickInventory%3Amarco?secret=JBSWY3DPEHPK3PXP"
        server.enqueue(response("""{"success":true,"secret":"JBSWY3DPEHPK3PXQ","otpauth":"$real"}"""))
        vm.setUpSecondFactorOne()
        until("second setup") { vm.secondFactorState.value.secret == "JBSWY3DPEHPK3PXQ" }
        assertEquals(real, vm.secondFactorState.value.otpauth)
    }

    @Test
    fun `without a code the second factor requires the code field, with a code the change goes through`() {
        server.enqueue(response("""{"success":false,"error":"Bitte den Code eingeben.","code":"second_factor_required"}""", 400))
        vm.changePassword("alt", "neuNeuNeu123!")
        until("refusal") { vm.accountState.value.save.errorMessage != null }
        assertTrue("the code field appears", vm.accountState.value.codeNeeded)
        assertFalse(loggedOut)
        server.takeRequest()

        server.enqueue(response("""{"success":true}"""))
        vm.changePassword("alt", "neuNeuNeu123!", " 123456 ")
        until("abgemeldet") { loggedOut }
        assertTrue(server.takeRequest().body.readUtf8().contains("\"code\":\"123456\""))
    }

    @Test
    fun `the profile is saved without password or code`() {
        server.enqueue(response("""{"success":true}"""))
        server.enqueue(response("""{"success":true,"user":{"id":1,"username":"marco2"}}"""))
        vm.saveProfile("marco2", "marco@example.org", "", "")
        until("saved") { vm.accountState.value.message != null }
        val body = JSONObject(server.takeRequest().body.readUtf8())
        assertEquals("marco2", body.getString("username"))
        assertTrue("$body", body.isNull("password_current") && body.isNull("code"))
        assertEquals("t${R.string.account_saved}", vm.accountState.value.message.text)
    }

    @Test
    fun `new codes and turning off need neither password nor code`() {
        server.enqueue(response("""{"success":true,"codes":["aaaa-1111","bbbb-2222"]}"""))
        vm.renewSecondFactorCodes()
        until("codes") { vm.secondFactorState.value.codes.size == 2 }
        val renew = server.takeRequest()
        assertTrue(renew.path.orEmpty(), renew.path.orEmpty().endsWith("/second-factor/codes"))
        assertTrue(JSONObject(renew.body.readUtf8()).let { it.isNull("password") && it.isNull("code") })

        server.enqueue(response("""{"success":true}"""))
        vm.disableSecondFactor()
        until("off") { vm.secondFactorState.value.active == false }
        val off = server.takeRequest()
        assertTrue(off.path.orEmpty(), off.path.orEmpty().endsWith("/second-factor/disable"))
        assertTrue(JSONObject(off.body.readUtf8()).let { it.isNull("password") && it.isNull("code") })
        assertEquals("t${R.string.zf_disabled}", channel.text)
    }

    @Test
    fun `a new e-mail reports the link and shows it as pending`() {
        server.enqueue(response("""{"success":true,"emailChanged":true,"emailSent":true}"""))
        server.enqueue(response("""{"success":true,"user":{"id":1,"username":"marco","email":"alt@example.org",
            "email_verified":true,"new_email":"neu@example.org"}}"""))
        vm.saveProfile("marco", " neu@example.org ", "", "")
        until("neu geladen") { vm.accountState.value.profile != null }
        assertEquals(R.string.account_email_link_sent, (vm.accountState.value.message as Message.Resource).id)
        assertNull(vm.accountState.value.save.errorMessage)
        assertEquals("the old address counts", "alt@example.org", vm.accountState.value.profile?.email)
        assertEquals("neu@example.org", vm.accountState.value.profile?.emailNew)
    }

    @Test
    fun `a new e-mail without a sent mail reports an error instead of saved`() {
        server.enqueue(response("""{"success":true,"emailChanged":true,"emailSent":false}"""))
        server.enqueue(response("""{"success":true,"user":{"id":1,"username":"marco","email":"alt@example.org",
            "email_verified":true,"new_email":"neu@example.org"}}"""))
        vm.saveProfile("marco", "neu@example.org", "", "")
        until("neu geladen") { vm.accountState.value.profile != null }
        assertEquals("the error survives the reload", "t${R.string.account_email_not_sent}", vm.accountState.value.save.errorMessage.text)
        assertNull("no “saved”", vm.accountState.value.message)
    }
}

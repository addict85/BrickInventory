package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.finances.VouchersRepository
import ch.brickinventoryapp.data.finances.VouchersRepositoryImpl
import ch.brickinventoryapp.data.testing.PathServer
import ch.brickinventoryapp.data.testing.TestApi
import ch.brickinventoryapp.model.domain.CurrencyCode
import ch.brickinventoryapp.model.domain.Money
import ch.brickinventoryapp.model.domain.VoucherInfo
import ch.brickinventoryapp.model.local.StockKind
import ch.brickinventoryapp.offline.OfflineStore
import ch.brickinventoryapp.offline.OutboxPlanner
import ch.brickinventoryapp.offline.OutboxStorage
import ch.brickinventoryapp.offline.StorageInventory
import ch.brickinventoryapp.testing.Sources
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Vouchers — LEGO gift cards in one's own profile.
 *
 * Vouchers are entered by hand with number, PIN and amount or read from the PDF;
 * both are done by the server, the app only calls its services.
 *
 * ── What this test checks, and what NOT ─────────────────────────────────────
 *
 * Addresses and store run against a test server; the order on the More page runs in the app
 * (MorePageTest), the rest reads source text as structure. What the routes DO — who may see which voucher,
 * how the three values come out of the PDF — is checked by the server against a real
 * database (Web-App/test/vouchers-db.test.js) and needs no
 * second, weaker version here.
 *
 * Here stands the one statement that is provable ONLY on this side: that
 * the app uses the same services and builds none of its own — that drifts apart
 * most easily.
 *
 * Counter-checks:
 *  - withoutSecret() returns the voucher unchanged → red “the stored list holds neither …”.
 *  - @PUT("api/v2/vouchers/{id}") to POST → red “the app calls the same addresses as the web app”.
 *  - plaintext() sends a password again → red “deleting, plaintext and PDF release send a
 *    body without password or code” (counter-checks/vouchers-plaintext-with-password.patch).
 *  - pdfRelease() calls the route of the single PDF (with id 0) for id=null → red
 *    “the app calls the same addresses as the web app”.
 */
class VouchersContractTest {

    private fun read(rel: String): String {
        val f = File(Sources.root, rel)
        assert(f.exists()) { "File not found: $rel" }
        return f.readText()
    }

    /** Hide comments — the explanatory texts name the checked patterns themselves. */
    private fun code(src: String) = src.lines().joinToString("\n") { z ->
        if (z.trim().startsWith("//") || z.trim().startsWith("*")) "" else z
    }

    private val repo by lazy { code(read("data/finances/VouchersRepositoryImpl.kt")) }
    private val feature by lazy { code(read("finances/ui/viewmodel/VoucherViewModel.kt")) }
    // The card including its sibling files: list, form and single card.
    private val card by lazy {
        code(listOf("VouchersCard.kt", "VoucherForm.kt", "VoucherCard.kt").joinToString("\n") { read("finances/ui/screens/$it") })
    }

    /** Vouchers against a test server, on a store whose rows the test reads. */
    private fun <T> withServer(block: (PathServer, VouchersRepository, StorageInventory) -> T): T {
        val paths = PathServer("/api/v2/vouchers" to """{"success":true,"vouchers":[
            {"id":5,"number":"1234-5678","pin":"9876","amount":50.0,"currency":"CHF"}]}""")
        val inventory = StorageInventory()
        val store = OfflineStore(inventory, OutboxStorage(), { "test" }, OutboxPlanner {})
        try {
            return block(paths, VouchersRepositoryImpl(TestApi.forTarget(paths.server), store), inventory)
        } finally {
            paths.server.shutdown()
        }
    }

    /** Everything the store holds, as text. */
    private fun stored(inventory: StorageInventory) = runBlocking {
        StockKind.entries.flatMap { inventory.read("test", it).list }.joinToString("\n") { it.content }
    }

    /**
     * ONE service in the backend, both apps on it — the router `routes/api/vouchers.ts`.
     * Other addresses would mean two implementations.
     */
    @Test
    fun `the app calls the same addresses as the web app`() = withServer { paths, repo, _ ->
        val g = VoucherInfo(number = "1234-5678", pin = "9876", amount = Money.from(50.0)!!, currency = CurrencyCode.CHF)
        runBlocking {
            repo.list()
            repo.create(g)
            repo.edit(5, g)
            repo.deleteVoucher(5)
            repo.fromPdf("karte.pdf", "application/pdf", byteArrayOf(1, 2, 3))
            repo.plaintext(5)
            repo.pdfRelease(5)
            repo.pdfRelease(null)
        }
        assertEquals(listOf("GET /api/v2/vouchers", "POST /api/v2/vouchers", "PUT /api/v2/vouchers/5",
            "DELETE /api/v2/vouchers/5", "POST /api/v2/vouchers/pdf", "POST /api/v2/vouchers/5/plaintext",
            "POST /api/v2/vouchers/5/pdf-grant", "POST /api/v2/vouchers/export/pdf-grant"), paths.requests.toList())
    }

    /** The server still parses a JSON body; the login is enough, so it holds no secret. */
    @Test
    fun `deleting, plaintext and PDF release send a body without password or code`() = withServer { paths, repo, _ ->
        runBlocking {
            repo.deleteVoucher(5)
            repo.plaintext(5)
            repo.pdfRelease(5)
            repo.pdfRelease(null)
        }
        assertEquals(4, paths.bodyBytes.size)
        for ((i, k) in paths.bodyBytes.withIndex()) {
            val o = JSONObject(k)
            assertTrue("${paths.requests[i]}: password", o.isNull("password"))
            assertTrue("${paths.requests[i]}: code", o.isNull("code"))
        }
    }

    @Test
    fun `the PDF is sent to the SERVER and not read in the app`() {
        // The excerpt lives in `Web-App/src/vouchers/pdfParsing.ts` — ONCE, for
        // both apps. A second reading logic in Kotlin would have to keep pace
        // with it, and the web app would need a third.
        assert(repo.contains("MultipartBody.Part.createFormData(\"file\"")) {
            "The file must go to the server as multipart."
        }
        for (forbidden in listOf("PdfRenderer", "inflate", "Tj", "zlib")) {
            assert(!feature.contains(forbidden) && !repo.contains(forbidden)) {
                "The app tries to read the PDF ITSELF ($forbidden). That belongs " +
                    "on the server — otherwise there are two versions of the same rule."
            }
        }
    }

    @Test
    fun `the three values are not checked in the app`() {
        // `checkValues` in `src/vouchers/service.ts` decides which
        // number, which amount and which currency are valid — once,
        // for both apps. A second check here would drift apart
        // at some point, and then it would be unclear which one applies.
        //
        // The one exception is `toDoubleOrNull`: that is no rule but
        // the conversion of text into a number before it can be
        // sent at all.
        for (forbidden in listOf("Regex(", "matches(", "length in ", "startsWith(\"50")) {
            assert(!feature.contains(forbidden)) {
                "The app has its own check of the voucher values ($forbidden)."
            }
        }
    }

    @Test
    fun `missing values from the PDF are taken over into the form`() {
        // The server answers with 422 and what it COULD READ. Without
        // this takeover the user would face empty fields although the
        // number was in the PDF after all — and would have to type nineteen digits
        // that the server already knows.
        assert(feature.contains("VoucherStorage.Incomplete") && repo.contains("a.parsed")) {
            "The values read from the PDF are not taken over."
        }
        assert(repo.contains("422")) {
            "The 422 body is not evaluated — then `gelesen` gets lost, " +
                "because the safe call only takes `error` from an error body."
        }
    }

    @Test
    fun `the PIN is hidden by default`() {
        // Not out of security belief — whoever sees the screen is
        // signed in — but against the shoulder next to you. The reverse
        // is stated as well: it must also be revealable, otherwise the
        // PIN is useless.
        assert(card.contains("\"••••\"")) { "The PIN stands uncovered in the list." }
        assert(card.contains("pinVisible")) { "The PIN cannot be revealed." }
    }

    @Test
    fun `the PDF is not stored on the device`() {
        // Number and PIN are everything needed for redeeming. The
        // existing PdfViewerScreen loads the address with the signed-in
        // client; an own copy in the cache would be a second place for
        // the same numbers — and one that survives sign-out at that.
        for (forbidden in listOf("cacheDir", "writeBytes", "getExternalFilesDir", "MediaStore")) {
            assert(!feature.contains(forbidden) && !repo.contains(forbidden)) {
                "The voucher PDF is stored on the device ($forbidden)."
            }
        }
    }

    @Test
    fun `number and PIN can be copied by tapping`() {
        // Tapping copies, because number and PIN mostly go into a payment field.
        // Both rows are KopierZeilen: whole row tappable (clickable), 48 dp high, with
        // copy icon. Height and description are checked by UisRulesTest on the screen.
        assert(card.contains("clickable(role = Role.Button, onClickLabel = description, onClick = onCopy)")) {
            "The copy row is no longer tappable."
        }
        assert(card.contains("{ events.copy(true) }")) {
            "The voucher number cannot be copied by tapping."
        }
        assert(card.contains("{ events.copy(false) }")) {
            "The PIN cannot be copied by tapping."
        }
        // The RAW number, not the one shown in groups of four: the
        // grouping is a reading aid, a payment field does not accept it.
        assert(!card.contains("copy(g.number.chunked")) {
            "The grouped display is copied instead of the real number."
        }
    }

    @Test
    fun `the voucher no longer has a note`() {
        // The server no longer knows a note; a remainder in the app would be a row
        // it does not answer.
        for (file in listOf(card, feature)) {
            assert(!file.contains("notiz") && !file.contains(".note")) {
                "The app still has a note on the voucher."
            }
        }
    }

    /**
     * The store keeps the list for offline use, but only the last four digits and no PIN; the
     * plaintext call does not touch the store at all.
     */
    @Test
    fun `the stored list holds neither the full number nor the PIN`() = withServer { _, repo, inventory ->
        runBlocking { repo.list() }
        val text = stored(inventory)
        assertTrue("the list is not stored at all: $text", "5678" in text)
        assertTrue("number or PIN in the store: $text", "1234-5678" !in text && "9876" !in text)
    }
}

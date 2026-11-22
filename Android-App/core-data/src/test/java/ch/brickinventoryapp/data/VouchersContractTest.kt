package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.finances.VouchersRepository
import ch.brickinventoryapp.data.repository.Outcome
import ch.brickinventoryapp.data.testing.PathServer
import ch.brickinventoryapp.data.testing.TestApi
import ch.brickinventoryapp.data.testing.testVouchersRepository
import ch.brickinventoryapp.model.domain.Confirmation
import ch.brickinventoryapp.model.domain.CurrencyCode
import ch.brickinventoryapp.model.domain.Money
import ch.brickinventoryapp.model.domain.VoucherInfo
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
 * Addresses and store run against a test server; the rest reads source text,
 * because it concerns screens. What the routes DO — who may see which voucher,
 * how the three values come out of the PDF — is checked by the server against a real
 * database (Web-App/test/vouchers-db.test.js) and needs no
 * second, weaker version here.
 *
 * Here stands the one statement that is provable ONLY on this side: that
 * the app uses the same services and builds none of its own — that drifts apart
 * most easily.
 *
 * Counter-checks: in VouchersRepository.list() the fetch
 * wrapped with cached("gutscheine", …) → red “the list is not
 * cached”; @PUT("api/v1/vouchers/{id}") to POST → red “the app
 * calls the same addresses as the web app”.
 *
 * Counter-checks:
 *  - deleting again as @DELETE without body (confirmation not sent along) → red
 *    “deleting, plaintext and PDF release carry password and code”.
 *  - pdfRelease() calls the route of the single PDF (with id 0) for id=null → red
 *    “the app calls the same addresses as the web app”.
 *  - plaintext in list() stored with cached("gutscheine-klartext", …) → red
 *    “the plaintext is not cached”.
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

    /** Vouchers against a test server, with disk storage in a throwaway folder. */
    private fun <T> withServer(block: (PathServer, VouchersRepository, File) -> T): T {
        val paths = PathServer("/api/v1/vouchers" to """{"success":true,"vouchers":[
            {"id":5,"number":"1234-5678","pin":"9876","amount":50.0,"currency":"CHF"}]}""")
        val folder = File(System.getProperty("java.io.tmpdir"), "bim-gutschein-${System.nanoTime()}").apply { mkdirs() }
        try {
            return block(paths, testVouchersRepository(TestApi.forTarget(paths.server)), folder)
        } finally {
            paths.server.shutdown(); folder.deleteRecursively()
        }
    }

    /**
     * ONE service in the backend, both apps on it — the router `routes/api_v1/vouchers.ts`.
     * Other addresses would mean two implementations.
     */
    @Test
    fun `the app calls the same addresses as the web app`() = withServer { paths, repo, _ ->
        val g = VoucherInfo(number = "1234-5678", pin = "9876", amount = Money.from(50.0)!!, currency = CurrencyCode.CHF)
        val b = Confirmation(password = "geheim")
        runBlocking {
            repo.list()
            repo.create(g)
            repo.edit(5, g)
            repo.deleteVoucher(5, b)
            repo.fromPdf("karte.pdf", "application/pdf", byteArrayOf(1, 2, 3))
            repo.plaintext(5, b)
            repo.pdfRelease(5, b)
            repo.pdfRelease(null, b)
        }
        assertEquals(listOf("GET /api/v1/vouchers", "POST /api/v1/vouchers", "PUT /api/v1/vouchers/5",
            "DELETE /api/v1/vouchers/5", "POST /api/v1/vouchers/pdf", "POST /api/v1/vouchers/5/klartext",
            "POST /api/v1/vouchers/5/pdf-freigabe", "POST /api/v1/vouchers/export/pdf-freigabe"), paths.requests.toList())
    }

    /** Without a body the server answers with 400: deleting and plaintext require the confirmation. */
    @Test
    fun `deleting, plaintext and PDF release carry password and code`() = withServer { paths, repo, _ ->
        val b = Confirmation(password = "geheim", code = "123456")
        runBlocking {
            repo.deleteVoucher(5, b)
            repo.plaintext(5, b)
            repo.pdfRelease(5, b)
            repo.pdfRelease(null, b)
        }
        assertEquals(4, paths.bodyBytes.size)
        for ((i, k) in paths.bodyBytes.withIndex()) {
            val o = JSONObject(k)
            assertEquals("${paths.requests[i]}: password", "geheim", o.getString("password"))
            assertEquals("${paths.requests[i]}: Code", "123456", o.getString("code"))
        }
    }

    @Test
    fun `the plaintext is not cached`() = withServer { paths, repo, folder ->
        paths.responses["/api/v1/vouchers/5/klartext"] =
            """{"success":true,"id":5,"number":"6000111122223333","pin":"9876"}"""
        val r = runBlocking { repo.list(); repo.plaintext(5, Confirmation(password = "geheim")) }
        assertEquals("6000111122223333", (r as Outcome.Success).data.number)
        val stored = folder.walkTopDown().filter { it.isFile }
            .filter { it.readText().let { t -> "6000111122223333" in t || "9876" in t } }.toList()
        assertTrue("Plaintext is on disk: $stored", stored.isEmpty())
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
        assert(feature.contains("VoucherStorage.Incomplete") && repo.contains("a.gelesen")) {
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
     * The vouchers are the first entry of the „Mehr“ page (MoreScreen.kt), so that
     * one finds them at the checkout without searching. Checked is the order, not merely
     * the occurrence: whoever builds in something new likes to put it at the top.
     */
    @Test
    fun `the vouchers are at the very top of the More page`() {
        // The page draws the groups from 0; the first entry is the first of group 0.
        val source = code(read("app/MoreScreen.kt"))
        val page = source.substringAfter("fun MoreScreen(").substringBefore("fun MoreGroupContent(")
        assert(Regex("""for \(i in 0 until""").containsMatchIn(page)) { "The More page does not start with group 0" }
        val groupNull = source.substringAfter("fun MoreGroupContent(").substringAfter("0 ->")
        val first = Regex("""MoreItem\(R\.string\.(\w+)""").find(groupNull)?.groupValues?.get(1)
        assert(first == "vouchers_title") {
            "The first entry of the More page leads to $first instead of the " +
                "VOUCHERS — then one has to search for the cards again."
        }
    }

    /**
     * The sections NO longer lie in the settings.
     *
     * The opposite direction to the assertion above. Without it both would
     * be green at the same time: the entries on „Mehr“ AND a forgotten
     * copy in the settings screen. Two ways to the same page cannot be seen
     * in the source text, but they can on the screen — and here there is
     * no emulator in which that would stand out.
     */
    @Test
    fun `the settings no longer lead to the sections themselves`() {
        val once = code(read("account/ui/screens/SettingsScreen.kt"))
        for (route in listOf("FinanceTarget.Gutscheine", "AccountTarget.Preisalarme", "AccountTarget.Lagerorte",
                             "AccountTarget.Haushalt", "AccountTarget.CsvImport", "AccountTarget.Konto")) {
            assert(!once.contains(route)) {
                "SettingsScreen.kt still leads to $route itself — then the " +
                    "section exists twice, on „Mehr“ and in the settings."
            }
        }
        assert(!once.contains("EinstellungsBereich")) {
            "The settings area is still in the settings — the route via " +
                "the list is not completely dismantled."
        }
    }

    /**
     * The other repositories store responses on disk. A list with
     * numbers and PINs does not belong there, not even for five minutes.
     */
    @Test
    fun `the list is not cached`() = withServer { _, repo, folder ->
        runBlocking { repo.list() }
        val stored = folder.walkTopDown().filter { it.isFile }.filter { it.readText().contains("9876") }.toList()
        assertTrue("Number and PIN are on disk: $stored", stored.isEmpty())
    }
}

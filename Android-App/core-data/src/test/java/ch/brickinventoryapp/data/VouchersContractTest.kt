package ch.brickinventoryapp.data

import ch.brickinventoryapp.model.domain.Geld
import ch.brickinventoryapp.model.domain.Gutscheinangabe
import ch.brickinventoryapp.model.domain.Waehrung
import ch.brickinventoryapp.model.domain.Confirmation
import ch.brickinventoryapp.data.repository.VouchersRepository
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import ch.brickinventoryapp.data.repository.Ergebnis
import java.io.File
import org.json.JSONObject
import ch.brickinventoryapp.testing.testVouchersRepository
import ch.brickinventoryapp.testing.PfadServer
import ch.brickinventoryapp.testing.Quellen
import ch.brickinventoryapp.testing.TestApi

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
 * Counter-checks: in VouchersRepository.liste() the fetch
 * wrapped with cached("gutscheine", …) → red “the list is not
 * cached”; @PUT("api/v1/vouchers/{id}") to POST → red “the app
 * calls the same addresses as the web app”.
 *
 * Counter-checks:
 *  - deleting again as @DELETE without body (confirmation not sent along) → red
 *    “deleting, plaintext and PDF release carry password and code”.
 *  - pdfRelease() calls the route of the single PDF (with id 0) for id=null → red
 *    “the app calls the same addresses as the web app”.
 *  - plaintext in liste() stored with cached("gutscheine-klartext", …) → red
 *    “the plaintext is not cached”.
 */
class VouchersContractTest {

    private fun lies(rel: String): String {
        val f = File(Quellen.root, rel)
        assert(f.exists()) { "Datei nicht gefunden: $rel" }
        return f.readText()
    }

    /** Hide comments — the explanatory texts name the checked patterns themselves. */
    private fun code(src: String) = src.lines().joinToString("\n") { z ->
        if (z.trim().startsWith("//") || z.trim().startsWith("*")) "" else z
    }

    private val repo by lazy { code(lies("data/repository/GutscheineRepositoryImpl.kt")) }
    private val feature by lazy { code(lies("finances/ui/viewmodel/GutscheinViewModel.kt")) }
    // The card including its sibling files: list, form and single card.
    private val karte by lazy {
        code(listOf("GutscheineCard.kt", "GutscheinFormular.kt", "GutscheinKarte.kt").joinToString("\n") { lies("finances/ui/screens/$it") })
    }

    /** Vouchers against a test server, with disk storage in a throwaway folder. */
    private fun <T> withServer(block: (PfadServer, VouchersRepository, File) -> T): T {
        val paths = PfadServer("/api/v1/vouchers" to """{"success":true,"vouchers":[
            {"id":5,"number":"1234-5678","pin":"9876","amount":50.0,"currency":"CHF"}]}""")
        val folder = File(System.getProperty("java.io.tmpdir"), "bim-gutschein-${System.nanoTime()}").apply { mkdirs() }
        try {
            return block(paths, testVouchersRepository(TestApi.fuer(paths.server)), folder)
        } finally {
            paths.server.shutdown(); folder.deleteRecursively()
        }
    }

    /**
     * ONE service in the backend, both apps on it — the router routes/api_v1/vouchers.ts.
     * Other addresses would mean two implementations.
     */
    @Test
    fun `the app calls the same addresses as the web app`() = withServer { paths, repo, _ ->
        val g = Gutscheinangabe(nummer = "1234-5678", pin = "9876", betrag = Geld.aus(50.0)!!, waehrung = Waehrung.CHF)
        val b = Confirmation(passwort = "geheim")
        runBlocking {
            repo.liste()
            repo.anlegen(g)
            repo.aendern(5, g)
            repo.loeschen(5, b)
            repo.fromPdf("karte.pdf", "application/pdf", byteArrayOf(1, 2, 3))
            repo.klartext(5, b)
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
        val b = Confirmation(passwort = "geheim", code = "123456")
        runBlocking {
            repo.loeschen(5, b)
            repo.klartext(5, b)
            repo.pdfRelease(5, b)
            repo.pdfRelease(null, b)
        }
        assertEquals(4, paths.koerper.size)
        for ((i, k) in paths.koerper.withIndex()) {
            val o = JSONObject(k)
            assertEquals("${paths.requests[i]}: Passwort", "geheim", o.getString("password"))
            assertEquals("${paths.requests[i]}: Code", "123456", o.getString("code"))
        }
    }

    @Test
    fun `the plaintext is not cached`() = withServer { paths, repo, folder ->
        paths.antworten["/api/v1/vouchers/5/klartext"] =
            """{"success":true,"id":5,"number":"6000111122223333","pin":"9876"}"""
        val r = runBlocking { repo.liste(); repo.klartext(5, Confirmation(passwort = "geheim")) }
        assertEquals("6000111122223333", (r as Ergebnis.Erfolg).data.number)
        val abgelegt = folder.walkTopDown().filter { it.isFile }
            .filter { it.readText().let { t -> "6000111122223333" in t || "9876" in t } }.toList()
        assertTrue("Klartext liegt auf der Platte: $abgelegt", abgelegt.isEmpty())
    }

    @Test
    fun `the PDF is sent to the SERVER and not read in the app`() {
        // The excerpt lives in Web-App/src/vouchers/pdfParsing.ts — ONCE, for
        // both apps. A second reading logic in Kotlin would have to keep pace
        // with it, and the web app would need a third.
        assert(repo.contains("MultipartBody.Part.createFormData(\"file\"")) {
            "Die Datei muss als multipart zum Server gehen."
        }
        for (verboten in listOf("PdfRenderer", "inflate", "Tj", "zlib")) {
            assert(!feature.contains(verboten) && !repo.contains(verboten)) {
                "Die App versucht, das PDF SELBST zu lesen ($verboten). Das gehoert " +
                    "auf den Server — sonst gibt es zwei Fassungen derselben Regel."
            }
        }
    }

    @Test
    fun `the three values are not checked in the app`() {
        // `checkValues` in src/vouchers/service.ts decides which
        // number, which amount and which currency are valid — once,
        // for both apps. A second check here would drift apart
        // at some point, and then it would be unclear which one applies.
        //
        // The one exception is `toDoubleOrNull`: that is no rule but
        // the conversion of text into a number before it can be
        // sent at all.
        for (verboten in listOf("Regex(", "matches(", "length in ", "startsWith(\"50")) {
            assert(!feature.contains(verboten)) {
                "In der App steht eine eigene Pruefung der Gutscheinwerte ($verboten)."
            }
        }
    }

    @Test
    fun `missing values from the PDF are taken over into the form`() {
        // The server answers with 422 and what it COULD READ. Without
        // this takeover the user would face empty fields although the
        // number was in the PDF after all — and would have to type nineteen digits
        // that the server already knows.
        assert(feature.contains("Gutscheinspeicherung.Incomplete") && repo.contains("a.gelesen")) {
            "Die aus dem PDF gelesenen Werte werden nicht uebernommen."
        }
        assert(repo.contains("422")) {
            "Der 422-Rumpf wird nicht ausgewertet — dann geht `gelesen` verloren, " +
                "weil sicherAufrufen aus einem Fehlerrumpf nur `error` holt."
        }
    }

    @Test
    fun `the PIN is hidden by default`() {
        // Not out of security belief — whoever sees the screen is
        // signed in — but against the shoulder next to you. The reverse
        // is stated as well: it must also be revealable, otherwise the
        // PIN is useless.
        assert(karte.contains("\"••••\"")) { "Der PIN steht unverdeckt in der Liste." }
        assert(karte.contains("pinSichtbar")) { "Der PIN laesst sich nicht aufdecken." }
    }

    @Test
    fun `the PDF is not stored on the device`() {
        // Number and PIN are everything needed for redeeming. The
        // existing PdfViewerScreen loads the address with the signed-in
        // client; an own copy in the cache would be a second place for
        // the same numbers — and one that survives sign-out at that.
        for (verboten in listOf("cacheDir", "writeBytes", "getExternalFilesDir", "MediaStore")) {
            assert(!feature.contains(verboten) && !repo.contains(verboten)) {
                "Das Gutschein-PDF wird auf dem Geraet abgelegt ($verboten)."
            }
        }
    }

    @Test
    fun `number and PIN can be copied by tapping`() {
        // Tapping copies, because number and PIN mostly go into a payment field.
        // Both rows are KopierZeilen: whole row tappable (clickable), 48 dp high, with
        // copy icon. Height and description are checked by UisRulesTest on the screen.
        assert(karte.contains("clickable(role = Role.Button, onClickLabel = beschreibung, onClick = onKopieren)")) {
            "Die Kopierzeile ist nicht mehr antippbar."
        }
        assert(karte.contains("{ onKopieren(true) }")) {
            "Die Gutscheinnummer laesst sich nicht durch Antippen kopieren."
        }
        assert(karte.contains("{ onKopieren(false) }")) {
            "Der PIN laesst sich nicht durch Antippen kopieren."
        }
        // The RAW number, not the one shown in groups of four: the
        // grouping is a reading aid, a payment field does not accept it.
        assert(!karte.contains("onKopieren(g.number.chunked")) {
            "Kopiert wird die gruppierte Anzeige statt der echten Nummer."
        }
    }

    @Test
    fun `the voucher no longer has a note`() {
        // The server no longer knows a note; a remainder in the app would be a row
        // it does not answer.
        for (datei in listOf(karte, feature)) {
            assert(!datei.contains("notiz") && !datei.contains(".note")) {
                "In der App steht noch eine Notiz am Gutschein."
            }
        }
    }

    /**
     * The vouchers are the first entry of the „Mehr“ page (MehrBildschirm.kt), so that
     * one finds them at the checkout without searching. Checked is the order, not merely
     * the occurrence: whoever builds in something new likes to put it at the top.
     */
    @Test
    fun `the vouchers are at the very top of the More page`() {
        // The page draws the groups from 0; the first entry is the first of group 0.
        val quelle = code(lies("app/MehrBildschirm.kt"))
        val seite = quelle.substringAfter("fun MehrBildschirm(").substringBefore("fun MehrGruppeInhalt(")
        assert(Regex("""for \(i in 0 until""").containsMatchIn(seite)) { "Die Seite Mehr beginnt nicht mit Gruppe 0" }
        val groupNull = quelle.substringAfter("fun MehrGruppeInhalt(").substringAfter("0 ->")
        val erste = Regex("""MehrEintrag\(R\.string\.(\w+)""").find(groupNull)?.groupValues?.get(1)
        assert(erste == "vouchers_title") {
            "Der erste Eintrag der Seite Mehr fuehrt zu $erste statt zu den " +
                "GUTSCHEINEN — dann muss man fuer die Karten wieder suchen."
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
        val once = code(lies("account/ui/screens/SettingsScreen.kt"))
        for (route in listOf("FinanzZiel.Gutscheine", "KontoZiel.Preisalarme", "KontoZiel.Lagerorte",
                             "KontoZiel.Haushalt", "KontoZiel.CsvImport", "KontoZiel.Konto")) {
            assert(!once.contains(route)) {
                "SettingsScreen.kt fuehrt noch selbst zu $route — dann gibt es die " +
                    "Rubrik zweimal, auf „Mehr“ und in den Einstellungen."
            }
        }
        assert(!once.contains("EinstellungsBereich")) {
            "EinstellungsBereich steht noch in den Einstellungen — der Weg ueber " +
                "die Liste ist nicht vollstaendig zurueckgebaut."
        }
    }

    /**
     * The other repositories store responses on disk. A list with
     * numbers and PINs does not belong there, not even for five minutes.
     */
    @Test
    fun `the list is not cached`() = withServer { _, repo, folder ->
        runBlocking { repo.liste() }
        val abgelegt = folder.walkTopDown().filter { it.isFile }.filter { it.readText().contains("9876") }.toList()
        assertTrue("Nummer und PIN liegen auf der Platte: $abgelegt", abgelegt.isEmpty())
    }
}

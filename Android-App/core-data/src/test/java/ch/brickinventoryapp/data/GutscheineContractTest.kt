package ch.brickinventoryapp.data

import ch.brickinventoryapp.model.data.model.GutscheinRequest
import ch.brickinventoryapp.model.data.model.ZweiterFaktorAnfrage
import ch.brickinventoryapp.data.repository.GutscheineRepository
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import ch.brickinventoryapp.data.repository.Ergebnis
import java.io.File
import org.json.JSONObject
import ch.brickinventoryapp.testing.GutscheineRepository
import ch.brickinventoryapp.testing.PfadServer
import ch.brickinventoryapp.testing.Quellen
import ch.brickinventoryapp.testing.TestApi

/**
 * Gutscheine — LEGO-Geschenkkarten im eigenen Profil.
 *
 * Gutscheine werden mit Nummer, PIN und Betrag von Hand erfasst oder aus dem PDF
 * gelesen; beides macht der Server, die App ruft nur seine Dienste.
 *
 * ── Was dieser Test prueft, und was NICHT ───────────────────────────────────
 *
 * Adressen und Ablage laufen gegen einen Testserver; der Rest liest Quelltext,
 * weil er Bildschirme betrifft. Was die Routen TUN — wer welchen Gutschein sehen darf,
 * wie aus dem PDF die drei Werte werden —, prueft der Server gegen eine echte
 * Datenbank (Web-App/test/gutscheine-db.test.js) und braucht hier keine
 * zweite, schwaechere Fassung.
 *
 * Hier steht die eine Aussage, die NUR auf dieser Seite nachweisbar ist: dass
 * die App dieselben Dienste benutzt und keine eigenen baut — das laeuft am
 * leichtesten auseinander.
 *
 * Gegenproben: in GutscheineRepository.liste() den Abruf
 * mit cached("gutscheine", …) umhüllt → rot „die Liste wird nicht
 * zwischengespeichert“; @PUT("api/v1/vouchers/{id}") auf POST → rot „die App
 * ruft dieselben Adressen wie die Webapp“.
 *
 * Gegenproben:
 *  - Löschen wieder als @DELETE ohne Rumpf (Bestätigung nicht mitgeschickt) → rot
 *    „Löschen, Klartext und PDF-Freigabe tragen Passwort und Code“.
 *  - pdfFreigabe() ruft für id=null die Route des einzelnen PDFs (mit id 0) → rot
 *    „die App ruft dieselben Adressen wie die Webapp“.
 *  - Klartext in liste() mit cached("gutscheine-klartext", …) abgelegt → rot
 *    „der Klartext wird nicht zwischengespeichert“.
 */
class GutscheineContractTest {

    private fun lies(rel: String): String {
        val f = File(Quellen.wurzel, rel)
        assert(f.exists()) { "Datei nicht gefunden: $rel" }
        return f.readText()
    }

    /** Kommentare ausblenden — die Erklaertexte nennen die geprueften Muster selbst. */
    private fun code(src: String) = src.lines().joinToString("\n") { z ->
        if (z.trim().startsWith("//") || z.trim().startsWith("*")) "" else z
    }

    private val repo by lazy { code(lies("data/repository/GutscheineRepositoryImpl.kt")) }
    private val feature by lazy { code(lies("finanzen/ui/viewmodel/GutscheinViewModel.kt")) }
    // Die Karte samt ihren Geschwisterdateien: Liste, Formular und Einzelkarte.
    private val karte by lazy {
        code(listOf("GutscheineCard.kt", "GutscheinFormular.kt", "GutscheinKarte.kt").joinToString("\n") { lies("finanzen/ui/screens/$it") })
    }

    /** Gutscheine gegen einen Testserver, mit Plattenablage in einem Wegwerf-Ordner. */
    private fun <T> mitServer(block: (PfadServer, GutscheineRepository, File) -> T): T {
        val pfade = PfadServer("/api/v1/vouchers" to """{"success":true,"vouchers":[
            {"id":5,"number":"1234-5678","pin":"9876","amount":50.0,"currency":"CHF"}]}""")
        val ordner = File(System.getProperty("java.io.tmpdir"), "bim-gutschein-${System.nanoTime()}").apply { mkdirs() }
        try {
            return block(pfade, GutscheineRepository(TestApi.fuer(pfade.server)), ordner)
        } finally {
            pfade.server.shutdown(); ordner.deleteRecursively()
        }
    }

    /**
     * EIN Dienst im Backend, beide Apps daran — der Router routes/api_v1/vouchers.ts.
     * Andere Adressen hiessen zwei Umsetzungen.
     */
    @Test
    fun `die App ruft dieselben Adressen wie die Webapp`() = mitServer { pfade, repo, _ ->
        val g = GutscheinRequest(number = "1234-5678", pin = "9876", amount = 50.0)
        val b = ZweiterFaktorAnfrage(password = "geheim")
        runBlocking {
            repo.liste()
            repo.anlegen(g)
            repo.aendern(5, g)
            repo.loeschen(5, b)
            repo.ausPdf("karte.pdf", "application/pdf", byteArrayOf(1, 2, 3))
            repo.klartext(5, b)
            repo.pdfFreigabe(5, b)
            repo.pdfFreigabe(null, b)
        }
        assertEquals(listOf("GET /api/v1/vouchers", "POST /api/v1/vouchers", "PUT /api/v1/vouchers/5",
            "DELETE /api/v1/vouchers/5", "POST /api/v1/vouchers/pdf", "POST /api/v1/vouchers/5/klartext",
            "POST /api/v1/vouchers/5/pdf-freigabe", "POST /api/v1/vouchers/export/pdf-freigabe"), pfade.anfragen.toList())
    }

    /** Ohne Rumpf antwortet der Server mit 400: Löschen und Klartext verlangen die Bestätigung. */
    @Test
    fun `Loeschen, Klartext und PDF-Freigabe tragen Passwort und Code`() = mitServer { pfade, repo, _ ->
        val b = ZweiterFaktorAnfrage(password = "geheim", code = "123456")
        runBlocking {
            repo.loeschen(5, b)
            repo.klartext(5, b)
            repo.pdfFreigabe(5, b)
            repo.pdfFreigabe(null, b)
        }
        assertEquals(4, pfade.koerper.size)
        for ((i, k) in pfade.koerper.withIndex()) {
            val o = JSONObject(k)
            assertEquals("${pfade.anfragen[i]}: Passwort", "geheim", o.getString("password"))
            assertEquals("${pfade.anfragen[i]}: Code", "123456", o.getString("code"))
        }
    }

    @Test
    fun `der Klartext wird nicht zwischengespeichert`() = mitServer { pfade, repo, ordner ->
        pfade.antworten["/api/v1/vouchers/5/klartext"] =
            """{"success":true,"id":5,"number":"6000111122223333","pin":"9876"}"""
        val r = runBlocking { repo.liste(); repo.klartext(5, ZweiterFaktorAnfrage(password = "geheim")) }
        assertEquals("6000111122223333", (r as Ergebnis.Success).data.number)
        val abgelegt = ordner.walkTopDown().filter { it.isFile }
            .filter { it.readText().let { t -> "6000111122223333" in t || "9876" in t } }.toList()
        assertTrue("Klartext liegt auf der Platte: $abgelegt", abgelegt.isEmpty())
    }

    @Test
    fun `das PDF wird zum SERVER geschickt und nicht in der App gelesen`() {
        // Der Auszug steht in Web-App/utils/gutscheinPdf.ts — EINMAL, fuer
        // beide Apps. Eine zweite Leselogik in Kotlin muesste mit ihr Schritt
        // halten, und die Webapp braeuchte eine dritte.
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
    fun `die drei Werte werden nicht in der App geprueft`() {
        // `pruefeWerte` in routes/api_v1/vouchers.ts entscheidet, welche
        // Nummer, welcher Betrag und welche Waehrung gueltig sind — einmal,
        // fuer beide Apps. Eine zweite Pruefung hier liefe irgendwann
        // auseinander, und dann waere unklar, welche gilt.
        //
        // Die eine Ausnahme ist `toDoubleOrNull`: Das ist keine Regel, sondern
        // die Umwandlung von Text in eine Zahl, bevor sie ueberhaupt
        // verschickt werden kann.
        for (verboten in listOf("Regex(", "matches(", "length in ", "startsWith(\"50")) {
            assert(!feature.contains(verboten)) {
                "In der App steht eine eigene Pruefung der Gutscheinwerte ($verboten)."
            }
        }
    }

    @Test
    fun `fehlende Werte aus dem PDF werden ins Formular uebernommen`() {
        // Der Server antwortet mit 422 und dem, was er LESEN KONNTE. Ohne
        // diese Uebernahme stuende der Nutzer vor leeren Feldern, obwohl die
        // Nummer sehr wohl im PDF stand — und muesste neunzehn Ziffern
        // abtippen, die der Server schon kennt.
        assert(feature.contains("r.data.gelesen") || feature.contains("gelesen")) {
            "Die aus dem PDF gelesenen Werte werden nicht uebernommen."
        }
        assert(repo.contains("422")) {
            "Der 422-Rumpf wird nicht ausgewertet — dann geht `gelesen` verloren, " +
                "weil safeCall aus einem Fehlerrumpf nur `error` holt."
        }
    }

    @Test
    fun `der PIN ist standardmaessig verdeckt`() {
        // Nicht aus Sicherheitsglauben — wer den Bildschirm sieht, ist
        // angemeldet —, sondern gegen die Schulter daneben. Die Umkehrung
        // steht gleich mit: Es muss sich auch aufdecken lassen, sonst ist der
        // PIN unbrauchbar.
        assert(karte.contains("\"••••\"")) { "Der PIN steht unverdeckt in der Liste." }
        assert(karte.contains("pinSichtbar")) { "Der PIN laesst sich nicht aufdecken." }
    }

    @Test
    fun `das PDF wird nicht auf dem Geraet abgelegt`() {
        // Nummer und PIN sind alles, was zum Einloesen noetig ist. Der
        // vorhandene PdfViewerScreen laedt die Adresse mit dem angemeldeten
        // Client; eine eigene Kopie im Cache waere ein zweiter Ort fuer
        // dieselben Zahlen — und zwar einer, der das Abmelden ueberlebt.
        for (verboten in listOf("cacheDir", "writeBytes", "getExternalFilesDir", "MediaStore")) {
            assert(!feature.contains(verboten) && !repo.contains(verboten)) {
                "Das Gutschein-PDF wird auf dem Geraet abgelegt ($verboten)."
            }
        }
    }

    @Test
    fun `Nummer und PIN lassen sich durch Antippen kopieren`() {
        // Antippen kopiert, weil Nummer und PIN meist in ein Bezahlfeld wandern.
        // Beide Zeilen sind KopierZeilen: ganze Zeile antippbar (clickable), 48 dp hoch, mit
        // Kopiersymbol. Die Höhe und die Beschreibung prüft OberflaechenRegelnTest am Bildschirm.
        assert(karte.contains("clickable(role = Role.Button, onClickLabel = beschreibung, onClick = onKopieren)")) {
            "Die Kopierzeile ist nicht mehr antippbar."
        }
        assert(karte.contains("{ onKopieren(true) }")) {
            "Die Gutscheinnummer laesst sich nicht durch Antippen kopieren."
        }
        assert(karte.contains("{ onKopieren(false) }")) {
            "Der PIN laesst sich nicht durch Antippen kopieren."
        }
        // Die ROHE Nummer, nicht die in Vierergruppen gezeigte: Die
        // Gruppierung ist eine Lesehilfe, ein Bezahlfeld nimmt sie nicht an.
        assert(!karte.contains("onKopieren(g.number.chunked")) {
            "Kopiert wird die gruppierte Anzeige statt der echten Nummer."
        }
    }

    @Test
    fun `der Gutschein hat keine Notiz mehr`() {
        // Der Server kennt keine Notiz mehr; ein Rest in der App waere eine Zeile,
        // die er nicht beantwortet.
        for (datei in listOf(karte, feature)) {
            assert(!datei.contains("notiz") && !datei.contains(".note")) {
                "In der App steht noch eine Notiz am Gutschein."
            }
        }
    }

    /**
     * Die Gutscheine sind der erste Eintrag der Seite „Mehr“ (MehrBildschirm.kt), damit
     * man sie an der Kasse ohne Suchen findet. Geprueft wird die Reihenfolge, nicht bloss
     * das Vorkommen: Wer etwas Neues einbaut, setzt es gern oben hin.
     */
    @Test
    fun `die Gutscheine stehen ganz oben auf der Seite Mehr`() {
        // Die Seite zeichnet die Gruppen ab 0; der erste Eintrag ist der erste der Gruppe 0.
        val quelle = code(lies("app/MehrBildschirm.kt"))
        val seite = quelle.substringAfter("fun MehrBildschirm(").substringBefore("fun MehrGruppeInhalt(")
        assert(Regex("""for \(i in 0 until""").containsMatchIn(seite)) { "Die Seite Mehr beginnt nicht mit Gruppe 0" }
        val gruppeNull = quelle.substringAfter("fun MehrGruppeInhalt(").substringAfter("0 ->")
        val erste = Regex("""MehrEintrag\(R\.string\.(\w+)""").find(gruppeNull)?.groupValues?.get(1)
        assert(erste == "vouchers_title") {
            "Der erste Eintrag der Seite Mehr fuehrt zu $erste statt zu den " +
                "GUTSCHEINEN — dann muss man fuer die Karten wieder suchen."
        }
    }

    /**
     * Die Rubriken liegen NICHT mehr in den Einstellungen.
     *
     * Die Gegenrichtung zur Zusicherung darueber. Ohne sie waere beides
     * gleichzeitig gruen: die Eintraege auf „Mehr“ UND eine vergessene
     * Kopie im Einstellungsbildschirm. Zwei Wege zu derselben Seite sieht man
     * im Quelltext nicht, wohl aber auf dem Bildschirm — und hier gibt es
     * keinen Emulator, in dem das auffiele.
     */
    @Test
    fun `die Einstellungen fuehren nicht mehr selbst zu den Rubriken`() {
        val einst = code(lies("konto/ui/screens/SettingsScreen.kt"))
        for (route in listOf("FinanzZiel.Gutscheine", "KontoZiel.Preisalarme", "KontoZiel.Lagerorte",
                             "KontoZiel.Haushalt", "KontoZiel.CsvImport", "KontoZiel.Konto")) {
            assert(!einst.contains(route)) {
                "SettingsScreen.kt fuehrt noch selbst zu $route — dann gibt es die " +
                    "Rubrik zweimal, auf „Mehr“ und in den Einstellungen."
            }
        }
        assert(!einst.contains("EinstellungsBereich")) {
            "EinstellungsBereich steht noch in den Einstellungen — der Weg ueber " +
                "die Liste ist nicht vollstaendig zurueckgebaut."
        }
    }

    /**
     * Die anderen Repositories legen Antworten auf der Platte ab. Eine Liste mit
     * Nummern und PINs gehört dort nicht hin, auch nicht für fünf Minuten.
     */
    @Test
    fun `die Liste wird nicht zwischengespeichert`() = mitServer { _, repo, ordner ->
        runBlocking { repo.liste() }
        val abgelegt = ordner.walkTopDown().filter { it.isFile }.filter { it.readText().contains("9876") }.toList()
        assertTrue("Nummer und PIN liegen auf der Platte: $abgelegt", abgelegt.isEmpty())
    }
}

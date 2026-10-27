package ch.brickinventoryapp

import org.junit.Test

/**
 * Gutscheine — LEGO-Geschenkkarten im eigenen Profil.
 *
 * ── Marcos Vorgabe ──────────────────────────────────────────────────────────
 *
 *   „Im Eigenen Profil sollen Lego-Gutscheine mit Gutscheinnummer und Pins und
 *    Betrag hinterlegt werden können. Für die Erfassung soll dies entweder
 *    manuell möglich sein für die 3 Werte oder das PDF des Gutscheins soll
 *    hochgeladen werden können und die App soll daraus die Werte extrahieren.
 *    […] Bitte die Login jeweils nur 1x im Backend bauen. Beide Apps sollen
 *    die gleichen Services des Backends verwenden."
 *
 * ── Was dieser Test prueft, und was NICHT ───────────────────────────────────
 *
 * Er liest Quelltext. Was die Routen TUN — wer welchen Gutschein sehen darf,
 * wie aus dem PDF die drei Werte werden —, prueft der Server gegen eine echte
 * Datenbank (Web-App/test/gutscheine-db.test.js) und braucht hier keine
 * zweite, schwaechere Fassung.
 *
 * Hier steht die eine Aussage, die NUR auf dieser Seite nachweisbar ist: dass
 * die App dieselben Dienste benutzt und keine eigenen baut. Genau das war
 * Marcos Vorgabe, und genau das laeuft erfahrungsgemaess auseinander.
 */
class GutscheineContractTest {

    private fun lies(rel: String): String {
        val f = java.io.File(rel)
        assert(f.exists()) { "Datei nicht gefunden: $rel" }
        return f.readText()
    }

    /** Kommentare ausblenden — die Erklaertexte nennen die geprueften Muster selbst. */
    private fun code(src: String) = src.lines().joinToString("\n") { z ->
        if (z.trim().startsWith("//") || z.trim().startsWith("*")) "" else z
    }

    private val api by lazy { code(lies("src/main/java/ch/brickinventoryapp/data/api/BrickApiService.kt")) }
    private val repo by lazy { code(lies("src/main/java/ch/brickinventoryapp/data/repository/GutscheineRepository.kt")) }
    private val feature by lazy { code(lies("src/main/java/ch/brickinventoryapp/ui/viewmodel/GutscheinViewModel.kt")) }
    private val karte by lazy { code(lies("src/main/java/ch/brickinventoryapp/ui/screens/GutscheineCard.kt")) }

    @Test
    fun `die App ruft dieselben Adressen wie die Webapp`() {
        // Marcos Vorgabe woertlich: EIN Dienst im Backend, beide Apps daran.
        // Der Server hat genau einen Router dafuer (routes/api_v1/vouchers.ts);
        // stuenden hier andere Adressen, gaebe es zwei Umsetzungen.
        for (adresse in listOf(
            "api/v1/vouchers",
            "api/v1/vouchers/{id}",
            "api/v1/vouchers/pdf",
        )) {
            assert(api.contains("\"$adresse\"")) {
                "Die Adresse $adresse fehlt — dann ruft die App etwas anderes als die Webapp."
            }
        }
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
        // Marcos Vorgabe: „Wenn ich in der Android-App den Gutscheincode oder
        // den Pin anklicke, soll dieser kopiert werden."
        assert(karte.contains("clickable(role = Role.Button) { onKopieren(g.number, true) }")) {
            "Die Gutscheinnummer laesst sich nicht durch Antippen kopieren."
        }
        assert(karte.contains("clickable(role = Role.Button) { onKopieren(g.pin, false) }")) {
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
        // Marcos Vorgabe: „Das Feld ‚Notiz' bitte vollständig inkl. Spalten
        // auf der Datenbank entfernen." Ein Rest in der App waere eine Zeile,
        // die der Server gar nicht mehr beantwortet.
        for (datei in listOf(karte, feature)) {
            assert(!datei.contains("notiz") && !datei.contains(".note")) {
                "In der App steht noch eine Notiz am Gutschein."
            }
        }
    }

    /**
     * Die Gutscheine stehen als ERSTES in den Einstellungen.
     *
     * Marco: „Kannst du in der Android-App auch noch gleich die Gutscheine in
     * den Einstellungen ganz an den Anfang verschieben?"
     *
     * Eine Reihenfolge ist das, was beim naechsten Einbau still verrutscht:
     * Wer etwas Neues hinzufuegt, setzt es oben hin, weil dort Platz ist — und
     * niemand merkt es, bis Marco wieder rollen muss.
     *
     * ── Was sich am 16.10. geaendert hat ────────────────────────────────────
     *
     * Bis dahin war es die erste KARTE einer sehr langen Rolle. Seit Marcos
     * Befund („Generell wirkt dieser Dialog überladen […] Evtl. Auch Elemente
     * aus den Einstellungen in eine eigene Sicht verschieben?") standen die
     * Rubriken als Liste da, und die Gutscheine waren deren erster Eintrag.
     *
     * ── Und am 17.10. ───────────────────────────────────────────────────────
     *
     * „in der Android-App sollten die Punkte unter Einstellungen eine ebene
     * nach aussen wandern wo heute Einstellungen und Abmelden und Monitoring
     * zu finden sind." Die Liste ist damit ganz aus den Einstellungen heraus
     * und sitzt in der Konto-Klappe (MainScaffold.kt).
     *
     * Die Zusicherung ist DIESELBE geblieben — „ohne Suchen erreichbar" —,
     * nur ihr Ort ist zum zweiten Mal umgezogen: erste Karte, erste Zeile,
     * jetzt erster Eintrag der Klappe. Geprueft wird weiterhin die
     * REIHENFOLGE und nicht bloss das Vorkommen: Eine Pruefung auf Vorkommen
     * waere auch an letzter Stelle gruen.
     */
    @Test
    fun `die Gutscheine stehen ganz oben im Konto-Menue`() {
        val rumpf = code(lies("src/main/java/ch/brickinventoryapp/MainScaffold.kt"))
            .substringAfter("DropdownMenu(showLogoutMenu")
        val erste = Regex("""MenuZiel\(R\.string\.(\w+)""").find(rumpf)?.groupValues?.get(1)
        assert(erste == "vouchers_title") {
            "Der erste Eintrag der Konto-Klappe fuehrt zu $erste statt zu den " +
                "GUTSCHEINEN — dann muss Marco fuer seine Karten wieder suchen."
        }
    }

    /**
     * Die Rubriken liegen NICHT mehr in den Einstellungen.
     *
     * Die Gegenrichtung zur Zusicherung darueber. Ohne sie waere beides
     * gleichzeitig gruen: die Eintraege in der Klappe UND eine vergessene
     * Kopie im Einstellungsbildschirm. Zwei Wege zu derselben Seite sieht man
     * im Quelltext nicht, wohl aber auf dem Bildschirm — und hier gibt es
     * keinen Emulator, in dem das auffiele.
     */
    @Test
    fun `die Einstellungen fuehren nicht mehr selbst zu den Rubriken`() {
        val einst = code(lies("src/main/java/ch/brickinventoryapp/ui/screens/SettingsScreen.kt"))
        for (route in listOf("Screen.Gutscheine", "Screen.Preisalarme", "Screen.Lagerorte",
                             "Screen.Haushalt", "Screen.CsvImport", "Screen.Konto")) {
            assert(!einst.contains(route)) {
                "SettingsScreen.kt fuehrt noch selbst zu $route — dann gibt es die " +
                    "Rubrik zweimal, in der Klappe und in den Einstellungen."
            }
        }
        assert(!einst.contains("EinstellungsBereich")) {
            "EinstellungsBereich steht noch in den Einstellungen — der Weg ueber " +
                "die Liste ist nicht vollstaendig zurueckgebaut."
        }
    }

    @Test
    fun `die Liste wird nicht zwischengespeichert`() {
        // Die anderen Repositories legen Antworten im ResponseCache ab — der
        // liegt auf der Platte. Eine Liste mit Nummern und PINs gehoert dort
        // nicht hin, auch nicht fuer fuenf Minuten.
        assert(!repo.contains("cached(")) {
            "Die Gutscheinliste landet im Plattencache. Dort stehen dann Nummer " +
                "und PIN — zusammen alles, was zum Einloesen noetig ist."
        }
    }
}

package ch.brickinventoryapp

import org.junit.Test

/**
 * Ein Zustandsfluss ist so teuer wie die Zahl seiner Sammler.
 *
 * ── Der Befund (Nachtrag: Galerie-Aufteilung) ───────────────────────────────
 *
 * NACHGEMESSEN, nicht vermutet: SECHZEHN Dateien sammeln `vm.state`. Die zehn
 * Galerie-Felder darin — `sets`, die vier Filter, `galleryTotal`,
 * `galleryPage`, `galleryLoadingMore`, `stats`, `gallerySearchFoundSetNumber` —
 * wurden von DREIEN gelesen (GalleryScreen, CollectionGraph, SetDetailScreen).
 *
 * In Compose rekomponiert ein Sammler bei JEDER Aenderung seines Flusses, egal
 * welches Feld sich geaendert hat. Jedes Blaettern, jede Suche und jedes
 * Nachladen der Galerie zog also dreizehn Bildschirme mit, die kein einziges
 * dieser Felder lesen: Minifiguren, Finanzen, Einstellungen, Teile, die
 * Navigationsleiste.
 *
 * Und gerade die Galerie ist der lauteste Zustand: `galleryLoadingMore` wird an
 * fuenf Stellen geschrieben, `sets` an sechs.
 *
 * ── Was dieser Test festhaelt ───────────────────────────────────────────────
 *
 * Drei Regeln, von der engsten zur allgemeinsten:
 *
 *   1. Die zehn Galerie-Felder bleiben aus `AppUiState` heraus. Namentlich,
 *      weil ein Rueckfall genau hier passiert — beim naechsten Feld, das
 *      „schnell noch" in den gemeinsamen Zustand wandert.
 *   2. `AppUiState` waechst nicht wieder. Die Obergrenze ist der heutige Stand;
 *      wird sie erreicht, ist das das Signal fuer den naechsten Schnitt, nicht
 *      fuer eine hoehere Zahl.
 *   3. Wer einen Fluss sammelt, benutzt ihn auch. Ein Sammler, der seinen
 *      Zustand nirgends verwendet, rekomponiert ausschliesslich umsonst.
 *
 * Nicht ausfuehrbar in dieser Pruefumgebung: Kotlin laesst sich hier nicht
 * uebersetzen (dl.google.com 403). Die Regeln wurden vor dem Einchecken in
 * einer Nachbildung gegengeprobt; die Uebersetzung weist die Action nach.
 */
class ZustandsflussBreiteTest {

    private val uiState = Quellen.lies("ui/UiState.kt")

    /** Feldnamen einer Zustands-Datenklasse. */
    private fun felder(klasse: String): List<String> {
        val m = Regex("""data class $klasse\((.*?)\n\)""", RegexOption.DOT_MATCHES_ALL).find(uiState)
        checkNotNull(m) { "$klasse nicht gefunden — Muster veraltet?" }
        return Regex("""val\s+(\w+)\s*:""").findAll(m.groupValues[1]).map { it.groupValues[1] }.toList()
    }

    @Test
    fun `die Galerie-Felder bleiben aus dem gemeinsamen Zustand heraus`() {
        val galerie = felder("GalleryUiState")
        assert(galerie.size >= 8) { "Nur ${galerie.size} Felder in GalleryUiState — Muster veraltet?" }

        val gemeinsam = felder("AppUiState").toSet()
        val rueckfall = galerie.filter { it in gemeinsam }
        assert(rueckfall.isEmpty()) {
            "Diese Galerie-Felder stehen wieder in AppUiState: ${rueckfall.joinToString()}.\n" +
                "AppUiState wird von sechzehn Dateien gesammelt; jede Aenderung daran " +
                "rekomponiert alle sechzehn. Genau deshalb sind sie herausgezogen worden."
        }
    }

    @Test
    fun `der gemeinsame Zustand waechst nicht wieder`() {
        // 15 ist der Stand nach der Aufteilung, nicht eine Wunschzahl. Wer hier
        // aufschlaegt, hat die Wahl zwischen „gehoert das wirklich allen?" und
        // dem naechsten Schnitt — nicht zwischen 15 und 16.
        val n = felder("AppUiState").size
        assert(n <= 15) {
            "AppUiState hat $n Felder (erlaubt: 15). Jedes zusaetzliche Feld wird von " +
                "sechzehn Dateien gesammelt, auch von denen, die es nie lesen. Gehoert es " +
                "wirklich allen — oder ist es der Anfang der naechsten Domaene?"
        }
    }

    @Test
    fun `wer einen Fluss sammelt, benutzt ihn auch`() {
        // Ein Sammler, der kein Feld liest, rekomponiert ausschliesslich
        // umsonst. Das ist der allgemeine Fall des Befunds oben — und der
        // einzige, der sich ohne Kenntnis der Aenderungshaeufigkeit hart
        // pruefen laesst.
        val fluesse = Quellen.zustandsFluesse()          // galleryState → GalleryUiState
        assert(fluesse.isNotEmpty()) { "Keine Zustandsfluesse gefunden — Muster veraltet?" }

        val blind = mutableListOf<String>()
        var geprueft = 0
        for (datei in Quellen.alle()) {
            val s = Quellen.ohneKommentare(datei.readText())
            Regex("""\bval\s+(\w+)\s+by\s+vm\.(\w+)\.collectAsStateWithLifecycle""")
                .findAll(s).forEach { m ->
                    val name = m.groupValues[1]
                    if (m.groupValues[2] !in fluesse) return@forEach
                    geprueft++
                    // ── Warum „benutzt" und nicht „liest ein Feld" ──────────
                    // Der erste Entwurf verlangte einen Feldzugriff `name.feld`
                    // und meldete damit SettingsScreen: Der Bildschirm sammelt
                    // `household` und reicht es als GANZES weiter
                    // (`state = household`), ohne selbst ein Feld zu lesen. Das
                    // ist voellig richtig so — und ein Test, der korrekten Code
                    // anmeckert, wird abgeschaltet statt befolgt (siehe den
                    // gleichlautenden Hinweis in Quellen.kt).
                    //
                    // Geprueft wird deshalb das Schwaechere, aber Zutreffende:
                    // Der gesammelte Zustand muss ueberhaupt irgendwo benutzt
                    // werden. Das faengt weiterhin den einzigen Fall, der immer
                    // falsch ist — sammeln und gar nicht verwenden.
                    val benutzt = Regex("""\b$name\b""").findAll(s).count() > 1
                    if (!benutzt) blind += "${datei.name}: $name (${m.groupValues[2]})"
                }
        }
        assert(geprueft >= 10) { "Nur $geprueft Sammelstellen gefunden — Muster veraltet?" }
        assert(blind.isEmpty()) {
            "Diese Stellen sammeln einen Zustandsfluss, benutzen ihn aber nirgends — " +
                "sie rekomponieren bei jeder Aenderung, ohne etwas davon zu zeigen:\n  " +
                blind.joinToString("\n  ")
        }
    }
}

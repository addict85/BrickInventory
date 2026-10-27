package ch.brickinventoryapp

import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Der Suchtext filtert BEIDE Abschnitte eines Bildschirms — App-Seite.
 *
 * ── Marcos Befund vom 20.10. ────────────────────────────────────────────────
 *
 *   „Wenn ich im Filter z.b. nach 3001 suche passiert nichts."
 *
 * Gemeldet hat er es an der Webapp (dort NACHGEMESSEN: nach der Eingabe
 * standen dieselben zwei Kacheln da wie vorher). Die App trug dieselbe Luecke:
 * PartsScreen.kt hat EIN Suchfeld, und die LazyVerticalGrid darunter zeigt
 * erst den Abschnitt „Manuell erfasst" und dann die Set-Teile. Der Text ging
 * nur an /api/v1/parts; /api/v1/parts/manual bekam allein den Kontofilter.
 * MinifigsScreen.kt ist genauso gebaut.
 *
 * ── Was hier geprueft wird und was NICHT ────────────────────────────────────
 *
 * Dass die Abfrage richtig filtert, prueft der Server gegen eine echte
 * Datenbank: Web-App/test/manuelle-listen-filter-db.test.js. Hier steht die
 * Aussage, die nur auf DIESER Seite nachweisbar ist: Der Suchtext, den der
 * Bildschirm schon hat, reist auch an die manuelle Liste mit — ueber alle drei
 * Schichten, von der Dienstbeschreibung bis zum Aufruf.
 *
 * Der Lagerortfilter gehoert bei den TEILEN dazu (er steht in derselben
 * Filterzeile), bei den FIGUREN nicht: Den gibt es dort in keiner der beiden
 * Oberflaechen (LAGER_VIEWS in public/js/14-scope.js nennt Galerie und Teile).
 *
 * ── Gegenproben (am 20.10. GEMESSEN) ────────────────────────────────────────
 *
 * Kotlin laesst sich in dieser Umgebung nicht uebersetzen (kein Android-SDK,
 * dl.google.com ist gesperrt), die Uebersetzung macht die CI. Die SUCHMUSTER
 * sind deshalb einzeln gegen die echten Dateien nachgerechnet worden, jedes
 * mit seiner Gegenprobe:
 *
 * Nachgerechnet wurde mit einer Nachbildung der vier Faelle in Python (dieselbe
 * Schnitt- und Suchlogik, dieselben Dateien), jede Aenderung einzeln und danach
 * zurueckgenommen; am Ende stand wieder „alle vier Faelle gruen".
 *
 *   A  `@Query("search")` aus getManualParts in BrickApiService.kt entfernt
 *      → nur Fall 1 rot, an der Zusicherung „Die Dienstbeschreibung von
 *        getManualParts kennt keinen Suchtext".
 *   B  `search` aus dem Aufruf `api.getManualParts(…)` in TeileRepository.kt
 *      entfernt → nur Fall 2 rot.
 *   C  `suche` aus dem Aufruf `repo.teile.getManualParts(…)` in
 *      PartsFeature.kt entfernt (der Lagerort blieb, als benannter Parameter)
 *      → nur Fall 3 rot, an „schickt den Suchtext nicht".
 *   D  `suche` aus dem Aufruf von getManualMinifigs entfernt
 *      → nur Fall 4 rot.
 */
class ManuelleListenFilterTest {

    private val api by lazy {
        Quellen.ohneKommentare(Quellen.lies("data/api/BrickApiService.kt"))
    }
    private val repo by lazy {
        Quellen.ohneKommentare(Quellen.lies("data/repository/TeileRepository.kt"))
    }
    // Die Abrufe stehen dort, wo das MainViewModel die Teile-Quelle baut;
    // dass der Suchtext dort ankommt, prüft TeileTest am Ablauf.
    private val feature by lazy {
        Quellen.ohneKommentare(Quellen.lies("ui/MainViewModel.kt"))
    }

    /**
     * Der Abschnitt von `ab` bis `bis` — nach BEGRENZERN geschnitten, nicht
     * nach einer Zeichenzahl.
     *
     * Quellen.kt schreibt aus, warum: Ein festes Fenster (`substring(i, i+400)`)
     * ist in dieser Reihe viermal gebrochen, sobald ein Kommentar wuchs. Ein
     * `[^)]*` im regulaeren Ausdruck waere hier derselbe Fehler in anderer
     * Form — die Parameterliste enthaelt selbst Klammern (`@Query("accounts")`).
     */
    private fun abschnitt(src: String, ab: String, bis: String): String {
        val i = src.indexOf(ab)
        if (i < 0) return ""
        val j = src.indexOf(bis, i + ab.length)
        return if (j < 0) src.substring(i) else src.substring(i, j)
    }

    @Test
    fun `die Dienstbeschreibung nimmt Suchtext und Lagerort`() {
        val teile = abschnitt(api, "fun getManualParts(", "): Response")
        assertTrue(
            "Die Dienstbeschreibung von getManualParts kennt keinen Suchtext — " +
                "dann kann die App ihn nicht mitschicken, und die manuellen Kacheln " +
                "bleiben beim Suchen stehen (Marcos Befund).",
            teile.contains("@Query(\"search\")")
        )
        assertTrue(
            "getManualParts kennt keinen Lagerort — er steht in derselben " +
                "Filterzeile wie der Suchtext und gehoert zum gleichen Versprechen.",
            teile.contains("@Query(\"storage\")")
        )
        assertTrue(
            "Die Dienstbeschreibung von getManualMinifigs kennt keinen Suchtext — " +
                "derselbe Aufbau wie bei den Teilen, dieselbe Luecke.",
            abschnitt(api, "fun getManualMinifigs(", "): Response")
                .contains("@Query(\"search\")")
        )
    }

    @Test
    fun `das Repository reicht beide Filter durch`() {
        assertTrue(
            "TeileRepository ruft api.getManualParts ohne Suchtext und Lagerort — " +
                "die Parameter der Dienstbeschreibung waeren damit nur Zierde.",
            abschnitt(repo, "api.getManualParts(", ")").let {
                it.contains("search") && it.contains("storage")
            }
        )
        assertTrue(
            "TeileRepository ruft api.getManualMinifigs ohne Suchtext.",
            abschnitt(repo, "api.getManualMinifigs(", ")").contains("search")
        )
    }

    @Test
    fun `die Teileliste schickt Suchtext und Lagerort an die manuelle Liste`() {
        val aufruf = abschnitt(feature, "repo.teile.getManualParts(", ")")
        assertTrue(
            "Der Aufruf von getManualParts schickt den Suchtext nicht — genau das " +
                "war der Zustand, den Marco gemeldet hat: Der Text filtert die " +
                "Set-Teile, die manuellen Kacheln darueber bleiben stehen.",
            aufruf.contains("suche")
        )
        assertTrue(
            "Der Aufruf von getManualParts schickt den Lagerort nicht — dann " +
                "waere der Filter halb angewandt: unten gefiltert, oben nicht.",
            aufruf.contains("teileLager") && feature.contains("teileLager get() = lagerFor(")
        )
    }

    @Test
    fun `die Figurenliste schickt den Suchtext an die manuelle Liste`() {
        assertTrue(
            "Der Aufruf von getManualMinifigs schickt den Suchtext nicht. Marco hat " +
                "es an den Teilen gesehen; dieser Bildschirm trug es unbemerkt mit.",
            abschnitt(feature, "repo.teile.getManualMinifigs(", ")")
                .contains("suche")
        )
    }
}

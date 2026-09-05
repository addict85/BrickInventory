package ch.brickinventoryapp

import org.junit.Test

/**
 * Der Name der Release-APK steht an genau EINER Stelle.
 *
 * ── Woher das kommt ─────────────────────────────────────────────────────────
 * Im Protokoll eines grünen Laufs lagen im Ausgabeordner nebeneinander:
 *
 *     app-release.apk        46483681
 *     Brickinventory.apk     46483681      ← von Gradle
 *     (danach) BrickInventory.apk          ← vom Workflow
 *
 * Zwei Fassungen derselben Regel, in zwei Schreibweisen: `build.gradle.kts`
 * legte eine Kopie unter „Brickinventory.apk" ab, der Workflow benannte
 * anschliessend `app-release.apk` in „BrickInventory.apk" um. Auf Linux sind
 * das zwei Dateien. Hochgeladen wurde nur die des Workflows — die Gradle-Kopie
 * war totes Gewicht, und die README nannte an einer Stelle den einen Namen, an
 * zwei anderen den anderen.
 *
 * Auffällig ist es nie geworden, weil beide Wege funktionierten. Genau das ist
 * das Kennzeichen dieser Fehlerklasse: Zwei Fassungen einer Regel fallen nicht
 * auf, solange sie zufällig dasselbe wollen. Sie fallen auf, wenn eine geändert
 * wird — dann arbeitet die andere still weiter.
 *
 * Schwerer wog, was die zweite Fassung TAT: Der Workflow verschob (`mv`) genau
 * die Original-APK, die der Kommentar in `build.gradle.kts` ausdrücklich stehen
 * lässt, damit nachgelagerte Schritte sie noch finden. Dass das gut ging, lag
 * allein an der Reihenfolge der Schritte.
 *
 * Jetzt vergibt Gradle den Namen, und der Workflow sieht nur nach. Dieser Test
 * hält fest, dass es dabei bleibt.
 *
 * ── Gegenprobe (ausgeführt, Lauf 33634274161) ───────────────────────────────
 * `build.gradle.kts` schrieb wieder „Brickinventory.apk" — also der Stand von
 * vorher. Ergebnis: `354 tests completed, 1 failed`, und zwar
 * `ApkNameTest > Gradle und Workflow meinen dieselbe Datei`.
 *
 * Die beiden anderen Regeln blieben grün, weil sie nicht gebrochen waren. Das
 * ist der Punkt: Ein Test, der bei jedem Bruch anschlägt, sagt nicht, welcher
 * es war.
 *
 * Die Muster hier haben vorher zwei eigene Fehler gehabt, beide von einem
 * örtlichen Spiegel gefunden statt von einem zehnminütigen Lauf:
 *   - `File(dir, "…")` fand DREI „Zielnamen", weil daneben die Quellnamen von
 *     AGP in derselben Schreibweise stehen. Jetzt `val target = File(dir, …)`.
 *   - Der Erklärabsatz im Workflow nennt die alte Schreibweise zwangsläufig und
 *     war damit selbst der Verstoss. Kommentarzeilen werden ausgeblendet.
 * Die dritte Regel ist ihrer eigenen Gegenprobe zunächst NICHT standgehalten:
 * Sie mass `indexOf` über die ganze Datei und traf den Kommentar, nicht den
 * Code — bei umgedrehter Reihenfolge blieb sie grün. Jetzt misst sie im
 * Ausdruck.
 */
class ApkNameTest {

    private val bauskript = java.io.File("build.gradle.kts")

    /**
     * Der Workflow liegt ausserhalb des Gradle-Moduls. Der Pfad wird deshalb
     * geprüft, nicht angenommen: Eine fehlende Datei würde die Prüfungen unten
     * sonst stillschweigend bestehen lassen — dieselbe Falle wie bei einem
     * Dateilauf, der nichts findet (Nachtrag 118).
     *
     * Er steht seit Lauf 131 in Quellen.workflow() statt hier: SelbstUpdateTest
     * schrieb ihn ein zweites Mal aus, eine Ebene zu kurz. Eine Pfadangabe in
     * zwei Schreibweisen ist dieselbe Fehlerart wie eine Regel in zwei Kopien.
     */
    private fun workflow(): String = Quellen.workflow()

    /**
     * Der Zielname, den `build.gradle.kts` vergibt.
     *
     * Gesucht wird `val target = File(dir, "…")`, nicht jedes `File(dir, …)`:
     * Daneben stehen die QUELLnamen von AGP (app-release.apk und
     * app-release-unsigned.apk) in derselben Schreibweise. Das breitere Muster
     * fand drei „Zielnamen" und war damit nutzlos.
     */
    private fun zielname(): String {
        val treffer = Regex("""val target = File\(dir,\s*"([^"]+\.apk)"\)""")
            .findAll(bauskript.readText()).toList()
        assert(treffer.size == 1) {
            "In build.gradle.kts stehen ${treffer.size} APK-Zielnamen " +
                "(${treffer.joinToString { it.groupValues[1] }}). Genau einer gehört dorthin."
        }
        return treffer[0].groupValues[1]
    }

    @Test
    fun `Gradle und Workflow meinen dieselbe Datei`() {
        // Gegenprobe: mit "Brickinventory.apk" (kleines i) in build.gradle.kts —
        // also dem Stand von vorher — schlägt dieser Test fehl.
        val ziel = zielname()
        val wf = workflow()

        // Die Standardnamen von AGP sind kein Verstoss: Sie beschreiben, was
        // gebaut WIRD, nicht wie die Datei am Ende heisst.
        val agp = setOf("app-release.apk", "app-release-unsigned.apk", "app-debug.apk")
        val imWorkflow = Regex("""[\w.-]+\.apk""").findAll(wf).map { it.value }.toSet() - agp

        assert(imWorkflow.isNotEmpty()) {
            "Der Workflow nennt gar keinen APK-Namen mehr — dann lädt er nichts hoch, " +
                "oder das Muster hier ist veraltet."
        }
        assert(imWorkflow == setOf(ziel)) {
            "Gradle legt \"$ziel\" ab, der Workflow spricht von " +
                imWorkflow.joinToString(", ") { "\"$it\"" } +
                ". Auf Linux sind das verschiedene Dateien — schon ein Buchstabe genügt."
        }
    }

    @Test
    fun `der Workflow benennt keine APK mehr um`() {
        // Gegenprobe: ein wieder eingefügtes `mv app-release.apk …` macht diesen
        // Test rot.
        //
        // Ein zweites Umbenennen wäre nicht nur ein doppelter Name: Es verschiebt
        // die Original-APK, auf die output-metadata.json zeigt und die
        // nachgelagerte Schritte noch erwarten.
        val wf = workflow()
        val umbenennen = Regex("""^\s*(mv|cp)\s+\S*\.apk\s""", RegexOption.MULTILINE).find(wf)
        assert(umbenennen == null) {
            "Der Workflow verschiebt oder kopiert wieder selbst eine APK " +
                "(\"${umbenennen?.value?.trim()}\"). Den Namen vergibt Gradle — " +
                "zwei Stellen dafür sind eine Stelle zu viel."
        }
    }

    /**
     * Der Workflow, zerlegt in seine Schritte.
     *
     * Getrennt wird am Einzug: Ein Schritt beginnt mit sechs Leerzeichen und
     * `- `. In den `run:`-Bloecken steht alles tiefer, dort trifft das Muster
     * nicht. Kommentarzeilen sind ueber workflow() schon draussen.
     *
     * Gezaehlt wird erst AB `steps:` — die `paths:`-Listen unter `on:` haben
     * denselben Einzug. Der oertliche Spiegel hat das gemeldet: 20 „Schritte"
     * bei 15. Eine Zahl, die etwas anderes zaehlt als sie behauptet, taugt
     * auch als Selbstbeweis nichts.
     */
    private fun schritte(): List<String> {
        val ganz = workflow()
        val ab = ganz.indexOf("\n    steps:")
        assert(ab >= 0) { "Der Abschnitt `steps:` ist in android.yml nicht mehr zu finden" }
        val teile = ganz.substring(ab).split(Regex("""^      - """, RegexOption.MULTILINE))
        assert(teile.size >= 10) {
            "Nur ${teile.size - 1} Schritte gefunden — Einzug im Workflow geaendert? " +
                "Ein Muster, das nichts findet, laesst jede Pruefung darunter still bestehen."
        }
        return teile.drop(1)
    }

    @Test
    fun `das APK wird roh ausgeliefert, nicht als Zip`() {
        // ── Marcos Wunsch ───────────────────────────────────────────────────
        // „am Ende kein zip, sondern direkt das BrickInventory.apk".
        //
        // Als Artefakt geht das NICHT, und das ist keine Einstellungssache —
        // nachgelesen in der Anleitung von actions/upload-artifact:
        //
        //   "When an Artifact is uploaded, all the files are assembled into an
        //    immutable Zip archive. There is currently no way to download
        //    artifacts in a format other than a Zip [...]"
        //
        // Wer die APK also wieder an einen upload-artifact-Schritt haengt,
        // bekommt zwangslaeufig wieder ein Zip — ohne dass irgendwo eine
        // Fehlermeldung stuende. Genau davor steht diese Pruefung.
        //
        // Gesucht, nicht aufgezaehlt: JEDER Artefaktschritt wird angesehen,
        // auch ein kuenftiger.
        val ziel = zielname()
        val alle = schritte()

        val artefakte = alle.filter { it.contains("upload-artifact") }
        // Selbstbeweis: Ohne Artefaktschritte prueft die Bedingung darunter
        // nichts und waere immer gruen. Der Workflow hat welche (Testberichte,
        // Bundle) — findet das Muster keine, ist es veraltet.
        assert(artefakte.isNotEmpty()) {
            "Kein einziger upload-artifact-Schritt gefunden — Muster veraltet?"
        }
        val gezippt = artefakte.filter { it.contains(ziel) }
        assert(gezippt.isEmpty()) {
            "$ziel haengt wieder an einem Artefakt und kommt damit nur als Zip " +
                "heraus. Als Release-Anhang wird dieselbe Datei roh ausgeliefert."
        }

        val roh = alle.filter { it.contains("gh release upload") && it.contains(ziel) }
        assert(roh.size == 1) {
            "Der Schritt, der $ziel als Release-Anhang bereitstellt, steht " +
                "${roh.size}-mal im Workflow. Ohne ihn gibt es keinen direkten " +
                "Download; zweimal waere dieselbe Regel an zwei Stellen."
        }
        // Ein Pull-Request darf die Datei hinter dem stabilen Link NICHT
        // ersetzen — sonst zeigt er auf einen ungeprueften Zweig.
        assert(roh[0].contains("github.event_name != 'pull_request'")) {
            "Der Release-Schritt laeuft auch bei Pull-Requests und ueberschreibt " +
                "damit das APK hinter dem stabilen Link."
        }
    }

    @Test
    fun `Gradle bevorzugt die signierte APK`() {
        // Warum das hier steht: Die Kopie heisst in beiden Fällen gleich, der
        // Unterschied steckt allein im Quellnamen. Lagen nach einem Wechsel der
        // Schlüssel beide Dateien im Ordner, entschied vorher der Zeitstempel —
        // also der Zufall. Ein unsigniertes APK lässt sich nicht installieren.
        // Gemessen wird im AUSDRUCK, nicht in der Datei: Der Erklärabsatz
        // weiter oben nennt „app-release.apk" ebenfalls und steht vor beidem.
        // Der erste Entwurf hat genau das gemessen und blieb bei umgedrehter
        // Reihenfolge grün — eine Prüfung, die den Kommentar liest statt den
        // Code, prüft nichts.
        val src = bauskript.readText()
        val anfang = src.indexOf("val built =")
        assert(anfang >= 0) { "Der Ausdruck `val built =` steht nicht mehr in build.gradle.kts" }
        val ende = src.indexOf("if (built != null)", anfang)
        assert(ende > anfang) { "Das Ende des Ausdrucks ist nicht mehr zu finden" }
        val ausdruck = src.substring(anfang, ende)

        val signiert = ausdruck.indexOf("app-release.apk")
        val unsigniert = ausdruck.indexOf("app-release-unsigned.apk")
        assert(signiert >= 0 && unsigniert >= 0) {
            "Der Ausdruck unterscheidet signiert und unsigniert nicht mehr"
        }
        assert(signiert < unsigniert) {
            "Die unsignierte APK wird vor der signierten geprüft — dann gewinnt " +
                "die falsche, sobald beide im Ordner liegen."
        }
    }
}

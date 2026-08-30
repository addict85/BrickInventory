package ch.brickinventoryapp

import org.junit.Test
import java.io.File

/**
 * Suchmuster in Tests müssen im App-Code auch wirklich vorkommen.
 *
 * ── Woher dieser Test kommt ────────────────────────────────────────────────
 * Beim Aufteilen von BrickRepository in Sachgebiete wurden aus `repo.addSet(`
 * Aufrufe wie `repo.sets.addSet(`. Zwei Tests suchten den alten Namen — aber
 * mit maskiertem Punkt (`repo\.addSet\(`), weshalb die Umstellung sie nicht
 * erwischte. Beide Tests wurden grün-blind: Ihre Muster fanden nichts mehr,
 * das positive Muster fiel auf 0 Treffer und der Lauf war rot, ohne dass am
 * App-Code irgendetwas fehlte.
 *
 * Das ist die eigentliche Gefahr an quelltextlesenden Tests: Sie prüfen eine
 * Zeichenkette, und eine Zeichenkette veraltet lautlos. Ein `!contains(...)`
 * ist dann sogar dauerhaft grün und prüft in Wahrheit gar nichts mehr.
 *
 * Deshalb diese Wache: Jedes `repo.…(` das in einer TEST-ZEICHENKETTE steht,
 * muss im App-Code vorkommen. Nur Zeichenketten — echte Kotlin-Aufrufe wie
 * `repo.getMe()` in BrickRepositoryErrorMappingTest prüft schon der
 * Übersetzer, und Kommentare dürfen die alte Geschichte weiter erzählen.
 *
 * Gegenprobe (durchgeführt): In AddPathOwnerTest das Muster wieder auf
 * `repo\.addSet\(` zurückgedreht → dieser Test meldet genau diesen Verweis.
 */
class RepoVerweiseInTestsTest {

    /** Kommentarzeilen weg — sie nennen absichtlich frühere Aufrufnamen. */
    private fun ohneKommentare(src: String) = src.lines().joinToString("\n") {
        val t = it.trim()
        if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) "" else it
    }

    /** Zeichenketten-Inhalte: erst dreifach zitierte, dann einfach zitierte. */
    private val literale = Regex("\"\"\"(.*?)\"\"\"|\"((?:[^\"\\\\\\n]|\\\\.)*)\"", RegexOption.DOT_MATCHES_ALL)

    /** `repo.x(`, `repo.y.x(` — mit ein- oder zweifach maskierten Punkten. */
    private val verweis = Regex("""repo(?:\\{1,2}\.|\.)(?:\w+(?:\\{1,2}\.|\.))*\w+\\{0,2}\(""")

    private fun dateien(pfad: String) = File(pfad).walkTopDown()
        .filter { it.isFile && it.extension == "kt" }.toList()

    private fun verweiseIn(src: String): Set<String> {
        val roh = ohneKommentare(src)
        return literale.findAll(roh)
            .map { it.groupValues[1].ifEmpty { it.groupValues[2] } }
            .flatMap { lit -> verweis.findAll(lit).map { it.value } }
            // Maskierung aufheben: `repo\.sets\.addSet\(` → `repo.sets.addSet(`
            .map { it.replace("\\\\", "").replace("\\", "") }
            .toSet()
    }

    @Test
    fun `kein Test sucht nach einem Repository-Aufruf den es nicht mehr gibt`() {
        val appCode = dateien("src/main/java/ch/brickinventoryapp")
            .joinToString("\n") { it.readText() }
        assert(appCode.contains("repo.sets.addSet(")) {
            "Der App-Code wurde nicht gelesen — dieser Test prüfte sonst gegen Leere"
        }

        val tote = mutableListOf<String>()
        for (datei in dateien("src/test/java/ch/brickinventoryapp")) {
            if (datei.name == "RepoVerweiseInTestsTest.kt") continue // eigene Beispiele
            for (v in verweiseIn(datei.readText())) {
                if (!appCode.contains(v)) tote += "${datei.name}: $v"
            }
        }
        assert(tote.isEmpty()) {
            "Diese Testmuster suchen Aufrufe, die es im App-Code nicht (mehr) gibt. " +
                "Entweder wurde umbenannt und der Test nicht nachgezogen, oder das " +
                "Muster war von Anfang an falsch geschrieben:\n" + tote.joinToString("\n")
        }
    }
}

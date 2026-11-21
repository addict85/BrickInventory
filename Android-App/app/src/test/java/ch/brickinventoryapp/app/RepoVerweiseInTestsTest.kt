package ch.brickinventoryapp.app

import org.junit.Test
import java.io.File
import ch.brickinventoryapp.testing.Quellen

/**
 * Suchmuster in Tests müssen im App-Code auch wirklich vorkommen.
 *
 * Gegenprobe (durchgeführt): In AddPathOwnerTest das Muster wieder auf
 * `repo\.addSet\(` zurückgedreht → dieser Test meldet genau diesen Verweis.
 */
class RepoVerweiseInTestsTest {

    /** Kommentarzeilen weg — sie nennen absichtlich frühere Aufrufnamen. */
    private fun withoutComments(src: String) = src.lines().joinToString("\n") {
        val t = it.trim()
        if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) "" else it
    }

    /** Zeichenketten-Inhalte: erst dreifach zitierte, dann einfach zitierte. */
    private val literale = Regex("\"\"\"(.*?)\"\"\"|\"((?:[^\"\\\\\\n]|\\\\.)*)\"", RegexOption.DOT_MATCHES_ALL)

    /** `repo.x(`, `repo.y.x(` — mit ein- oder zweifach maskierten Punkten. */
    private val reference = Regex("""repo(?:\\{1,2}\.|\.)(?:\w+(?:\\{1,2}\.|\.))*\w+\\{0,2}\(""")

    private fun dateien(folder: File) = folder.walkTopDown()
        .filter { it.isFile && it.extension == "kt" }.toList()

    private fun referencesIn(src: String): Set<String> {
        val roh = withoutComments(src)
        return literale.findAll(roh)
            .map { it.groupValues[1].ifEmpty { it.groupValues[2] } }
            .flatMap { lit -> reference.findAll(lit).map { it.value } }
            // Maskierung aufheben: `repo\.sets\.addSet\(` → `repo.sets.addSet(`
            .map { it.replace("\\\\", "").replace("\\", "") }
            .toSet()
    }

    @Test
    fun `no test searches for a repository call that no longer exists`() {
        val appCode = dateien(Quellen.root)
            .joinToString("\n") { it.readText() }
        assert(appCode.contains("sets.aktualisiereSets(")) {
            "Der App-Code wurde nicht gelesen — dieser Test prüfte sonst gegen Leere"
        }

        val tote = mutableListOf<String>()
        for (datei in dateien(Quellen.tests)) {
            if (datei.name == "RepoVerweiseInTestsTest.kt") continue // eigene Beispiele
            for (v in referencesIn(datei.readText())) {
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

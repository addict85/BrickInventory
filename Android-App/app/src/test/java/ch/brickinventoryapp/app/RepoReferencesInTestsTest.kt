package ch.brickinventoryapp.app

import ch.brickinventoryapp.testing.Sources
import org.junit.Test
import java.io.File

/**
 * Search patterns in tests must really occur in the app code.
 *
 * Counter-check (performed): in AddPathOwnerTest the pattern turned back to
 * `repo\.addSet\(` → this test reports exactly this reference.
 */
class RepoReferencesInTestsTest {

    /** Comment lines out — they deliberately name earlier call names. */
    private fun withoutComments(src: String) = src.lines().joinToString("\n") {
        val t = it.trim()
        if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) "" else it
    }

    /** String contents: triple-quoted first, then single-quoted. */
    private val literals = Regex("\"\"\"(.*?)\"\"\"|\"((?:[^\"\\\\\\n]|\\\\.)*)\"", RegexOption.DOT_MATCHES_ALL)

    /** `repo.x(`, `repo.y.x(` — with singly or doubly escaped dots. */
    private val reference = Regex("""repo(?:\\{1,2}\.|\.)(?:\w+(?:\\{1,2}\.|\.))*\w+\\{0,2}\(""")

    private fun files(folder: File) = folder.walkTopDown()
        .filter { it.isFile && it.extension == "kt" }.toList()

    private fun referencesIn(src: String): Set<String> {
        val raw = withoutComments(src)
        return literals.findAll(raw)
            .map { it.groupValues[1].ifEmpty { it.groupValues[2] } }
            .flatMap { lit -> reference.findAll(lit).map { it.value } }
            // Maskierung aufheben: `repo\.sets\.addSet\(` → `repo.sets.addSet(`
            .map { it.replace("\\\\", "").replace("\\", "") }
            .toSet()
    }

    @Test
    fun `no test searches for a repository call that no longer exists`() {
        val appCode = files(Sources.root)
            .joinToString("\n") { it.readText() }
        assert(appCode.contains("sets.refreshSets(")) {
            "Der App-Code wurde nicht gelesen — dieser Test prüfte sonst gegen Leere"
        }

        val dead = mutableListOf<String>()
        for (file in files(Sources.tests)) {
            if (file.name == "RepoReferencesInTestsTest.kt") continue // own examples
            for (v in referencesIn(file.readText())) {
                if (!appCode.contains(v)) dead += "${file.name}: $v"
            }
        }
        assert(dead.isEmpty()) {
            "Diese Testmuster suchen Aufrufe, die es im App-Code nicht (mehr) gibt. " +
                "Entweder wurde umbenannt und der Test nicht nachgezogen, oder das " +
                "Muster war von Anfang an falsch geschrieben:\n" + dead.joinToString("\n")
        }
    }
}

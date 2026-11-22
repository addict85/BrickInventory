package ch.brickinventoryapp.app

import ch.brickinventoryapp.testing.Sources
import org.junit.Test
import java.io.File

/**
 * Error messages arise in ONE place, and that place can translate.
 *
 * Counter-check: counter-checks/fehler-satz-in-datenschicht.patch — safeCall()
 * puts a fixed sentence into Ergebnis.Fehler.Server → red “the data layer builds
 * no message …”.
 */
class ErrorMessageLayerTest {

    /** The repositories of every area, the shared kernel and the import stream. */
    private val dataLayer: List<String> by lazy {
        listOf("repository", "catalog", "collection", "parts", "finances", "account").flatMap { area ->
            File(Sources.root, "data/$area").listFiles().orEmpty().filter { it.extension == "kt" }.map { "data/$area/${it.name}" }
        }.sorted() + "data/CsvImportSseClient.kt"
    }

    @Test
    fun `the data layer builds no message for the user`() {
        // Searched: a fixed sentence as message — Server(status, "…"), Abgewiesen("…")
        // or message = "…". Allowed is only the empty text — then the display
        // decides — or a passed-through server message (a variable).
        val sentence = Regex("""Outcome\.Failure\.(?:Rejected\(\s*|Server\((?:[^,()]|\([^()]*\))*,\s*)"([^"]+)"|\bmessage\s*=\s*"([^"]+)"""")
        val error = mutableListOf<String>()
        assert(dataLayer.size >= 20) { "Nur ${dataLayer.size} Dateien der Datenschicht — greift die Suche noch?" }
        for (rel in dataLayer) {
            val s = Sources.withoutComments(Sources.read(rel))
            sentence.findAll(s).forEach { m ->
                val row = s.substring(0, m.range.first).count { it == '\n' } + 1
                error += "$rel:$row  ${m.value}"
            }
        }
        assert(error.isEmpty()) {
            "Die Datenschicht formuliert wieder selbst. Sie hat keinen Context und " +
                "kann nicht übersetzen — stattdessen eine Fehlerart melden und den " +
                "Satz in AppTexts.message() bilden:\n  " + error.joinToString("\n  ")
        }
    }

    @Test
    fun `the mapping of cause to text lives outside of meldung`() {
        // Whether every error kind has its own sentence is checked by
        // ErrorTextsTest — executed instead of read. What remains here is only the
        // statement a text search can really hit: that the
        // mapping IS its own, context-free function. If it moves
        // back into message(), it is again only checkable via Android.
        val texts = Sources.withoutComments(Sources.read("state/ui/ErrorTexts.kt"))
        assert(texts.contains("fun errorTextId(")) { "errorTextId() fehlt" }
        assert(!texts.contains("ctx.") && !texts.contains("Context")) {
            "ErrorTexts.kt darf keinen Context brauchen — sonst ist die Zuordnung " +
                "wieder nur mit Android-Laufzeit prüfbar"
        }
        val vm = Sources.withoutComments(Sources.read("state/ui/viewmodel/AppTexts.kt"))
        val message = Sources.function(vm, "override fun message(")
        assert(message.isNotEmpty()) { "message() fehlt in AppTexts" }
        assert(message.contains("errorTextId(")) {
            "message() benutzt die gemeinsame Zuordnung nicht mehr"
        }
    }
}

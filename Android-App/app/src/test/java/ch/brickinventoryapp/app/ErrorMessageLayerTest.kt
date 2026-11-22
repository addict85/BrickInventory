package ch.brickinventoryapp.app

import org.junit.Test
import ch.brickinventoryapp.testing.Sources

/**
 * Error messages arise in ONE place, and that place can translate.
 *
 * Counter-check: counter-checks/fehler-satz-in-datenschicht.patch — safeCall()
 * puts a fixed sentence into Ergebnis.Fehler.Server → red “the data layer builds
 * no message …”.
 */
class ErrorMessageLayerTest {

    private val dataLayer = listOf(
        // All files of the data layer — previously only the one.
        "data/repository/Outcome.kt",
        "data/repository/Fetch.kt",
        "data/repository/SetsRepositoryImpl.kt",
        "data/repository/WantedListRepositoryImpl.kt",
        "data/repository/AlarmRepositoryImpl.kt",
        "data/repository/SetCatalogRepository.kt",
        "data/repository/SetFilesRepository.kt",
        "data/repository/PartsRepositoryImpl.kt",
        "data/repository/FinancesRepositoryImpl.kt",
        "data/repository/HouseholdRepositoryImpl.kt",
        "data/repository/FiguresRepositoryImpl.kt",
        "data/repository/AccountRepositoryImpl.kt",
        "data/repository/AdminRepositoryImpl.kt",
        "data/repository/CatalogRepositoryImpl.kt",
        "data/repository/VouchersRepositoryImpl.kt",
        "data/CsvImportSseClient.kt",
    )

    @Test
    fun `the data layer builds no message for the user`() {
        // Searched: a fixed sentence as message — Server(status, "…"), Abgewiesen("…")
        // or message = "…". Allowed is only the empty text — then the display
        // decides — or a passed-through server message (a variable).
        val sentence = Regex("""Outcome\.Failure\.(?:Rejected\(\s*|Server\((?:[^,()]|\([^()]*\))*,\s*)"([^"]+)"|\bmessage\s*=\s*"([^"]+)"""")
        val error = mutableListOf<String>()
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

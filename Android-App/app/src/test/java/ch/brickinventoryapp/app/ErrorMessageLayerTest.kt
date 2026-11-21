package ch.brickinventoryapp.app

import org.junit.Test
import ch.brickinventoryapp.testing.Quellen

/**
 * Error messages arise in ONE place, and that place can translate.
 *
 * Counter-check: gegenproben/fehler-satz-in-datenschicht.patch — sicherAufrufen()
 * puts a fixed sentence into Ergebnis.Fehler.Server → red “the data layer builds
 * no message …”.
 */
class ErrorMessageLayerTest {

    private val dataLayer = listOf(
        // All files of the data layer — previously only the one.
        "data/repository/Ergebnis.kt",
        "data/repository/Abruf.kt",
        "data/repository/SetsRepositoryImpl.kt",
        "data/repository/MerklisteRepositoryImpl.kt",
        "data/repository/AlarmRepositoryImpl.kt",
        "data/repository/SetKatalogRepository.kt",
        "data/repository/SetDateienRepository.kt",
        "data/repository/TeileRepositoryImpl.kt",
        "data/repository/FinanzenRepositoryImpl.kt",
        "data/repository/HaushaltRepositoryImpl.kt",
        "data/repository/FigurenRepositoryImpl.kt",
        "data/repository/KontoRepositoryImpl.kt",
        "data/repository/VerwaltungRepositoryImpl.kt",
        "data/repository/KatalogRepositoryImpl.kt",
        "data/repository/GutscheineRepositoryImpl.kt",
        "data/CsvImportSseClient.kt",
    )

    @Test
    fun `the data layer builds no message for the user`() {
        // Searched: a fixed sentence as message — Server(status, "…"), Abgewiesen("…")
        // or message = "…". Allowed is only the empty text — then the display
        // decides — or a passed-through server message (a variable).
        val satz = Regex("""Ergebnis\.Fehler\.(?:Abgewiesen\(\s*|Server\((?:[^,()]|\([^()]*\))*,\s*)"([^"]+)"|\bmessage\s*=\s*"([^"]+)"""")
        val fehler = mutableListOf<String>()
        for (rel in dataLayer) {
            val s = Quellen.withoutComments(Quellen.lies(rel))
            satz.findAll(s).forEach { m ->
                val zeile = s.substring(0, m.range.first).count { it == '\n' } + 1
                fehler += "$rel:$zeile  ${m.value}"
            }
        }
        assert(fehler.isEmpty()) {
            "Die Datenschicht formuliert wieder selbst. Sie hat keinen Context und " +
                "kann nicht übersetzen — stattdessen eine Fehlerart melden und den " +
                "Satz in AppTexte.meldung() bilden:\n  " + fehler.joinToString("\n  ")
        }
    }

    @Test
    fun `the mapping of cause to text lives outside of meldung`() {
        // Whether every error kind has its own sentence is checked by
        // ErrorTextsTest — executed instead of read. What remains here is only the
        // statement a text search can really hit: that the
        // mapping IS its own, context-free function. If it moves
        // back into meldung(), it is again only checkable via Android.
        val texts = Quellen.withoutComments(Quellen.lies("state/ui/FehlerTexte.kt"))
        assert(texts.contains("fun fehlerTextId(")) { "fehlerTextId() fehlt" }
        assert(!texts.contains("ctx.") && !texts.contains("Context")) {
            "FehlerTexte.kt darf keinen Context brauchen — sonst ist die Zuordnung " +
                "wieder nur mit Android-Laufzeit prüfbar"
        }
        val vm = Quellen.withoutComments(Quellen.lies("state/ui/viewmodel/AppTexte.kt"))
        val meldung = Quellen.function(vm, "override fun meldung(")
        assert(meldung.isNotEmpty()) { "meldung() fehlt in AppTexte" }
        assert(meldung.contains("fehlerTextId(")) {
            "meldung() benutzt die gemeinsame Zuordnung nicht mehr"
        }
    }
}

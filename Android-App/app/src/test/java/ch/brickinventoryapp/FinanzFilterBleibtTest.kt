package ch.brickinventoryapp

import ch.brickinventoryapp.ui.FinanceUiState
import org.junit.Test

/**
 * Der Kategoriefilter der Finanzen bleibt stehen — und laesst sich haeufen.
 *
 * ── Marcos Befund ───────────────────────────────────────────────────────────
 * „Wird in der Android-App im Reiter Finanzen ein Filter gesetzt und dann ein
 * Eintrag abgewaehlt und den Detail Dialog wieder verlassen ist der Filter weg
 * (nicht mehr gewaehlt). Kann der Filter zudem aditiv sein?"
 *
 * ── Was daran was war ───────────────────────────────────────────────────────
 * Der Filter lag im Bildschirm:
 *
 *     val activeCategory = remember { mutableStateOf("alle") }
 *
 * `remember` haelt einen Wert ueber eine Rekomposition — nicht ueber das
 * Verlassen der Komposition. Ein Klick auf eine Zeile fuehrt in einen anderen
 * Bildschirm, der Finanzen-Reiter verlaesst die Komposition, und beim
 * Zurueckkommen faengt `remember` von vorn an: „alle".
 *
 * Das ist dieselbe Regel wie bei den Listenfiltern
 * (ListenfilterImZustandTest): Ein Filter, der eine Ansicht einschraenkt,
 * gehoert in den Zustand dieser Ansicht. `rememberSaveable` waere die kleinere
 * Antwort gewesen und bleibt trotzdem falsch — es rettet ueber den Prozesstod,
 * aber nicht ueber das Verlassen der Komposition.
 *
 * ── Zwei Haelften, weil eine allein still falsch werden kann ────────────────
 *  1. AM VERHALTEN: Die Mengenrechnung stimmt — dazunehmen, wegnehmen, und die
 *     leere Auswahl zeigt alles.
 *  2. AM QUELLTEXT: Der Bildschirm haelt den Filter nicht wieder selbst.
 *     Haelfte 1 bliebe gruen, waehrend Marcos Befund zurueck waere.
 */
class FinanzFilterBleibtTest {

    @Test
    fun `leere Auswahl zeigt alles`() {
        val z = FinanceUiState()
        assert(z.zeigt("sets") && z.zeigt("parts") && z.zeigt("figs")) {
            "Ohne Einschraenkung muessen alle drei Zeilenarten sichtbar sein"
        }
    }

    @Test
    fun `der Filter ist additiv`() {
        val z = FinanceUiState()
            .mitUmgeschalteterKategorie("sets")
            .mitUmgeschalteterKategorie("figs")

        assert(z.kategorien == setOf("sets", "figs")) {
            "Zwei Klicks sollen sich haeufen, nicht einander ersetzen: ${z.kategorien}"
        }
        assert(z.zeigt("sets") && z.zeigt("figs")) { "Beide gewaehlten Arten bleiben sichtbar" }
        assert(!z.zeigt("parts")) { "Was nicht gewaehlt ist, faellt weg" }
    }

    @Test
    fun `dieselbe Art zweimal geklickt nimmt sie wieder weg`() {
        val z = FinanceUiState()
            .mitUmgeschalteterKategorie("parts")
            .mitUmgeschalteterKategorie("parts")

        assert(z.kategorien.isEmpty()) { "Der zweite Klick raeumt die Wahl wieder weg" }
        // Und die leere Menge heisst wieder ALLE — nicht „nichts". Eine Ansicht,
        // die nach dem Abwaehlen leer bliebe, waere kein Filter, sondern eine
        // leere Seite.
        assert(z.zeigt("sets") && z.zeigt("parts") && z.zeigt("figs")) {
            "Die leere Auswahl muss wieder alles zeigen"
        }
    }

    @Test
    fun `der Bildschirm haelt den Filter nicht selbst`() {
        val src = Quellen.ohneKommentare(
            Quellen.lies("ui/screens/FinanceScreen.kt"))

        assert(!Regex("""remember\s*\{\s*mutableStateOf\("alle"\)""").containsMatchIn(src)) {
            "Der Kategoriefilter liegt wieder in einem remember des Bildschirms — " +
                "damit ist er nach jedem Ausflug in einen Detail-Bildschirm weg"
        }
        assert(src.contains("financeState.zeigt(")) {
            "Der Bildschirm soll die Sichtbarkeit aus dem Zustand lesen"
        }
        // Die Regel „leer heisst alle" darf nur EINMAL geschrieben stehen. Vorher
        // stand sie dreimal im Bildschirm (showSets/showParts/showFigs).
        assert(!src.contains("kategorien.isEmpty() ||")) {
            "Die Regel „leere Auswahl heisst alle\" steht wieder im Bildschirm statt " +
                "in FinanceUiState.zeigt()"
        }
    }
}

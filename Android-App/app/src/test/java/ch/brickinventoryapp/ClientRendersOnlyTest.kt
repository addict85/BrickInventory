package ch.brickinventoryapp

import org.junit.Test

/**
 * Die App rechnet keine Geldbeträge nach — sie zeigt, was der Server liefert.
 *
 * ── Marcos Frage (Nachtrag 107) ─────────────────────────────────────────────
 * „Ist sichergestellt, dass die ganze Logik im Server zentral ist und Webapp
 * wie Android-App die Daten gleich beziehen und nur rendern?"
 *
 * Für die App war die Antwort bis auf eine Stelle ja: Den Gesamtwert (Sets +
 * manuell erfasste Teile + Minifiguren) addierte sie selbst — genau wie die
 * Webapp, jede auf ihre Art. Er kommt jetzt als `totals.grand_total` aus
 * /finance/pnl.
 *
 * ── Was diese Prüfung NICHT beanstandet ─────────────────────────────────────
 * Summen über Stückzahlen (`sumOf { it.quantity }`). Die sind Anzeige: „x7"
 * neben einer Zeile. Erst wo GELD summiert wird, entsteht eine zweite Fassung
 * einer Geschäftsregel.
 */
class ClientRendersOnlyTest {

    private fun entkleide(src: String): String {
        val out = StringBuilder()
        var i = 0
        while (i < src.length) {
            when {
                src.startsWith("//", i) -> {
                    val j = src.indexOf('\n', i).let { if (it < 0) src.length else it }
                    repeat(j - i) { out.append(' ') }; i = j
                }
                src.startsWith("/*", i) -> {
                    val j = src.indexOf("*/", i + 2).let { if (it < 0) src.length else it + 2 }
                    for (c in src.substring(i, j)) out.append(if (c == '\n') '\n' else ' '); i = j
                }
                src[i] == '"' -> {
                    var j = i + 1
                    while (j < src.length && src[j] != '"') j += if (src[j] == '\\') 2 else 1
                    j++
                    for (c in src.substring(i, minOf(j, src.length))) out.append(if (c == '\n') '\n' else ' ')
                    i = j
                }
                else -> { out.append(src[i]); i++ }
            }
        }
        return out.toString()
    }

    @Test
    fun `die Oberflaeche summiert keine Geldbetraege selbst`() {
        val wurzel = java.io.File("src/main/java/ch/brickinventoryapp/ui")
        val geld = Regex("""sumOf\s*\{[^}]{0,120}?\.(price|Price|value|Value|total|Total|purchase|Purchase)\w*""")
        val treffer = mutableListOf<String>()
        // Untergrenze (Nachtrag 118): Ein Dateilauf, der nichts findet, lässt
        // jede Sammelprüfung darunter stillschweigend bestehen.
        check(wurzel.walkTopDown().count { it.extension == "kt" } >= 20) {
            "Zu wenige Kotlin-Dateien unter ${'$'}{wurzel.path} — Pfad veraltet?"
        }
        for (f in wurzel.walkTopDown().filter { it.extension == "kt" }) {
            val code = entkleide(f.readText())
            for (m in geld.findAll(code)) {
                val zeile = code.substring(0, m.range.first).count { it == '\n' } + 1
                treffer += "${f.name}:$zeile — ${m.value.take(60)}"
            }
        }
        assert(treffer.isEmpty()) {
            "Die Oberfläche bildet eine Geldsumme selbst:\n  " + treffer.joinToString("\n  ") +
                "\nDer Server liefert solche Summen fertig (total_value, totals.grand_total). " +
                "Zwei Rechenwege bedeuten zwei Ergebnisse, sobald sich die Regel ändert."
        }
    }

    @Test
    fun `der Gesamtwert kommt vom Server`() {
        val sections = java.io.File(
            "src/main/java/ch/brickinventoryapp/ui/screens/FinanceSections.kt").readText()
        assert(sections.contains("pnl?.totals?.grandTotal")) {
            "Der Gesamtwert wird nicht mehr vom Server gelesen — dann rechnet ihn " +
                "die App wieder selbst, und die Webapp tut dasselbe auf ihre Art."
        }
        // Das Modellfeld muss es geben, sonst liest der Ausdruck oben ins Leere.
        val models = java.io.File(
            "src/main/java/ch/brickinventoryapp/data/model/Models.kt").readText()
        assert(models.contains("""@SerialName("grand_total")""")) {
            "PnlTotals kennt grand_total nicht"
        }
    }
}

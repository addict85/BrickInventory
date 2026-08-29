package ch.brickinventoryapp

import org.junit.Test

/**
 * Sets senden `purchase_price`, Teile und Minifiguren `unit_price`.
 *
 * ── Marcos Befund (Nachtrag 111) ────────────────────────────────────────────
 * „Wenn ich in der Android-App den Kaufpreis anpasse (bei den Minifiguren,
 * evtl. auch bei den manuell erfassten Teilen und den Sets), wird der Kaufpreis
 * nicht gespeichert."
 *
 * ── Zwei Feldnamen, kein Versehen des Servers ───────────────────────────────
 * Der Server liest das Preisfeld unter dem Namen der jeweiligen SPALTE
 * (`req.body[cfg.priceCol]`):
 *
 *     Sets                    → purchase_price
 *     Teile und Minifiguren   → unit_price
 *
 * Das ist konsequent: Bei einem Set ist es der Preis des Sets, bei Teilen und
 * Minifiguren der Preis JE STÜCK. Die Webapp bedient beide Namen seit jeher
 * (`body.purchase_price` bzw. `body.unit_price`).
 *
 * Die App schickte immer `purchase_price`. Für Teile und Minifiguren fand der
 * Server also gar kein Preisfeld — und liess den Preis unverändert, OHNE einen
 * Fehler zu melden. Deshalb wirkte es wie „wird nicht gespeichert".
 *
 * Bemerkenswert: Der Parameter in ManualItemFeature hiess schon immer
 * `unitPrice`. Er landete nur im falschen Feld.
 *
 * ── Die Regel ───────────────────────────────────────────────────────────────
 * Den Rumpf baut niemand mehr von Hand. `fuerSet()` und `fuerStueck()` setzen
 * je genau ein Preisfeld; das andere bleibt null und wird von
 * kotlinx.serialization weggelassen.
 */
class AcquisitionPriceFieldTest {

    /**
     * Alle Modelldateien als EIN Text (Nachtrag 155). Vorher war hier ein
     * Dateiname festgeschrieben; die 92 Datenklassen sind seither nach
     * Sachgebieten auf mehrere Dateien verteilt. Gemeint sind DIE MODELLE.
     */
    private fun models(): String =
        java.io.File("src/main/java/ch/brickinventoryapp/data/model")
            .listFiles { f -> f.extension == "kt" }
            .orEmpty().sortedBy { it.name }
            .joinToString("\n") { it.readText() }

    /** Der Block der Anfrageklasse — Anker auf CODE, nicht auf einen Kommentar. */
    private fun block(): String {
        val m = models()
        val i = m.indexOf("data class UpdateAcquisitionRequest")
        assert(i >= 0) { "UpdateAcquisitionRequest nicht gefunden" }
        val j = m.indexOf("data class JobStatus", i)
        return m.substring(i, if (j > i) j else m.length)
    }

    @Test
    fun `das Anfragemodell kennt beide Preisfelder`() {
        val b = block()
        assert(b.contains("""@SerialName("purchase_price")""")) { "purchase_price fehlt" }
        assert(b.contains("""@SerialName("unit_price")""")) {
            "unit_price fehlt — dann kann für Teile und Minifiguren kein Preis " +
                "übertragen werden, und der Server lässt ihn stillschweigend stehen."
        }
        assert(b.contains("fun fuerSet(") && b.contains("fun fuerStueck(")) {
            "Die beiden Erzeuger fehlen"
        }
    }

    @Test
    fun `jeder Erzeuger setzt genau sein Feld`() {
        val b = block()
        val set = b.substring(b.indexOf("fun fuerSet("), b.indexOf("fun fuerStueck("))
        val stueck = b.substring(b.indexOf("fun fuerStueck("))

        assert(set.contains("purchasePrice = preis")) { "fuerSet setzt purchase_price nicht" }
        assert(!set.contains("unitPrice = preis")) { "fuerSet setzt zusätzlich unit_price" }
        assert(stueck.contains("unitPrice = preis")) {
            "fuerStueck setzt unit_price nicht — genau Marcos Fehler."
        }
        assert(!stueck.contains("purchasePrice = preis")) { "fuerStueck setzt zusätzlich purchase_price" }
    }

    @Test
    fun `niemand baut den Rumpf von Hand`() {
        // Sonst entscheidet wieder jede Aufrufstelle für sich, welches Feld sie
        // füllt — und eine davon entscheidet falsch.
        val wurzel = java.io.File("src/main/java/ch/brickinventoryapp")
        val treffer = mutableListOf<String>()
        // Untergrenze (Nachtrag 118): Ein Dateilauf, der nichts findet, lässt
        // jede Sammelprüfung darunter stillschweigend bestehen.
        check(wurzel.walkTopDown().count { it.extension == "kt" } >= 20) {
            "Zu wenige Kotlin-Dateien unter ${'$'}{wurzel.path} — Pfad veraltet?"
        }
        for (f in wurzel.walkTopDown().filter { it.extension == "kt" }) {
            // Die Modelldateien selbst ueberspringen: Dort STEHEN die
            // Feldnamen ja, geprueft wird der uebrige Baum.
            if (f.name.endsWith("Models.kt")) continue
            val code = f.readText().lines()
                .joinToString("\n") { val t = it.trim(); if (t.startsWith("//") || t.startsWith("*")) "" else it }
            for (m in Regex("""UpdateAcquisitionRequest\(""").findAll(code)) {
                val zeile = code.substring(0, m.range.first).count { it == '\n' } + 1
                treffer += "${f.name}:$zeile"
            }
        }
        assert(treffer.isEmpty()) {
            "Der Anfrage-Rumpf wird direkt gebaut statt über fuerSet()/fuerStueck():\n  " +
                treffer.joinToString("\n  ")
        }
    }
}

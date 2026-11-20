package ch.brickinventoryapp.app

import org.junit.Test
import java.io.File
import ch.brickinventoryapp.testing.Quellen

/**
 * Kein Bildschirm greift an der Zustandsschicht vorbei in die Datenschicht: Ladelogik in
 * einem Composable läuft nur mit Compose-Laufzeit und lässt sich nicht als gewöhnliche
 * Funktion prüfen. Strukturprüfung über alle Bildschirmordner.
 *
 * Gegenprobe: `repo.sets.getSets()` in MonitoringScreen.kt → rot „kein Composable
 * ruft das Repository direkt auf“, mit Datei und Zeile.
 */
class ScreenHoltDataNotSelfTest {

    private val screenFolder = listOf("ui/screens", "ui/dialogs", "ui/components", "gemeinsam/ui")

    // Jedes Modul trägt die Ordner unter seinem eigenen Paketstamm; unter() sammelt sie.
    private fun dateien(): List<File> = screenFolder.flatMap { Quellen.unter(it) }.distinct()

    private fun withoutComments(src: String) = src.lines().joinToString("\n") {
        val t = it.trim()
        if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) "" else it
    }

    @Test
    fun `kein Composable ruft das Repository direkt auf`() {
        val alle = dateien()
        // Untergrenze: Ein leerer Dateilauf liesse jede Sammelpruefung
        // stillschweigend bestehen.
        assert(alle.size >= 20) { "Nur ${alle.size} Bildschirmdateien gefunden — Pfade veraltet?" }

        val durchgriffe = mutableListOf<String>()
        for (f in alle) {
            withoutComments(f.readText()).lines().forEachIndexed { i, z ->
                if (Regex("""\brepo\s*\.\s*(sets|teile|finanzen|haushalt|admin)\s*\.""").containsMatchIn(z))
                    durchgriffe += "${f.name}:${i + 1}  ${z.trim().take(70)}"
            }
        }
        assert(durchgriffe.isEmpty()) {
            "Diese Composables holen ihre Daten selbst, statt sie von einem " +
                "ViewModel zu bekommen. Damit laesst sich die Ladelogik nur mit " +
                "Compose-Laufzeit ausfuehren — also gar nicht pruefen:\n  " +
                durchgriffe.joinToString("\n  ")
        }
    }

    /**
     * Bildschirme sehen Fachtypen (model.fach), keine Server-Modelle: Ein neues
     * Feld oder eine andere Nullbarkeit im DTO soll im Repository oder ViewModel
     * auffallen, nicht in einem Composable. Ohne Ausnahme.
     * Gegenprobe: in GutscheineCard.kt wieder
     * `import ch.brickinventoryapp.vertrag.Gutschein` → rot, nennt die Datei.
     */
    @Test
    fun `kein Bildschirm kennt die Server-Modelle`() {
        val screens = listOf("screens", "components", "dialogs", "gemeinsam/ui").flatMap { Quellen.unter(it) }
        assert(screens.size >= 50) { "Bildschirme nicht gefunden — Muster veraltet?" }
        val withModel = screens.filter { "brickinventoryapp.vertrag" in Quellen.withoutComments(it.readText()) }.map { it.name }
        assert(withModel.isEmpty()) {
            "Diese Bildschirme greifen auf das Wire-Format (vertrag) zu: $withModel — Fachtyp aus model.fach nehmen, " +
                "die Abbildung gehört ins ViewModel."
        }
    }
}

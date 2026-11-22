package ch.brickinventoryapp.app

import org.junit.Test
import java.io.File
import ch.brickinventoryapp.testing.Quellen

/**
 * No screen reaches past the state layer into the data layer: loading logic in
 * a composable only runs with the Compose runtime and cannot be checked as an ordinary
 * function. Structure check across all screen folders.
 *
 * Counter-check: `repo.sets.getSets()` in MonitoringScreen.kt → red “no composable
 * calls the repository directly”, with file and line.
 */
class ScreenHoltDataNotSelfTest {

    private val screenFolder = listOf("ui/screens", "ui/dialogs", "ui/components", "shared/ui")

    // Every module carries the folders under its own package root; unter() collects them.
    private fun dateien(): List<File> = screenFolder.flatMap { Quellen.unter(it) }.distinct()

    private fun withoutComments(src: String) = src.lines().joinToString("\n") {
        val t = it.trim()
        if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) "" else it
    }

    @Test
    fun `no composable calls the repository directly`() {
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
     * Screens see domain types (model.fach), not server models: a new
     * field or a different nullability in the DTO should stand out in the repository or ViewModel,
     * not in a composable. Without exception.
     * Counter-check: in GutscheineCard.kt again
     * `import ch.brickinventoryapp.contract.Gutschein` → red, names the file.
     */
    @Test
    fun `no screen knows the server models`() {
        val screens = listOf("screens", "components", "dialogs", "shared/ui").flatMap { Quellen.unter(it) }
        assert(screens.size >= 50) { "Bildschirme nicht gefunden — Muster veraltet?" }
        val withModel = screens.filter { "brickinventoryapp.contract" in Quellen.withoutComments(it.readText()) }.map { it.name }
        assert(withModel.isEmpty()) {
            "Diese Bildschirme greifen auf das Wire-Format (vertrag) zu: $withModel — Fachtyp aus model.fach nehmen, " +
                "die Abbildung gehört ins ViewModel."
        }
    }
}

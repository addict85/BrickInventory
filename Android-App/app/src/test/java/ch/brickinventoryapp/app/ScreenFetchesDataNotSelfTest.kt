package ch.brickinventoryapp.app

import ch.brickinventoryapp.testing.Sources
import org.junit.Test
import java.io.File

/**
 * No screen reaches past the state layer into the data layer: loading logic in
 * a composable only runs with the Compose runtime and cannot be checked as an ordinary
 * function. Structure check across all screen folders.
 *
 * Counter-check: `repo.sets.getSets()` in MonitoringScreen.kt → red “no composable
 * calls the repository directly”, with file and line.
 */
class ScreenFetchesDataNotSelfTest {

    private val screenFolder = listOf("ui/screens", "ui/dialogs", "ui/components", "shared/ui")

    // Every module carries the folders under its own package root; below() collects them.
    private fun files(): List<File> = screenFolder.flatMap { Sources.below(it) }.distinct()

    private fun withoutComments(src: String) = src.lines().joinToString("\n") {
        val t = it.trim()
        if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) "" else it
    }

    @Test
    fun `no composable calls the repository directly`() {
        val all = files()
        // Untergrenze: Ein leerer Dateilauf liesse jede Sammelpruefung
        // stillschweigend bestehen.
        assert(all.size >= 20) { "Nur ${all.size} Bildschirmdateien gefunden — Pfade veraltet?" }

        val passthroughs = mutableListOf<String>()
        for (f in all) {
            withoutComments(f.readText()).lines().forEachIndexed { i, z ->
                if (Regex("""\brepo\s*\.\s*(sets|parts|finances|household|admin)\s*\.""").containsMatchIn(z))
                    passthroughs += "${f.name}:${i + 1}  ${z.trim().take(70)}"
            }
        }
        assert(passthroughs.isEmpty()) {
            "Diese Composables holen ihre Daten selbst, statt sie von einem " +
                "ViewModel zu bekommen. Damit laesst sich die Ladelogik nur mit " +
                "Compose-Laufzeit ausfuehren — also gar nicht pruefen:\n  " +
                passthroughs.joinToString("\n  ")
        }
    }

    /**
     * Screens see domain types (model.domain), not server models: a new
     * field or a different nullability in the DTO should stand out in the repository or ViewModel,
     * not in a composable. Without exception.
     * Counter-check: in VouchersCard.kt again
     * `import ch.brickinventoryapp.contract.Gutschein` → red, names the file.
     */
    @Test
    fun `no screen knows the server models`() {
        val screens = listOf("screens", "components", "dialogs", "shared/ui").flatMap { Sources.below(it) }
        assert(screens.size >= 50) { "Bildschirme nicht gefunden — Muster veraltet?" }
        val withModel = screens.filter { "brickinventoryapp.contract" in Sources.withoutComments(it.readText()) }.map { it.name }
        assert(withModel.isEmpty()) {
            "Diese Bildschirme greifen auf das Wire-Format (vertrag) zu: $withModel — Fachtyp aus model.fach nehmen, " +
                "die Abbildung gehört ins ViewModel."
        }
    }
}

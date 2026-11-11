package ch.brickinventoryapp.buildlogic.kanten

/** Eine Abhängigkeit [von] einem Modul [nach] einem anderen, in der Gradle-Konfiguration [konfiguration]. */
data class Modulkante(val von: String, val konfiguration: String, val nach: String) {
    /** testImplementation, kspTest, androidTestImplementation …: Was nur Tests sehen, liefert die App nicht aus. */
    val nurTest: Boolean get() = "test" in konfiguration.lowercase()
}

/**
 * Welches Modul wovon abhängen darf: app → feature-* → core-*, kein Bereich kennt einen anderen,
 * die Kernmodule in fester Schichtung. Ohne Gradle-Typen, damit die Konvention (ModulkantenPruefen)
 * und ModulgrenzenTest dieselbe Regel ausführen statt zwei Abschriften zu pflegen.
 */
object Modulkanten {
    val kerne: Map<String, Set<String>> = mapOf(
        "core-model" to emptySet(),
        "core-ressourcen" to emptySet(),
        "core-netz" to setOf("core-model"),
        // Tresor und TLS-Vertrauen liegen unter Room und Offlineablage.
        "core-sicherheit" to setOf("core-model", "core-netz"),
        "core-offline" to setOf("core-model", "core-sicherheit"),
        "core-data" to setOf("core-model", "core-ressourcen", "core-netz", "core-sicherheit", "core-offline"),
        // Sie hängen an core-data, nie umgekehrt und nie aneinander.
        "core-update" to setOf("core-ressourcen", "core-data"),
        "core-dienste" to setOf("core-ressourcen", "core-data"),
        "core-ui" to setOf("core-model", "core-ressourcen"),
        // Nur Darstellung: Mit Daten oder Zustand würde es zum Umweg, auf dem sich Bereiche doch kennen.
        "core-ui-bestand" to setOf("core-model", "core-ressourcen", "core-ui"),
        // Der Zustand liegt unter der Oberfläche: Bildschirme lesen ihn, er kennt kein Compose-Bauteil.
        "core-zustand" to setOf("core-model", "core-ressourcen", "core-netz", "core-data", "core-sicherheit"),
        "core-testing" to setOf("core-zustand", "core-data", "core-sicherheit", "core-offline"),
    )

    /** Die Verstösse unter [kanten], je einer als Satz; leer, wenn alle erlaubt sind. */
    fun verstoesse(kanten: Collection<Modulkante>): List<String> = kanten.mapNotNull { k ->
        when {
            // api reicht ein Modul an jeden weiter, der dieses kennt; nur die Modelle sind gemeinsame Sprache.
            k.konfiguration == "api" && k.nach != "core-model" ->
                "Modulkanten per api nur zu core-model: ${k.von} → ${k.nach}"
            k.nurTest -> null
            k.nach == "core-testing" -> "${k.von} bindet core-testing nicht nur für Tests ein"
            k.von.startsWith("feature-") && !k.nach.startsWith("core-") -> "${k.von} hängt an ${k.nach}"
            k.von.startsWith("core-") && k.nach !in kerne[k.von].orEmpty() ->
                "Schichtung der Kernmodule: ${k.von} hängt an ${k.nach}" +
                    if (k.von in kerne) "" else " (${k.von} hat keine Regel in Modulkanten.kerne)"
            else -> null
        }
    }.distinct()
}

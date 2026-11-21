package ch.brickinventoryapp.buildlogic.kanten

/** Eine Abhängigkeit [von] einem Modul [nach] einem anderen, in der Gradle-Konfiguration [configuration]. */
data class Modulkante(val von: String, val configuration: String, val nach: String) {
    /** testImplementation, kspTest, androidTestImplementation …: Was nur Tests sehen, liefert die App nicht aus. */
    val onlyTest: Boolean get() = "test" in configuration.lowercase()
}

/**
 * Welches Modul wovon abhängen darf: app → feature-* → core-*, kein Bereich kennt einen anderen,
 * die Kernmodule in fester Schichtung. Ohne Gradle-Typen, damit die Konvention (ModuleEdgesCheck)
 * und ModulgrenzenTest dieselbe Regel ausführen statt zwei Abschriften zu pflegen.
 */
object Modulkanten {
    val kerne: Map<String, Set<String>> = mapOf(
        "core-model" to emptySet(),
        // Das Wire-Format kennt Fach- und Anzeigetypen, nicht umgekehrt.
        "core-contract" to setOf("core-model"),
        "core-resources" to emptySet(),
        "core-network" to setOf("core-model"),
        // Tresor und TLS-Vertrauen liegen unter Room und Offlineablage.
        "core-security" to setOf("core-model", "core-network"),
        "core-offline" to setOf("core-model", "core-security"),
        "core-data" to setOf("core-model", "core-contract", "core-resources", "core-network", "core-security", "core-offline"),
        // Sie hängen an core-data, nie umgekehrt und nie aneinander.
        "core-update" to setOf("core-resources", "core-data"),
        "core-services" to setOf("core-resources", "core-data"),
        "core-ui" to setOf("core-model", "core-resources"),
        // Nur Darstellung: Mit Daten oder Zustand würde es zum Umweg, auf dem sich Bereiche doch kennen.
        "core-ui-inventory" to setOf("core-model", "core-resources", "core-ui"),
        // Die Sitzung liegt unter dem Zustand: Sie kennt weder Filter noch ViewModels.
        "core-session" to setOf("core-model", "core-resources", "core-network", "core-data"),
        // Der Zustand liegt unter der Oberfläche: Bildschirme lesen ihn, er kennt kein Compose-Bauteil.
        "core-state" to setOf("core-model", "core-resources", "core-network", "core-data", "core-security", "core-session"),
        // Die Umgebung der Bereiche (NavController, Bilder, Snackbar) über dem Zustand.
        "core-navigation" to setOf("core-model", "core-session", "core-state"),
        "core-testing" to setOf("core-state", "core-session", "core-data", "core-security", "core-offline"),
    )

    /**
     * Netz und Tresor liegen unter dem Zustand; ein Bereich kennt sie nur, wenn er selbst
     * Server und Zertifikate prüft (Anmeldung) oder Adressen des Servers auflöst.
     */
    val depthCores: Map<String, Set<String>> = mapOf(
        "core-network" to setOf("feature-login", "feature-finances", "feature-catalog", "feature-collection"),
        "core-security" to setOf("feature-login"),
        "core-offline" to emptySet(),
    )

    /**
     * Kernmodule ohne Compose: Zustand, Daten und alles darunter. Ein Compose-Typ dort zöge
     * Oberfläche unter den Zustand, und über ihn erreichte ein Bereich, was er nicht kennen soll.
     */
    val withoutUi: Set<String> = setOf(
        "core-model", "core-contract", "core-network", "core-security", "core-offline", "core-data", "core-update", "core-services",
        "core-session", "core-state",
    )

    /** Wer core-contract einbindet: Nur die Repositories übersetzen; die Ablage hält Fachtypen. */
    val wireKenner: Set<String> = setOf("core-data")

    private val uisPlugins = setOf("brickinventory.android.compose", "brickinventory.android.feature", "kotlin.compose")

    /** Der Verstoss, wenn [modul] mit [plugins] (Katalognamen wie im Modulskript) Compose einschaltet. */
    fun uiViolation(modul: String, plugins: Collection<String>): String? =
        (plugins.toSet() intersect uisPlugins).takeIf { modul in withoutUi && it.isNotEmpty() }
            ?.let { "$modul liegt unter der Oberfläche und schaltet Compose ein: ${it.sorted()}" }

    /**
     * Die ViewModels, die in core-state liegen dürfen, je mit Grund. Ein ViewModel, das nur ein
     * Bereich braucht, gehört in diesen Bereich; hier liegt nur, was die Activity oder mehrere
     * Bereiche teilen, die einander nicht kennen dürfen.
     */
    val zustandsViewModels: Map<String, String> = mapOf(
        "AppViewModel" to "Sitzung, Snackbar und Pflichtmasken der Activity; Bereiche sehen ihn nur über die Bereichsumgebung",
        "KaeufeViewModel" to "Käufe eines Eintrags: Sets (feature-collection) und eigene Teile/Figuren (feature-parts) " +
            "zeigen sie; ein eigener Bereich bräuchte die Bildschirme beider",
        "DarstellungViewModel" to "Design und Sprache: die Activity wendet sie an, Einstellungen (feature-account) ändert sie",
        "VertrauenViewModel" to "Zertifikatsfrage über jedem Ziel (Activity) und in den Einstellungen (feature-account)",
        "GeraeteEinstellungenViewModel" to "Geräteschalter in feature-account und feature-management",
    )

    /** Was zwischen den ViewModels in core-state ([gefunden]) und [zustandsViewModels] nicht stimmt. */
    fun stateViewModelViolations(gefunden: Collection<String>): List<String> =
        (gefunden.toSet() - zustandsViewModels.keys).map { "$it liegt in core-state ohne Grund in Modulkanten.zustandsViewModels" } +
            (zustandsViewModels.keys - gefunden.toSet()).map { "$it steht in Modulkanten.zustandsViewModels, liegt aber nicht in core-state" }

    /** Die Verstösse unter [kanten], je einer als Satz; leer, wenn alle erlaubt sind. */
    fun violations(kanten: Collection<Modulkante>): List<String> = kanten.mapNotNull { k ->
        when {
            // api reicht ein Modul an jeden weiter, der dieses kennt; nur core-model ist gemeinsame Sprache.
            k.configuration == "api" && k.nach != "core-model" ->
                "Modulkanten per api nur zu core-model: ${k.von} → ${k.nach}"
            k.onlyTest -> null
            k.nach == "core-contract" && k.von !in wireKenner ->
                "${k.von} kennt das Wire-Format: Nur ${wireKenner.sorted().joinToString(" und ")} bildet es ab"
            k.nach == "core-testing" -> "${k.von} bindet core-testing nicht nur für Tests ein"
            k.von.startsWith("feature-") && !k.nach.startsWith("core-") -> "${k.von} hängt an ${k.nach}"
            k.von.startsWith("feature-") && k.nach in depthCores && k.von !in depthCores.getValue(k.nach) ->
                "${k.von} hängt an ${k.nach}, das unter dem Zustand liegt"
            k.von.startsWith("core-") && k.nach !in kerne[k.von].orEmpty() ->
                "layering of the core modules: ${k.von} hängt an ${k.nach}" +
                    if (k.von in kerne) "" else " (${k.von} hat keine Regel in Modulkanten.kerne)"
            else -> null
        }
    }.distinct()
}

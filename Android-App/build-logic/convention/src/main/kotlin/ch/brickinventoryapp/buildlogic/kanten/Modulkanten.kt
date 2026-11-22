package ch.brickinventoryapp.buildlogic.kanten

/** A dependency [von] one module [nach] another, in the Gradle configuration [configuration]. */
data class Modulkante(val von: String, val configuration: String, val nach: String) {
    /** testImplementation, kspTest, androidTestImplementation …: what only tests see, the app does not ship. */
    val onlyTest: Boolean get() = "test" in configuration.lowercase()
}

/**
 * Which module may depend on what: app → feature-* → core-*, no area knows another,
 * the core modules in fixed layering. Without Gradle types, so that the convention (ModuleEdgesCheck)
 * and ModulgrenzenTest execute the same rule instead of maintaining two copies.
 */
object Modulkanten {
    val kerne: Map<String, Set<String>> = mapOf(
        "core-model" to emptySet(),
        // The wire format knows domain and display types, not the other way round.
        "core-contract" to setOf("core-model"),
        "core-resources" to emptySet(),
        "core-network" to setOf("core-model"),
        // Vault and TLS trust lie below Room and the offline store.
        "core-security" to setOf("core-model", "core-network"),
        "core-offline" to setOf("core-model", "core-security"),
        "core-data" to setOf("core-model", "core-contract", "core-resources", "core-network", "core-security", "core-offline"),
        // They depend on core-data, never the other way round and never on each other.
        "core-update" to setOf("core-resources", "core-data"),
        "core-services" to setOf("core-resources", "core-data"),
        "core-ui" to setOf("core-model", "core-resources"),
        // Only presentation: with data or state it would become the detour on which areas know each other after all.
        "core-ui-inventory" to setOf("core-model", "core-resources", "core-ui"),
        // The session lies below the state: it knows neither filters nor ViewModels.
        "core-session" to setOf("core-model", "core-resources", "core-network", "core-data"),
        // The state lies below the UI: screens read it, it knows no Compose component.
        "core-state" to setOf("core-model", "core-resources", "core-network", "core-data", "core-security", "core-session"),
        // The environment of the areas (NavController, images, snackbar) above the state.
        "core-navigation" to setOf("core-model", "core-session", "core-state"),
        "core-testing" to setOf("core-state", "core-session", "core-data", "core-security", "core-offline"),
    )

    /**
     * Network and vault lie below the state; an area knows them only if it checks
     * server and certificates itself (sign-in) or resolves addresses of the server.
     */
    val depthCores: Map<String, Set<String>> = mapOf(
        "core-network" to setOf("feature-login", "feature-finances", "feature-catalog", "feature-collection"),
        "core-security" to setOf("feature-login"),
        "core-offline" to emptySet(),
    )

    /**
     * Core modules without Compose: state, data and everything below. A Compose type there would pull
     * UI below the state, and via it an area would reach what it should not know.
     */
    val withoutUi: Set<String> = setOf(
        "core-model", "core-contract", "core-network", "core-security", "core-offline", "core-data", "core-update", "core-services",
        "core-session", "core-state",
    )

    /** Who includes core-contract: only the repositories translate; the store holds domain types. */
    val wireKenner: Set<String> = setOf("core-data")

    private val uisPlugins = setOf("brickinventory.android.compose", "brickinventory.android.feature", "kotlin.compose")

    /** The violation if [modul] with [plugins] (catalog names as in the module script) switches on Compose. */
    fun uiViolation(modul: String, plugins: Collection<String>): String? =
        (plugins.toSet() intersect uisPlugins).takeIf { modul in withoutUi && it.isNotEmpty() }
            ?.let { "$modul liegt unter der Oberfläche und schaltet Compose ein: ${it.sorted()}" }

    /**
     * The ViewModels that may lie in core-state, each with a reason. A ViewModel that only one
     * area needs belongs in that area; here only lies what the activity or several
     * areas share that must not know each other.
     */
    val zustandsViewModels: Map<String, String> = mapOf(
        "AppViewModel" to "Sitzung, Snackbar und Pflichtmasken der Activity; Bereiche sehen ihn nur über die Bereichsumgebung",
        "KaeufeViewModel" to "Käufe eines Eintrags: Sets (feature-collection) und eigene Teile/Figuren (feature-parts) " +
            "zeigen sie; ein eigener Bereich bräuchte die Bildschirme beider",
        "DarstellungViewModel" to "Design und Sprache: die Activity wendet sie an, Einstellungen (feature-account) ändert sie",
        "VertrauenViewModel" to "Zertifikatsfrage über jedem Ziel (Activity) und in den Einstellungen (feature-account)",
        "GeraeteEinstellungenViewModel" to "Geräteschalter in feature-account und feature-management",
    )

    /** What does not match between the ViewModels in core-state ([gefunden]) and [zustandsViewModels]. */
    fun stateViewModelViolations(gefunden: Collection<String>): List<String> =
        (gefunden.toSet() - zustandsViewModels.keys).map { "$it liegt in core-state ohne Grund in Modulkanten.zustandsViewModels" } +
            (zustandsViewModels.keys - gefunden.toSet()).map { "$it steht in Modulkanten.zustandsViewModels, liegt aber nicht in core-state" }

    /** The violations among [kanten], each as a sentence; empty if all are allowed. */
    fun violations(kanten: Collection<Modulkante>): List<String> = kanten.mapNotNull { k ->
        when {
            // api passes a module on to everyone who knows this one; only core-model is a common language.
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

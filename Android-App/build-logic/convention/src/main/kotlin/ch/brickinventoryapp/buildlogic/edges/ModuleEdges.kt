package ch.brickinventoryapp.buildlogic.edges

/** A dependency [of] one module [after] another, in the Gradle configuration [configuration]. */
data class ModuleEdge(val of: String, val configuration: String, val after: String) {
    /** testImplementation, kspTest, androidTestImplementation …: what only tests see, the app does not ship. */
    val onlyTest: Boolean get() = "test" in configuration.lowercase()
}

/**
 * Which module may depend on what: app → feature-* → core-*, no area knows another,
 * the core modules in fixed layering. Without Gradle types, so that the convention (ModuleEdgesCheck)
 * and ModuleBoundariesTest execute the same rule instead of maintaining two copies.
 */
object ModuleEdges {
    val cores: Map<String, Set<String>> = mapOf(
        "core-model" to emptySet(),
        // The wire format knows domain and display types, not the other way round.
        "core-contract" to setOf("core-model"),
        "core-resources" to emptySet(),
        "core-network" to setOf("core-model"),
        // Vault and TLS trust lie below Room and the offline store.
        "core-security" to setOf("core-model", "core-network"),
        "core-offline" to setOf("core-model", "core-security"),
        "core-data" to setOf("core-model", "core-contract", "core-resources", "core-network", "core-security", "core-offline"),
        // It depends on core-data, never the other way round.
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
        // Only the source reader: fixtures that need a module live in its testFixtures.
        "core-testing" to emptySet(),
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
        "core-model", "core-contract", "core-network", "core-security", "core-offline", "core-data", "core-services",
        "core-session", "core-state",
    )

    /** Who includes core-contract: only the repositories translate; the store holds domain types. */
    val wireMarker: Set<String> = setOf("core-data")

    private val uisPlugins = setOf("brickinventory.android.compose", "brickinventory.android.feature", "kotlin.compose")

    /** The violation if [module] with [plugins] (catalog names as in the module script) switches on Compose. */
    fun uiViolation(module: String, plugins: Collection<String>): String? =
        (plugins.toSet() intersect uisPlugins).takeIf { module in withoutUi && it.isNotEmpty() }
            ?.let { "$module lies below the UI and switches on Compose: ${it.sorted()}" }

    /**
     * The ViewModels that may lie in core-state, each with a reason. A ViewModel that only one
     * area needs belongs in that area; here only lies what the activity or several
     * areas share that must not know each other.
     */
    val stateViewModels: Map<String, String> = mapOf(
        "AppViewModel" to "session, snackbar and mandatory masks of the activity; areas see it only via the area environment",
        "PurchasesViewModel" to "purchases of an entry: sets (feature-collection) and own parts/figures (feature-parts) " +
            "show them; an area of their own would need the screens of both",
        "AppearanceViewModel" to "design and language: the activity applies them, settings (feature-account) changes them",
        "TrustViewModel" to "certificate question above every destination (activity) and in the settings (feature-account)",
        "DevicesSettingsViewModel" to "device switches in feature-account and feature-management",
    )

    /** What does not match between the ViewModels in core-state ([found]) and [stateViewModels]. */
    fun stateViewModelViolations(found: Collection<String>): List<String> =
        (found.toSet() - stateViewModels.keys).map { "$it lies in core-state without a reason in ModuleEdges.stateViewModels" } +
            (stateViewModels.keys - found.toSet()).map { "$it stands in ModuleEdges.stateViewModels but does not lie in core-state" }

    /** Everything [module] builds on, directly or through other core modules. */
    fun below(module: String): Set<String> {
        val seen = mutableSetOf<String>()
        val open = ArrayDeque(cores[module].orEmpty())
        while (open.isNotEmpty()) open.removeFirst().let { if (seen.add(it)) open += cores[it].orEmpty() }
        return seen
    }

    /**
     * A test that needs a module built on its own module checks the layer above, not its own:
     * it belongs there. Areas and app are above every core module.
     */
    private fun reverseTest(k: ModuleEdge): Boolean = k.of.startsWith("core-") &&
        (k.after.startsWith("feature-") || k.after == "app" || k.of in below(k.after))

    /** The violations among [edges], each as a sentence; empty if all are allowed. */
    fun violations(edges: Collection<ModuleEdge>): List<String> = edges.mapNotNull { k ->
        when {
            // api passes a module on to everyone who knows this one; only core-model is a common language.
            k.configuration == "api" && k.after != "core-model" ->
                "module edges via api only to core-model: ${k.of} → ${k.after}"
            k.onlyTest && reverseTest(k) -> "${k.of} tests with ${k.after}, which builds on ${k.of}: the test belongs in ${k.after}"
            k.onlyTest -> null
            k.after == "core-contract" && k.of !in wireMarker ->
                "${k.of} knows the wire format: only ${wireMarker.sorted().joinToString(" and ")} maps it"
            k.after == "core-testing" -> "${k.of} includes core-testing not only for tests"
            k.of.startsWith("feature-") && !k.after.startsWith("core-") -> "${k.of} depends on ${k.after}"
            k.of.startsWith("feature-") && k.after in depthCores && k.of !in depthCores.getValue(k.after) ->
                "${k.of} depends on ${k.after}, which lies below the state"
            k.of.startsWith("core-") && k.after !in cores[k.of].orEmpty() ->
                "layering of the core modules: ${k.of} depends on ${k.after}" +
                    if (k.of in cores) "" else " (${k.of} has no rule in ModuleEdges.cores)"
            else -> null
        }
    }.distinct()
}

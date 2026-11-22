package ch.brickinventoryapp.app

import ch.brickinventoryapp.testing.Sources
import org.junit.Test
import java.io.File

/**
 * Safeguarding of the target platform (SDK 36 / Android 16).
 *
 * The jump from 35 to 36 is harmless because the manifest does NOT do certain
 * things. Exactly that is what this class checks — otherwise it only stands out on
 * a tablet or when swiping back.
 *
 * The SDK levels stand in build-logic (Sdk.kt); a module script must not
 * override them, otherwise this class would check a number that does not apply.
 * Counter-checks (patches under counter-checks/, red as stated on 04.11.2026):
 *   sdk-minsdk-raised.patch   minSdk in Sdk.kt to 31 → red “minSdk is Android 11“
 */
class TargetSdkConfigTest {

    private val buildLogic = File(Sources.project, "build-logic/convention/src/main/kotlin/ch/brickinventoryapp/buildlogic")

    private val gradle: String by lazy {
        val f = File(buildLogic, "Sdk.kt")
        assert(f.exists()) { "build-logic/…/Sdk.kt not found" }
        f.readText()
    }

    private val manifest: String by lazy {
        val f = Sources.manifest
        assert(f.exists()) { "AndroidManifest.xml not found" }
        f.readText()
    }

    /** Hide XML comments — the explanatory texts name the patterns themselves. */
    private fun xmlCode(s: String) =
        s.replace(Regex("""<!--.*?-->""", RegexOption.DOT_MATCHES_ALL), "")

    private fun kotlinCode(s: String) =
        s.lines().filterNot { it.trim().startsWith("//") }.joinToString("\n")

    private fun intAfter(key: String): Int {
        val m = Regex("""\b$key\s*=\s*(\d+)""").find(Sources.withoutComments(gradle))
        assert(m != null) { "$key not found in Sdk.kt" }
        return m!!.groupValues[1].toInt()
    }

    @Test
    fun `no module script sets the SDK levels itself`() {
        val scripts = Sources.module.map { File(it, "build.gradle.kts") }
        assert(scripts.size >= 12) { "Only ${scripts.size} module scripts found — search outdated?" }
        val set = Regex("""\b(compileSdk|minSdk|targetSdk)\s*=""")
        val own = scripts.filter { set.containsMatchIn(Sources.withoutComments(it.readText())) }
            .map { it.parentFile!!.name }
        assert(own.isEmpty()) { "These modules set SDK levels themselves instead of via build-logic: $own" }
        // And the conventions take them from Sdk.kt, not as their own number.
        val conventions = buildLogic.listFiles { f -> f.extension == "kt" && f.name != "Sdk.kt" }.orEmpty()
        assert(conventions.size >= 2) { "No conventions under ${buildLogic.path}" }
        val number = Regex("""\b(compileSdk|minSdk|targetSdk)\s*=\s*\d""")
        val fixed = conventions.filter { number.containsMatchIn(Sources.withoutComments(it.readText())) }.map { it.name }
        assert(fixed.isEmpty()) { "SDK level as a number next to Sdk.kt: $fixed" }
    }

    @Test
    fun `compileSdk and targetSdk are 36 and identical`() {
        val compile = intAfter("compileSdk")
        val target = intAfter("targetSdk")
        assert(target >= 36) { "targetSdk is $target, expected at least 36" }
        assert(compile == target) {
            "compileSdk ($compile) and targetSdk ($target) diverge. That would be " +
                "allowed, but it hides which behavior changes are actually " +
                "active — deliberately aligned here."
        }
    }

    // Android 11 as the lower bound: below it no security updates, and
    // only from 30 does the device lock bind a keystore key including PIN/pattern
    // (Schrittschutz). Whoever lowers it brings back the special paths for 8 to 10.
    @Test
    fun `minSdk is Android 11`() {
        assert(intAfter("minSdk") == 30) {
            "minSdk is no longer 30. Lowered, the key-bound device lock for PIN and pattern " +
                "is missing; raised, devices drop out without anyone having decided it."
        }
    }

    @Test
    fun `the manifest forces no orientation and no fixed size`() {
        val m = xmlCode(manifest)
        for (attr in listOf("android:screenOrientation", "android:resizeableActivity")) {
            assert(!m.contains(attr)) {
                "$attr in the manifest. Under targetSdk 36 this is ignored on large displays " +
                    "— so the line raises an expectation that the system " +
                    "no longer fulfills."
            }
        }
    }

    @Test
    fun `predictive back is opted in`() {
        val m = xmlCode(manifest)
        assert(m.contains("android:enableOnBackInvokedCallback")) {
            "enableOnBackInvokedCallback is missing in the manifest. Under targetSdk 36 it is " +
                "on by default — written out, it is visible that the decision " +
                "was made, and the switch is quickly found when in doubt."
        }
    }

    /**
     * If a BackHandler is introduced, predictive back swiping must be re-checked on
     * the device — until then the app leaves back
     * completely to the Navigation Compose default.
     */
    @Test
    fun `there is still no own BackHandler`() {
        // Lower bound: this check claims an ABSENCE.
        // If the file walk found nothing, it would be green — exactly when
        // it is worth least.
        val hits = Sources.all()
            .asSequence()
            .filter { kotlinCode(it.readText()).contains("BackHandler(") }
            .map { it.name }
            .toList()
        assert(hits.isEmpty()) {
            "New BackHandler in ${hits.joinToString()}. That is allowed, but under " +
                "targetSdk 36 predictive back runs by default — please check on " +
                "a device that the swipe gesture still lands on the right destination."
        }
    }
}

package ch.brickinventoryapp.app

import ch.brickinventoryapp.testing.Sources
import org.junit.Test
import java.io.File

/**
 * The name of the release APK stands in exactly ONE place.
 *
 * ── Where this comes from ─────────────────────────────────────────────────────
 * In the log of a green run the output folder contained side by side:
 *
 *     app-release.apk        46483681
 *     Brickinventory.apk     46483681      ← from Gradle
 *     (afterwards) BrickInventory.apk      ← from the workflow
 *
 * Two versions of the same rule, in two spellings: `build.gradle.kts`
 * put a copy under „Brickinventory.apk“, the workflow then renamed
 * `app-release.apk` to „BrickInventory.apk“. On Linux these are
 * two files. Only the workflow's was uploaded — the Gradle copy
 * was dead weight, and the README named the one name in one place and
 * the other in two others.
 *
 * It never stood out because both paths worked. That is exactly
 * the hallmark of this error class: two versions of a rule do not stand
 * out as long as they happen to want the same thing. They stand out when one is changed
 * — then the other keeps working silently.
 *
 * What weighed heavier was what the second version DID: the workflow moved (`mv`) exactly
 * the original APK that the comment in `build.gradle.kts` explicitly leaves
 * in place so that downstream steps still find it. That this went well was due
 * solely to the order of the steps.
 *
 * Now Gradle assigns the name, and the workflow only checks. This test
 * records that it stays that way.
 *
 * ── Counter-check ───────────────────────────────
 * `build.gradle.kts` wrote „Brickinventory.apk“ again — i.e. the state from
 * before. Result: `354 tests completed, 1 failed`, namely
 * `ApkNameTest > Gradle and workflow mean the same file`.
 *
 * The two other rules stayed green because they were not broken. That
 * is the point: a test that fires on every breakage does not say which
 * one it was.
 *
 * The patterns here previously had two errors of their own, both found by a
 * local mirror instead of a ten-minute run:
 *   - `File(dir, "…")` found THREE „target names“, because the source names of
 *     AGP stand next to it in the same spelling. Now `val target = File(dir, …)`.
 */
class ApkNameTest {

    private val buildScript = File("build.gradle.kts")

    /**
     * The workflow lies outside the Gradle module. The path is therefore
     * checked, not assumed: a missing file would otherwise let the checks below
     * pass silently — the same trap as with a
     * file walk that finds nothing.
     *
     * It stands in Quellen.workflow() instead of here: a path in two
     * spellings is the same kind of error as a rule in two copies. Build run,
     * signing path and release are read together: the name must be the same in all.
     */
    private fun workflow(): String =
        listOf("android.yml", "android-signieren.yml", "android-release.yml").joinToString("\n") { Sources.workflow(it) }

    /**
     * The target name that `build.gradle.kts` assigns.
     *
     * Searched is `val target = File(dir, "…")`, not every `File(dir, …)`:
     * next to it stand the SOURCE names of AGP (app-release.apk and
     * app-release-unsigned.apk) in the same spelling. The broader pattern
     * found three „target names“ and was thus useless.
     */
    private fun targetName(): String {
        val hits = Regex("""val target = File\(dir,\s*"([^"]+\.apk)"\)""")
            .findAll(buildScript.readText()).toList()
        assert(hits.size == 1) {
            "build.gradle.kts contains ${hits.size} APK target names " +
                "(${hits.joinToString { it.groupValues[1] }}). Exactly one belongs there."
        }
        return hits[0].groupValues[1]
    }

    @Test
    fun `Gradle and workflow mean the same file`() {
        // Counter-check: with "Brickinventory.apk" (lowercase i) in build.gradle.kts —
        // i.e. the state from before — this test fails.
        val target = targetName()
        val wf = workflow()

        // AGP's standard names are not a violation: they describe what is
        // BEING built, not what the file is called in the end.
        val agp = setOf("app-release.apk", "app-release-unsigned.apk", "app-debug.apk")
        // Intermediate files of the signing step lie in $RUNNER_TEMP and are never
        // delivered; meant is the name under which the APK is uploaded.
        val inWorkflow = Regex("""(?<!RUNNER_TEMP/)\b[\w.-]+\.apk""").findAll(wf).map { it.value }.toSet() - agp

        assert(inWorkflow.isNotEmpty()) {
            "The workflow no longer names any APK name — then it uploads nothing, " +
                "or the pattern here is outdated."
        }
        assert(inWorkflow == setOf(target)) {
            "Gradle stores \"$target\", the workflow speaks of " +
                inWorkflow.joinToString(", ") { "\"$it\"" } +
                ". On Linux these are different files — a single letter is enough."
        }
    }

    @Test
    fun `the workflow no longer renames any APK`() {
        // Counter-check: a re-inserted `mv app-release.apk …` makes this
        // test red.
        //
        // A second rename would not just be a duplicate name: it moves
        // the original APK that output-metadata.json points to and that
        // downstream steps still expect.
        val wf = workflow()
        val rename = Regex("""^\s*(mv|cp)\s+\S*\.apk\s""", RegexOption.MULTILINE).find(wf)
        assert(rename == null) {
            "The workflow moves or copies an APK itself again " +
                "(\"${rename?.value?.trim()}\"). Gradle assigns the name — " +
                "two places for it are one place too many."
        }
    }

    /**
     * The workflow, split into its steps.
     *
     * Splitting happens at the indentation: a step begins with six spaces and
     * `- `. In the `run:` blocks everything is deeper, the pattern does not match
     * there. Comment lines are already out via workflow().
     *
     * Counting starts only FROM `steps:` — the `paths:` lists under `on:` have
     * the same indentation. The local mirror reported that: 20 „steps“
     * for 15. A number that counts something other than it claims is
     * useless as a self-proof too.
     */
    private fun steps(): List<String> {
        val whole = workflow()
        val ab = whole.indexOf("\n    steps:")
        assert(ab >= 0) { "the section `steps:` can no longer be found in android.yml" }
        val parts = whole.substring(ab).split(Regex("""^      - """, RegexOption.MULTILINE))
        assert(parts.size >= 10) {
            "Only ${parts.size - 1} steps found — indentation in the workflow changed? " +
                "A pattern that finds nothing lets every check below it pass silently."
        }
        return parts.drop(1)
    }

    @Test
    fun `the APK is delivered raw, not as a zip`() {
        // upload-artifact always delivers a zip; the APK must therefore hang on no
        // artifact step. Every step is checked, a future one too.
        val target = targetName()
        val all = steps()

        val artifacts = all.filter { it.contains("upload-artifact") }
        // Self-proof: without artifact steps the condition below checks
        // nothing and would always be green. The workflow has some (test reports,
        // bundle) — if the pattern finds none, it is outdated.
        assert(artifacts.isNotEmpty()) {
            "Not a single upload-artifact step found — pattern outdated?"
        }
        val zipped = artifacts.filter { it.contains(target) }
        assert(zipped.isEmpty()) {
            "$target hangs on an artifact again and therefore only comes out as a zip. " +
                "As a release attachment the same file is delivered raw."
        }

        // Releases are immutable: the attachments come with `gh release create`, a
        // later `gh release upload` fails with HTTP 422. Both are counted.
        // Counter-check: a second step with `gh release upload … BrickInventory.apk` → red „… 2-mal …“.
        val raw = all.filter { Regex("""gh release (create|upload)""").containsMatchIn(it) && it.contains(target) }
        assert(raw.size == 1) {
            "The step that provides $target as a release attachment stands " +
                "${raw.size} times in the workflow. Without it there is no direct " +
                "download; twice would be the same rule in two places."
        }
        // A pull request must not create a release with the file behind the fixed link —
        // otherwise it points to an unchecked branch. Uploading happens only from
        // android-release.yml, and that never starts from a pull request.
        val release = Sources.workflow("android-release.yml")
        val trigger = release.substringAfter("\non:\n").substringBefore("\npermissions:")
        assert(raw[0] in release && !Regex("""\n  (pull_request|pull_request_target|push):""").containsMatchIn("\n" + trigger)) {
            "The release step also runs on pull requests or pushes and thereby overwrites " +
                "the APK behind the stable link."
        }
    }

    @Test
    fun `Gradle prefers the signed APK`() {
        // Why this is here: the copy has the same name in both cases, the
        // difference lies solely in the source name. If both files lay in the folder after
        // a key change, the timestamp used to decide —
        // i.e. chance. An unsigned APK cannot be installed.
        val src = buildScript.readText()
        val begin = src.indexOf("val built =")
        assert(begin >= 0) { "the expression `val built =` no longer stands in build.gradle.kts" }
        val end = src.indexOf("if (built != null)", begin)
        assert(end > begin) { "the end of the expression can no longer be found" }
        val expression = src.substring(begin, end)

        val signed = expression.indexOf("app-release.apk")
        val unsigned = expression.indexOf("app-release-unsigned.apk")
        assert(signed >= 0 && unsigned >= 0) {
            "the expression no longer distinguishes signed and unsigned"
        }
        assert(signed < unsigned) {
            "The unsigned APK is checked before the signed one — then the " +
                "wrong one wins as soon as both lie in the folder."
        }
    }
}

package ch.brickinventoryapp.update

import ch.brickinventoryapp.testing.Sources
import ch.brickinventoryapp.update.util.UPDATE_RELEASE_BASE
import ch.brickinventoryapp.update.util.isAllowedApkAddress
import ch.brickinventoryapp.update.util.isNew
import org.junit.Test
import java.io.File

/**
 * The app updates itself — and does it carefully.
 *
 * ── Why this test carries more weight than others ─────────────────────────────
 * A self-updater is the only path in this app through which FOREIGN CODE
 * reaches the device. Every rule below is the answer to one way
 * this can go wrong; if one drops out, it drops out silently.
 *
 * Two of the checks run real code (isNew, isAllowedApkAddress
 * are pure functions). The rest read source text: wiring and network config.
 * UpdateViewModelTest (signature, checksum, offer, "later"),
 * UpdateLoaderTest (upper bounds), UpdateClientTest (the bare client) and
 * UpdateDialogTest (loading only on click) check it executed.
 */
class SelfUpdateTest {

    // ── Die reinen Regeln, ausgefuehrt ──────────────────────────────────────

    /**
     * A finding no one gets to see is no finding.
     *
     * The silent check on start alone isn't enough: AppNavigation.kt triggers it on start
     * (`checkOnUpdate(still = true)`), and the comment there says
     * explicitly that the question "is there anything newer?" applies to THE WHOLE APP.
     *
     * VERIFIED, the answer was nonetheless known only to one screen:
     * `updateState` was read at EXACTLY ONE place in the whole main tree,
     * in account/ui/screens/SettingsScreen.kt — and that screen was at the time
     * unreachable from anywhere (see ReachableRoutesTest). So the check
     * found something, put it in the ViewModel, and no one drew it.
     *
     * The path was made app-wide, the display wasn't carried along. Exactly
     * this gap should be caught here before someone reports it again.
     */
    @Test
    fun `the result of the silent check is shown outside the settings too`() {
        // What's searched for is SUBSCRIBING, not the mere occurrence of the name: whoever
        // sets or holds the state also names it and draws nothing.
        //
        // Only a composable can call `collectAsStateWithLifecycle`, and a
        // composable that subscribes to it also draws it.
        val reader = Sources.all()
            .filter { Sources.withoutComments(it.readText()).contains("updateState.collectAsStateWithLifecycle") }
            .map { it.name }
            .toSet()
        val show = reader - setOf("SettingsScreen.kt")
        assert(show.isNotEmpty()) {
            "Apart from SettingsScreen.kt nobody reads updateState. The check at start " +
                "(AppNavigation.kt, checkOnUpdate(still = true)) then finds something, " +
                "but it is visible nowhere — exactly the state Marco reported."
        }
    }

    @Test
    fun `only a truly higher version counts as newer`() {
        assert(isNew(100, 101)) { "a higher version is not recognized" }
        assert(!isNew(100, 100)) { "the same version counts as an update" }
        // The point: with `!=` the app would offer a downgrade after a
        // reverted build, which Android would then reject with
        // INSTALL_FAILED_VERSION_DOWNGRADE — a dead end the user
        // couldn't get out of.
        assert(!isNew(100, 99)) { "an OLDER version is offered as an update" }
    }

    @Test
    fun `only addresses from our release store`() {
        assert(isAllowedApkAddress("$UPDATE_RELEASE_BASE/BrickInventory.apk")) {
            "our own address is rejected"
        }
        // The classic prefix bug: `startsWith(BASIS)` without a slash
        // would let this through. This exact trap was already fixed once in
        // network/util/NetworkPolicy.kt, for the bearer token.
        assert(!isAllowedApkAddress("$UPDATE_RELEASE_BASE.angreifer.tld/x.apk")) {
            "an address that only STARTS with ours is allowed"
        }
        assert(!isAllowedApkAddress("https://angreifer.tld/BrickInventory.apk")) {
            "a completely foreign address is allowed"
        }
        assert(!isAllowedApkAddress("$UPDATE_RELEASE_BASE/version.json")) {
            "something other than an APK is allowed as an APK"
        }
        assert(UPDATE_RELEASE_BASE.startsWith("https://")) {
            "the release store is not on HTTPS"
        }
    }

    // ── The rules that live in the source text ─────────────────────────────────

    private fun source(rel: String) = Sources.withoutComments(Sources.read(rel))

    @Test
    fun `when unclear nothing is installed`() {
        val help = source("update/util/AppUpdate.kt")
        // Every `return null` in the signature lookup leads, via the
        // `?: return false` in signatureFits, to "do not install".
        assert(help.contains("val newValue = fingerprints(ctx, apk) ?: return false")) {
            "an unreadable or unsigned APK no longer counts as inadmissible"
        }
        assert(help.contains("if (info.packageName != ctx.packageName) return null")) {
            "The package name is not checked — a FOREIGN package with the same " +
                "key would get through"
        }
    }

    @Test
    fun `the check at start is silent`() {
        // Check on start, never load on its own: loading is a decision the user makes.
        val nav = source("app/AppNavigation.kt")
        // The start asks via checkOnStart(), which only checks silently when the switch is set; that
        // sign-in triggers it is checked by UpdateViewModelTest on the running ViewModel.
        val vm = Sources.function(Sources.withoutComments(Sources.read("account/ui/viewmodel/UpdateViewModel.kt")), "fun checkOnStart(")
        assert(vm.contains("checkOnUpdate(still = true)")) {
            "at start there is no (longer a) silent look for an update"
        }
        // And it loads nothing: loadUpdate() has exactly one trigger, the button.
        assert(!nav.contains("loadUpdate()")) {
            "The start triggers the download — Marco's requirement was explicitly " +
                "“never load on its own”"
        }
    }

    @Test
    fun `the update trusts only system certificates`() {
        // An APK comes from GitHub: system CAs only, no plaintext.
        val cfg = File(Sources.res, "xml/network_security_config.xml").readText()
        val ab = cfg.indexOf("<domain-config")
        assert(ab > 0) {
            "There is no domain-config block of its own any more — then for GitHub " +
                "the base-config applies, and it trusts user-installed certificates."
        }
        val block = cfg.substring(ab, cfg.indexOf("</domain-config>", ab))
        for (host in listOf("github.com", "githubusercontent.com")) {
            assert(block.contains(host)) {
                "$host is not in the block of its own. The release attachment is redirected — " +
                    "both hosts are needed."
            }
        }
        assert(!block.contains("""src="user"""")) {
            "the GitHub block trusts user-installed certificates again"
        }
        assert(block.contains("""cleartextTrafficPermitted="false"""")) {
            "plain text to GitHub would be allowed again"
        }
        // The base config also trusts only the system; the user allows custom CAs
        // explicitly, at runtime (ServerTrustTest).
        val basis = cfg.substring(cfg.indexOf("<base-config"))
        assert(!basis.contains("""src="user"""")) {
            "the base-config trusts every user-installed CA again"
        }
    }

    @Test
    fun `the manifest allows installing, no provider exposes the update directory`() {
        val manifest = Sources.manifest.readText()
        assert(manifest.contains("android.permission.REQUEST_INSTALL_PACKAGES")) {
            "without the permission the app cannot open the installer"
        }
        // The APK goes to the system via a PackageInstaller session; a grant via
        // a FileProvider would be available to any app handed a URI.
        assert(!manifest.contains("FileProvider")) { "a FileProvider could expose the update directory" }
    }

    @Test
    fun `the workflow puts the description next to the APK`() {
        // Via Quellen.workflow(), not with our own path: Gradle tests run
        // from the module folder, and a relative path of our own easily miscounts.
        // Releases are immutable: the description comes in the same `gh release create`
        // as the APK, and only `--latest` puts it under UPDATE_VERSION_URL.
        // Counter-check: `"$BESCHREIBUNG"` from the call, or `--latest=false` → red „Der Workflow legt die Release ohne …“.
        val text = Sources.workflow("android-release.yml")
        assert(Regex("""BESCHREIBUNG=app/build/outputs/version-signiert\.json\n""").containsMatchIn(text) &&
            Regex("""gh release create "\${'$'}QUELLE" [^\n]*"\${'$'}APK" "\${'$'}BESCHREIBUNG" [^\n]*\n\s*--verify-tag --latest """)
                .containsMatchIn(text)) {
            "The workflow creates the release without version-signiert.json or not as “Latest” — " +
                "without it the app finds no update, without anything failing anywhere"
        }
        // The values come from AGP's output-metadata.json and are NOT generated
        // again from the date here: a second calculation would run minutes
        // later than the one in the build and could report a value no APK
        // carries — the app would then offer an update that, after installing,
        // is still "outdated".
        assert(text.contains("output-metadata.json")) {
            "the version values are not read from AGP's output-metadata.json"
        }
        assert(Sources.workflow("android-signieren.yml").contains("{versionCode:${'$'}code, versionName:${'$'}name,")) {
            "the description does not carry both version details"
        }
    }

    @Test
    fun `no field promises a check that does not exist`() {
        // The field carries the git commit the build came from. If it were called `sha`, it would
        // read, next to `apkUrl` and `apkSize`, as a CHECKSUM OF THE APK.
        //
        // A real checksum wouldn't make sense here either: it would sit in
        // the same file as the address — whoever forges version.json
        // forges it along with it. Integrity is carried by signatureFits() against the
        // INSTALLED app, together with HTTPS.
        //
        // BOTH sides are checked: the workflow that writes the field,
        // and the data model that reads it. Checking only one side lets in
        // exactly the kind of drift this tree otherwise guards against
        // everywhere.
        val workflow = Sources.workflow("android-signieren.yml")
        assert(workflow.contains("commit:${'$'}commit")) {
            "the description no longer carries the origin field as `commit`"
        }
        assert(!workflow.contains("sha:${'$'}sha")) {
            "The field is called `sha` again — next to apkUrl and apkSize that reads " +
                "as a checksum of the APK, and no such check exists"
        }
        // Quellen.read() is relative to ch/brickinventoryapp/ — see there.
        val model = Sources.read("update/util/AppUpdate.kt")
        assert(model.contains("@SerialName(\"commit\")")) {
            "the data model does not read the field as `commit` — then it stays empty"
        }
    }

    // What the start dialog does and doesn't do, UpdateDialogTest checks rendered; here only
    // that it hangs over the whole app.
    @Test
    fun `the dialog hangs over the whole app, not on one screen`() {
        val nav = Sources.withoutComments(Sources.read("app/AppNavigation.kt"))
        assert(nav.contains("UpdateRoute(selfUpdate)")) {
            "The update hint is shown nowhere. Called in a single screen, " +
                "only whoever sits there anyway would get it — exactly the error " +
                "that the item in the settings already had once."
        }
    }
}

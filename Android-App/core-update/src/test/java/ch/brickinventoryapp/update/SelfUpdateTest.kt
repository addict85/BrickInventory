package ch.brickinventoryapp.update

import ch.brickinventoryapp.update.util.UPDATE_RELEASE_BASE
import ch.brickinventoryapp.update.util.isAllowedApkAddress
import ch.brickinventoryapp.update.util.isNew
import org.junit.Test
import java.io.File
import ch.brickinventoryapp.testing.Quellen

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
     * (`pruefeAufUpdate(still = true)`), and the comment there says
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
        val reader = Quellen.alle()
            .filter { Quellen.withoutComments(it.readText()).contains("updateState.collectAsStateWithLifecycle") }
            .map { it.name }
            .toSet()
        val anzeigen = reader - setOf("SettingsScreen.kt")
        assert(anzeigen.isNotEmpty()) {
            "Ausser SettingsScreen.kt liest niemand updateState. Die Pruefung beim Start " +
                "(AppNavigation.kt, pruefeAufUpdate(still = true)) findet dann zwar etwas, " +
                "aber es ist nirgends zu sehen — genau der Zustand, den Marco gemeldet hat."
        }
    }

    @Test
    fun `only a truly higher version counts as newer`() {
        assert(isNew(100, 101)) { "Eine hoehere Fassung wird nicht erkannt" }
        assert(!isNew(100, 100)) { "Dieselbe Fassung gilt als Update" }
        // The point: with `!=` the app would offer a downgrade after a
        // reverted build, which Android would then reject with
        // INSTALL_FAILED_VERSION_DOWNGRADE — a dead end the user
        // couldn't get out of.
        assert(!isNew(100, 99)) { "Eine AELTERE Fassung wird als Update angeboten" }
    }

    @Test
    fun `only addresses from our release store`() {
        assert(isAllowedApkAddress("$UPDATE_RELEASE_BASE/BrickInventory.apk")) {
            "Die eigene Adresse wird abgelehnt"
        }
        // The classic prefix bug: `startsWith(BASIS)` without a slash
        // would let this through. This exact trap was already fixed once in
        // network/util/NetworkPolicy.kt, for the bearer token.
        assert(!isAllowedApkAddress("$UPDATE_RELEASE_BASE.angreifer.tld/x.apk")) {
            "Eine Adresse, die nur mit unserer ANFAENGT, wird zugelassen"
        }
        assert(!isAllowedApkAddress("https://angreifer.tld/BrickInventory.apk")) {
            "Eine voellig fremde Adresse wird zugelassen"
        }
        assert(!isAllowedApkAddress("$UPDATE_RELEASE_BASE/version.json")) {
            "Etwas anderes als ein APK wird als APK zugelassen"
        }
        assert(UPDATE_RELEASE_BASE.startsWith("https://")) {
            "Die Release-Ablage steht nicht auf HTTPS"
        }
    }

    // ── The rules that live in the source text ─────────────────────────────────

    private fun quelle(rel: String) = Quellen.withoutComments(Quellen.lies(rel))

    @Test
    fun `when unclear nothing is installed`() {
        val help = quelle("update/util/AppUpdate.kt")
        // Every `return null` in the signature lookup leads, via the
        // `?: return false` in signatureFits, to "do not install".
        assert(help.contains("val neu = fingerabdruecke(ctx, apk) ?: return false")) {
            "Ein unlesbares oder unsigniertes APK gilt nicht mehr als unzulaessig"
        }
        assert(help.contains("if (info.packageName != ctx.packageName) return null")) {
            "Der Paketname wird nicht geprueft — ein FREMDES Paket mit demselben " +
                "Schluessel kaeme durch"
        }
    }

    @Test
    fun `the check at start is silent`() {
        // Check on start, never load on its own: loading is a decision the user makes.
        val nav = quelle("app/AppNavigation.kt")
        // The start asks via pruefeBeimStart(), which only checks silently when the switch is set; that
        // sign-in triggers it is checked by UpdateViewModelTest on the running ViewModel.
        val vm = Quellen.function(Quellen.withoutComments(Quellen.lies("account/ui/viewmodel/UpdateViewModel.kt")), "fun pruefeBeimStart(")
        assert(vm.contains("pruefeAufUpdate(still = true)")) {
            "Beim Start wird nicht (mehr) still nach einem Update gesehen"
        }
        // And it loads nothing: ladeUpdate() has exactly one trigger, the button.
        assert(!nav.contains("ladeUpdate()")) {
            "Der Start stoesst das Herunterladen an — Marcos Vorgabe war ausdruecklich " +
                "„nie von allein laden\""
        }
    }

    @Test
    fun `the update trusts only system certificates`() {
        // An APK comes from GitHub: system CAs only, no plaintext.
        val cfg = File(Quellen.res, "xml/network_security_config.xml").readText()
        val ab = cfg.indexOf("<domain-config")
        assert(ab > 0) {
            "Es gibt keinen eigenen domain-config-Block mehr — dann gilt fuer GitHub " +
                "die base-config, und die vertraut nutzerinstallierten Zertifikaten."
        }
        val block = cfg.substring(ab, cfg.indexOf("</domain-config>", ab))
        for (host in listOf("github.com", "githubusercontent.com")) {
            assert(block.contains(host)) {
                "$host steht nicht im eigenen Block. Der Release-Anhang wird umgeleitet — " +
                    "beide Hosts werden gebraucht."
            }
        }
        assert(!block.contains("""src="user"""")) {
            "Der GitHub-Block vertraut wieder nutzerinstallierten Zertifikaten"
        }
        assert(block.contains("""cleartextTrafficPermitted="false"""")) {
            "Zu GitHub waere wieder Klartext erlaubt"
        }
        // The base config also trusts only the system; the user allows custom CAs
        // explicitly, at runtime (ServerTrustTest).
        val basis = cfg.substring(cfg.indexOf("<base-config"))
        assert(!basis.contains("""src="user"""")) {
            "Die base-config vertraut wieder jeder nutzerinstallierten CA"
        }
    }

    @Test
    fun `the manifest allows installing, no provider exposes the update directory`() {
        val manifest = Quellen.manifest.readText()
        assert(manifest.contains("android.permission.REQUEST_INSTALL_PACKAGES")) {
            "Ohne die Berechtigung kann die App den Installer nicht oeffnen"
        }
        // The APK goes to the system via a PackageInstaller session; a grant via
        // a FileProvider would be available to any app handed a URI.
        assert(!manifest.contains("FileProvider")) { "Ein FileProvider könnte das Update-Verzeichnis freigeben" }
    }

    @Test
    fun `the workflow puts the description next to the APK`() {
        // Via Quellen.workflow(), not with our own path: Gradle tests run
        // from the module folder, and a relative path of our own easily miscounts.
        // Releases are immutable: the description comes in the same `gh release create`
        // as the APK, and only `--latest` puts it under UPDATE_VERSION_URL.
        // Counter-check: `"$BESCHREIBUNG"` from the call, or `--latest=false` → red „Der Workflow legt die Release ohne …“.
        val text = Quellen.workflow("android-release.yml")
        assert(Regex("""BESCHREIBUNG=app/build/outputs/version-signiert\.json\n""").containsMatchIn(text) &&
            Regex("""gh release create "\${'$'}QUELLE" [^\n]*"\${'$'}APK" "\${'$'}BESCHREIBUNG" [^\n]*\n\s*--verify-tag --latest """)
                .containsMatchIn(text)) {
            "Der Workflow legt die Release ohne version-signiert.json oder nicht als „Latest“ an — " +
                "ohne sie findet die App kein Update, ohne dass irgendwo etwas scheitert"
        }
        // The values come from AGP's output-metadata.json and are NOT generated
        // again from the date here: a second calculation would run minutes
        // later than the one in the build and could report a value no APK
        // carries — the app would then offer an update that, after installing,
        // is still "outdated".
        assert(text.contains("output-metadata.json")) {
            "Die Versionswerte werden nicht aus AGPs output-metadata.json gelesen"
        }
        assert(Quellen.workflow("android-signieren.yml").contains("{versionCode:${'$'}code, versionName:${'$'}name,")) {
            "Die Beschreibung traegt nicht beide Versionsangaben"
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
        val workflow = Quellen.workflow("android-signieren.yml")
        assert(workflow.contains("commit:${'$'}commit")) {
            "Die Beschreibung traegt das Herkunftsfeld nicht mehr als `commit`"
        }
        assert(!workflow.contains("sha:${'$'}sha")) {
            "Das Feld heisst wieder `sha` — neben apkUrl und apkSize liest sich das " +
                "als Pruefsumme des APK, und eine solche Pruefung gibt es nicht"
        }
        // Quellen.lies() is relative to ch/brickinventoryapp/ — see there.
        val model = Quellen.lies("update/util/AppUpdate.kt")
        assert(model.contains("@SerialName(\"commit\")")) {
            "Das Datenmodell liest das Feld nicht als `commit` — dann bleibt es leer"
        }
    }

    // What the start dialog does and doesn't do, UpdateDialogTest checks rendered; here only
    // that it hangs over the whole app.
    @Test
    fun `the dialog hangs over the whole app, not on one screen`() {
        val nav = Quellen.withoutComments(Quellen.lies("app/AppNavigation.kt"))
        assert(nav.contains("UpdateRoute(selbstUpdate)")) {
            "Der Update-Hinweis wird nirgends gezeigt. In einem einzelnen Bildschirm " +
                "aufgerufen bekaeme ihn nur, wer ohnehin dort sitzt — genau der Fehler, " +
                "den der Punkt in den Einstellungen schon einmal hatte."
        }
    }
}
